/**
 * The impure shell of the offline photo queue (INS-086 Phase 3, spec §5.1;
 * hardened in INS-093). All decisions live in the pure `capture-core.ts`; this
 * module only touches the world: app-private files, sha256 over bytes, and the
 * three-step upload (presign → PUT → register|retake) through
 * `@inspect/api-client` and expo-file-system's native uploader.
 *
 * It is a module-level SINGLETON on purpose: uploads keep running while the
 * inspector navigates away from the capture screen, the persisted file is the
 * source of truth across launches, and the UI merely subscribes.
 */
import { ApiError } from '@inspect/api-client';
import type {
  InspectionDto,
  PhotoDto,
  PresignInput,
  PresignResultDto,
  RegisterPhotoInput,
  RetakePhotoInput,
} from '@inspect/shared-types';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { AppState } from 'react-native';

import {
  activeEntries,
  cachedEntries,
  discardQueued,
  enqueue,
  markConflict,
  markFailed,
  markUploaded,
  markUploading,
  nextRetryDelay,
  parseQueue,
  resolveConflictAsRetake,
  retryFailed,
  selectNextUpload,
  staleCache,
  supersede,
  withTimeout,
  type QueuedPhoto,
  type SlotRef,
} from './capture-core';
import { client } from './session';

const QUEUE_FILE = 'inspect-photo-queue.json';
const CAPTURES_DIR = 'captures';

/** Deadlines. A stalled PUT is aborted; a stalled API call is abandoned (its retry converges). */
export const PRESIGN_TIMEOUT_MS = 20_000;
export const REGISTER_TIMEOUT_MS = 20_000;
export const PUT_TIMEOUT_MS = 120_000;

function queueFile(): File {
  return new File(Paths.document, QUEUE_FILE);
}

