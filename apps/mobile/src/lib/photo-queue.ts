/**
 * The impure shell of the offline photo queue (INS-086 Phase 3, spec §5.1).
 * All decisions live in the pure `capture-core.ts`; this module only touches
 * the world: app-private files, sha256 over bytes, and the three-step drain
 * (presign → PUT → register) through `@inspect/api-client`.
 */
import { ApiError } from '@inspect/api-client';
import type {
  PhotoDto,
  PresignInput,
  PresignResultDto,
  RegisterPhotoInput,
  RetakePhotoInput,
} from '@inspect/shared-types';
import { fetch as expoFetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import {
  markConflict,
  markDone,
  markFailed,
  markUploading,
  parseQueue,
  uploadable,
  type QueuedPhoto,
} from './capture-core';
import { client } from './session';

const QUEUE_FILE = 'inspect-photo-queue.json';
const CAPTURES_DIR = 'captures';

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
 * so it survives until the queue drains. Returns the durable URI.
 */
export function stashCapture(tempUri: string, id: string): string {
  const file = new File(tempUri);
  const dest = new File(capturesDir(), `${id}.jpg`);
  file.move(dest);
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

/** The three network steps, injected so the drain logic stays testable. */
export interface QueueIo {
  presign(inspectionId: string, input: PresignInput): Promise<PresignResultDto>;
  putBytes(uploadUrl: string, localUri: string): Promise<void>;
  register(inspectionId: string, input: RegisterPhotoInput): Promise<PhotoDto>;
}

export function defaultIo(): QueueIo {
  return {
    presign: (inspectionId, input) =>
      client.post<PresignResultDto>(`/inspections/${inspectionId}/populate/photos/presign`, input),
    putBytes: async (uploadUrl, localUri) => {
      const res = await expoFetch(uploadUrl, {
        method: 'PUT',
        // expo-file-system's File implements Blob, so it streams as the body.
        body: new File(localUri),
        headers: { 'Content-Type': 'image/jpeg' },
      });
      if (!res.ok) throw new Error(`storage PUT failed (${res.status})`);
    },
    register: (inspectionId, input) =>
      client.post<PhotoDto>(`/inspections/${inspectionId}/populate/photos`, input),
  };
}

/**
 * Drain every pending entry: presign → PUT → register, with the entry's
 * ORIGINAL `clientRequestId` on register so a retry after a lost response
 * converges on the server's existing row instead of a 409.
 *
 * Outcomes per entry: registered → removed (and local bytes deleted);
 * HTTP 409 (slot filled while we waited) → `conflict`, retained for a human;
 * anything else → `failed`, retryable. The callback fires after every
 * transition so the UI and the persisted file stay current mid-drain.
 */
export async function drainQueue(
  initial: readonly QueuedPhoto[],
  io: QueueIo,
  onChange?: (queue: QueuedPhoto[]) => void,
): Promise<QueuedPhoto[]> {
  let queue = [...initial];
  const emit = (next: QueuedPhoto[]) => {
    queue = next;
    saveQueue(queue);
    onChange?.(queue);
  };

  for (const entry of uploadable(initial)) {
    emit(markUploading(queue, entry.id));
    try {
      const presigned = await io.presign(entry.inspectionId, { ext: 'jpg' });
      await io.putBytes(presigned.uploadUrl, entry.localUri);
      await io.register(entry.inspectionId, {
        storageKey: presigned.storageKey,
        contentHash: entry.sha256,
        inspectionLoopItemId: entry.inspectionLoopItemId,
        cycleIndex: entry.cycleIndex,
        capturedAt: entry.capturedAt,
        clientRequestId: entry.clientRequestId,
      });
      deleteLocal(entry.localUri);
      emit(markDone(queue, entry.id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        emit(markConflict(queue, entry.id));
      } else {
        const message = e instanceof Error ? e.message : 'upload failed';
        emit(markFailed(queue, entry.id, message));
      }
    }
  }
  return queue;
}

/**
 * Resolve a conflict by keeping the local photo: replace the occupying photo's
 * bytes in place (the slot is the identity — INS-081 retake semantics).
 */
export async function retakeWithQueued(
  entry: QueuedPhoto,
  occupyingPhotoId: string,
  io: QueueIo = defaultIo(),
): Promise<void> {
  const presigned = await io.presign(entry.inspectionId, { ext: 'jpg' });
  await io.putBytes(presigned.uploadUrl, entry.localUri);
  const input: RetakePhotoInput = {
    storageKey: presigned.storageKey,
    contentHash: entry.sha256,
  };
  await client.post(
    `/inspections/${entry.inspectionId}/populate/photos/${occupyingPhotoId}/retake`,
    input,
  );
  deleteLocal(entry.localUri);
}

/** Drop a queued photo's local bytes (used when a human discards a conflict). */
export function deleteQueuedBytes(entry: QueuedPhoto): void {
  deleteLocal(entry.localUri);
}