function capturesDir(): Directory {
  const dir = new Directory(Paths.document, CAPTURES_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Load the persisted queue; a missing or corrupt file is an empty queue. */
export function loadQueue(): QueuedPhoto[] {
  try {
    const f = queueFile();
    if (!f.exists) return [];
    return parseQueue(f.textSync());
  } catch {
    return [];
  }
}

export function saveQueue(queue: readonly QueuedPhoto[]): void {
  try {
    queueFile().write(JSON.stringify(queue));
  } catch {
    // Persistence is best-effort; the in-memory queue stays authoritative for
    // this session and the next launch re-syncs against the server anyway.
  }
}

/** Hex sha256 of a local file's bytes — the hash-at-capture step. */
export async function hashFile(uri: string): Promise<string> {
  const bytes = await new File(uri).bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Move a just-captured photo from the camera's cache into app-private storage
 * so it survives until the loop ends. Returns the durable URI.
 */
export function stashCapture(tempUri: string, id: string): string {
  const file = new File(tempUri);
  const dest = new File(capturesDir(), `${id}.jpg`);
  file.moveSync(dest);
  return dest.uri;
}

function deleteLocal(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Orphaned bytes in the app sandbox are a cleanup nit, not a correctness
    // problem — never fail a successful upload over it.
  }
}

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/** The network steps, injected so the drain logic stays testable. */
export interface QueueIo {
  presign(inspectionId: string, input: PresignInput): Promise<PresignResultDto>;
  putBytes(
    uploadUrl: string,
    localUri: string,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
  register(inspectionId: string, input: RegisterPhotoInput): Promise<PhotoDto>;
  retake(inspectionId: string, photoId: string, input: RetakePhotoInput): Promise<PhotoDto>;
  /** Who occupies a slot right now — used to turn a 409 into a retake. */
  occupying(inspectionId: string, slot: SlotRef): Promise<PhotoDto | undefined>;
}

export function defaultIo(): QueueIo {
  return {
    presign: (inspectionId, input) =>
      client.post<PresignResultDto>(`/inspections/${inspectionId}/populate/photos/presign`, input),
    putBytes: async (uploadUrl, localUri, onProgress, signal) => {
      const res = await new File(localUri).upload(uploadUrl, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        headers: { 'Content-Type': 'image/jpeg' },
        onProgress: ({ bytesSent, totalBytes }) =>
          onProgress(totalBytes > 0 ? Math.min(1, bytesSent / totalBytes) : 0),
        signal,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`storage PUT failed (${res.status})`);
      }
    },
    register: (inspectionId, input) =>
      client.post<PhotoDto>(`/inspections/${inspectionId}/populate/photos`, input),
    retake: (inspectionId, photoId, input) =>
      client.post<PhotoDto>(
        `/inspections/${inspectionId}/populate/photos/${photoId}/retake`,
        input,
      ),
    occupying: async (inspectionId, slot) => {
      const insp = await client.get<InspectionDto>(`/inspections/${inspectionId}/populate`);
      return insp.items
        ?.find((i) => i.id === slot.inspectionLoopItemId)
        ?.photos?.find((p) => p.cycleIndex === slot.cycleIndex);
    },
  };
}

function deviceId(): string {
  return `mobile-${Device.modelName ?? 'unknown'}`;
}

function isSlotConflict(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 409 &&
    // The other 409 on this route is a clientRequestId reused across
    // inspections — a client bug, not a filled slot.
    !/clientRequestId/i.test(e.message)
  );
}

export interface QueueSnapshot {
  queue: QueuedPhoto[];
  /** Upload progress 0..1 for the entry currently in flight, by entry id. */
  progress: Record<string, number>;
}

type Listener = (snapshot: QueueSnapshot) => void;

/**
 * The upload manager. One instance for the whole app (see `photoQueue`).
 *
 * Outcomes per entry: registered/retaken → `uploaded` cache record (bytes
 * kept until `purgeInspection`); HTTP 409 on a `fill` (slot filled while we
 * waited) → `conflict`, retained for a human; 409 on a `replace` → the retake
 * path, automatically; anything else → `failed`, retried on a backoff ladder
 * until it lands or a human discards it.
 */
export class PhotoQueueManager {
  private queue: QueuedPhoto[];
  private progress: Record<string, number> = {};
  private listeners = new Set<Listener>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: { id: string; abort: AbortController } | null = null;

  constructor(private readonly io: QueueIo) {
    this.queue = this.reconcile(loadQueue());
    saveQueue(this.queue);
    // Coming back to the foreground is the best moment to retry: the network
    // has most likely changed since we backed off.
    AppState.addEventListener('change', (state) => {
      if (state === 'active') this.kick(true);
    });
  }

  /**
   * On launch: drop cache records whose bytes are gone, mark work whose bytes
   * are gone as failed (a human must discard — never a silent drop), sweep
   * cache older than the retention window, and delete orphan files.
   */
  private reconcile(loaded: QueuedPhoto[]): QueuedPhoto[] {
    let queue = loaded;
    for (const q of loaded) {
      if (fileExists(q.localUri)) continue;
      queue =
        q.state === 'uploaded'
          ? discardQueued(queue, q.id)
          : markFailed(queue, q.id, 'The photo file is missing on this device', 0).map((e) =>
              e.id === q.id ? { ...e, nextAttemptAt: Number.MAX_SAFE_INTEGER } : e,
            );
    }
    for (const stale of staleCache(queue)) {
      deleteLocal(stale.localUri);
      queue = discardQueued(queue, stale.id);
    }
    try {
      const known = new Set(queue.map((q) => q.localUri));
      for (const entry of capturesDir().list()) {
        if (entry instanceof File && !known.has(entry.uri)) entry.delete();
      }
    } catch {
      // Orphan sweep is housekeeping only.
    }
    return queue;
  }

  snapshot(): QueueSnapshot {
    return { queue: this.queue, progress: this.progress };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  private commit(next: QueuedPhoto[]): void {
    this.queue = next;
    saveQueue(next);
    this.emit();
  }

  private emit(): void {
    const snap = this.snapshot();
    this.listeners.forEach((fn) => fn(snap));
  }

  // ── Mutations from the UI ─────────────────────────────────────────────────

  /**
   * Add a capture. A `fill` refuses a slot that already has work (the screen
   * never offers that); a `replace` supersedes it — aborting the in-flight
   * upload and deleting the dead bytes.
   */
  add(entry: QueuedPhoto): void {
    if (entry.intent === 'replace') {
      const { queue, superseded } = supersede(this.queue, entry);
      if (superseded) {
        this.abortIfInflight(superseded.id);
        deleteLocal(superseded.localUri);
      }
      this.commit(queue);
    } else {
      this.commit(enqueue(this.queue, entry));
    }
    this.kick(true);
  }

  /** Re-arm failures immediately (scoped to one inspection when given). */
  retryNow(inspectionId?: string): void {
    this.commit(retryFailed(this.queue, inspectionId));
    this.kick(true);
  }

  resolveConflictKeepMine(id: string): void {
    this.commit(resolveConflictAsRetake(this.queue, id));
    this.kick(true);
  }

  /** Explicit human decision: drop an entry and its bytes. */
  discard(id: string): void {
    const entry = this.queue.find((q) => q.id === id);
    if (!entry) return;
    this.abortIfInflight(id);
    deleteLocal(entry.localUri);
    this.commit(discardQueued(this.queue, id));
  }

  /** A whole unit was discarded server-side: drop everything aimed at it. */
  discardCycle(inspectionId: string, cycleIndex: number): void {
    const doomed = this.queue.filter(
      (q) => q.inspectionId === inspectionId && q.cycleIndex === cycleIndex,
    );
    let next = this.queue;
    for (const q of doomed) {
      this.abortIfInflight(q.id);
      deleteLocal(q.localUri);
      next = discardQueued(next, q.id);
    }
    if (doomed.length) this.commit(next);
  }

  /**
   * The loop ended (submitted) or is locked: the cache has served its purpose.
   * Active work is deliberately NOT purged — the submit gate guarantees there
   * is none for a submitted inspection, and for a locked one it is evidence a
   * human should look at, not something to delete on the way out.
   */
  purgeInspection(inspectionId: string): void {
    const cached = cachedEntries(this.queue, inspectionId);
    if (!cached.length) return;
    let next = this.queue;
    for (const q of cached) {
      deleteLocal(q.localUri);
      next = discardQueued(next, q.id);
    }
    this.commit(next);
  }

  // ── The drain ─────────────────────────────────────────────────────────────

  /** Start the drain loop if idle. `immediate` clears any pending backoff timer. */
  kick(immediate = false): void {
    if (immediate && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) return;
    this.running = true;
    void this.run().finally(() => {
      this.running = false;
    });
  }

  private async run(): Promise<void> {
    // Re-reads the LIVE queue on every iteration, so a capture that lands
    // mid-drain is picked up by this loop instead of waiting for the next kick.
    for (;;) {
      const next = selectNextUpload(this.queue);
      if (!next) break;
      await this.upload(next);
    }
    const delay = nextRetryDelay(this.queue);
    if (delay !== null && delay < Number.MAX_SAFE_INTEGER / 2 && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.kick();
      }, Math.max(delay, 250));
    }
  }

  private abortIfInflight(id: string): void {
    if (this.inflight?.id === id) this.inflight.abort.abort();
  }

  private setProgress(id: string, fraction: number): void {
    this.progress = { ...this.progress, [id]: fraction };
    this.emit();
  }

  private clearProgress(id: string): void {
    const { [id]: _gone, ...rest } = this.progress;
    this.progress = rest;
  }

  private async upload(entry: QueuedPhoto): Promise<void> {
    const abort = new AbortController();
    this.inflight = { id: entry.id, abort };
    this.commit(markUploading(this.queue, entry.id));
    this.setProgress(entry.id, 0);
    try {
      if (!fileExists(entry.localUri)) {
        throw new Error('The photo file is missing on this device');
      }
      const presigned = await withTimeout(
        this.io.presign(entry.inspectionId, { ext: 'jpg' }),
        PRESIGN_TIMEOUT_MS,
        'Requesting an upload slot',
      );
      await withTimeout(
        this.io.putBytes(
          presigned.uploadUrl,
          entry.localUri,
          (f) => this.setProgress(entry.id, f),
          abort.signal,
        ),
        PUT_TIMEOUT_MS,
        'Uploading the photo',
        () => abort.abort(),
      );
      const photo = await this.commitToServer(entry, presigned.storageKey);
      // The entry may have been discarded/superseded while the request ran —
      // if it is no longer in the queue, its bytes are already gone.
      if (!this.queue.some((q) => q.id === entry.id)) return;
      if (photo === 'conflict') {
        this.commit(markConflict(this.queue, entry.id));
        return;
      }
      const { queue, evicted } = markUploaded(this.queue, entry.id, photo.id);
      evicted.forEach((q) => deleteLocal(q.localUri));
      this.commit(queue);
    } catch (e) {
      if (!this.queue.some((q) => q.id === entry.id)) return; // discarded meanwhile
      if (abort.signal.aborted && !(e instanceof Error && e.name === 'TimeoutError')) {
        return; // superseded/discarded by a human — nothing to record
      }
      const message = e instanceof Error ? e.message : 'Upload failed';
      this.commit(markFailed(this.queue, entry.id, message));
    } finally {
      this.clearProgress(entry.id);
      if (this.inflight?.id === entry.id) this.inflight = null;
      this.emit();
    }
  }

  /**
   * Register or retake, by intent. `replace` never yields a conflict: a filled
   * slot is what the inspector expected, so the occupant is replaced in place
   * (INS-081 retake semantics — the slot is the identity, both hashes audited).
   */
  private async commitToServer(
    entry: QueuedPhoto,
    storageKey: string,
  ): Promise<PhotoDto | 'conflict'> {
    const retakeInput: RetakePhotoInput = {
      storageKey,
      contentHash: entry.sha256,
      capturedAt: entry.capturedAt,
      deviceId: deviceId(),
    };
    const registerInput: RegisterPhotoInput = {
      storageKey,
      contentHash: entry.sha256,
      inspectionLoopItemId: entry.inspectionLoopItemId,
      cycleIndex: entry.cycleIndex,
      capturedAt: entry.capturedAt,
      deviceId: deviceId(),
      clientRequestId: entry.clientRequestId,
    };
    const retakeAgainst = (photoId: string) =>
      withTimeout(
        this.io.retake(entry.inspectionId, photoId, retakeInput),
        REGISTER_TIMEOUT_MS,
        'Recording the retake',
      );
    const register = () =>
      withTimeout(
        this.io.register(entry.inspectionId, registerInput),
        REGISTER_TIMEOUT_MS,
        'Recording the photo',
      );

    if (entry.intent === 'replace' && entry.retakeOf) {
      try {
        return await retakeAgainst(entry.retakeOf);
      } catch (e) {
        // The occupant vanished (its unit was discarded elsewhere): the slot is
        // free again, so this is a plain register now.
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    try {
      return await register();
    } catch (e) {
      if (!isSlotConflict(e)) throw e;
      if (entry.intent !== 'replace') return 'conflict';
      const occupant = await withTimeout(
        this.io.occupying(entry.inspectionId, entry),
        REGISTER_TIMEOUT_MS,
        'Looking up the slot',
      );
      if (!occupant) return register(); // raced with a discard — try once more
      return retakeAgainst(occupant.id);
    }
  }
}

let singleton: PhotoQueueManager | null = null;

/** The app's ONE upload manager. Lazily built so tests never touch Expo natives. */
export function photoQueue(): PhotoQueueManager {
  if (!singleton) singleton = new PhotoQueueManager(defaultIo());
  return singleton;
}

/** Summary counts a header can show without walking the queue itself. */
export function summarize(queue: readonly QueuedPhoto[], inspectionId: string) {
  const active = activeEntries(queue, inspectionId);
  return {
    active: active.length,
    uploading: active.filter((q) => q.state === 'uploading' || q.state === 'pending').length,
    failed: active.filter((q) => q.state === 'failed').length,
    conflicts: active.filter((q) => q.state === 'conflict').length,
    cached: cachedEntries(queue, inspectionId).length,
  };
}
