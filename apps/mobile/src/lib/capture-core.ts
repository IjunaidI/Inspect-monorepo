/**
 * The pure core of the capture loop (INS-086 Phase 3, hardened in INS-093) —
 * no I/O, no React, no Expo imports, so it runs under plain Vitest. The impure
 * shell (`photo-queue.ts`, the capture screen) is deliberately thin over this.
 *
 * The rules this module exists to pin (see `.claude/rules/migration-discipline.md`):
 *  - hash-at-capture: a queue item cannot exist without a sha256;
 *  - a 409 on a slot the inspector believed EMPTY becomes a `conflict` a human
 *    resolves, never a drop; a 409 on a slot the inspector deliberately RETOOK
 *    is a retake, never a conflict (the `intent` field tells them apart);
 *  - submit is blocked while any upload is still outstanding;
 *  - the loop only moves FORWARD by capturing: the cursor walks the slots that
 *    already hold evidence plus exactly one empty slot — the frontier — so a
 *    unit can never be left with a hole by tapping "next".
 *  - every photo stays on the device, as a cache, until the loop ends
 *    successfully: an `uploaded` entry is a cache record, not queue work.
 */
import type { CycleStateDto } from '@inspect/shared-types';

export interface SlotRef {
  inspectionLoopItemId: string;
  cycleIndex: number;
}

/**
 * `pending`/`uploading`/`failed`/`conflict` are QUEUE WORK — the photo is not
 * on the server yet. `uploaded` is a CACHE RECORD — registered server-side,
 * bytes kept on-device for instant display until the loop ends.
 */
export type QueuedPhotoState = 'pending' | 'uploading' | 'conflict' | 'failed' | 'uploaded';

/**
 * What the inspector believed about the slot when the shutter fired.
 *  - `fill`: the slot was empty. If the server says otherwise (409) somebody
 *    else filled it meanwhile → a human decides (`conflict`).
 *  - `replace`: a deliberate retake of a slot that already held a photo. A
 *    filled slot is the EXPECTED case → replaced in place, never a conflict.
 */
export type CaptureIntent = 'fill' | 'replace';

/**
 * Why an upload failed, which decides what happens next.
 *  - `offline`: no network at all — wait for the connection, no backoff needed.
 *  - `transient`: the network or server hiccupped (timeout, 5xx, 429, DNS) —
 *    retry on the backoff ladder.
 *  - `permanent`: the server refused the request itself (4xx other than the
 *    slot conflict) — retrying the same bytes cannot succeed; a human retakes
 *    or discards.
 */
export type FailureKind = 'offline' | 'transient' | 'permanent';

export interface QueuedPhoto {
  /** Local identity of the queue entry. */
  id: string;
  inspectionId: string;
  inspectionLoopItemId: string;
  cycleIndex: number;
  /** App-private file URI holding the captured bytes. */
  localUri: string;
  /** Hex sha256 of the bytes, computed at capture time on-device. */
  sha256: string;
  /**
   * Minted ONCE at creation and stable across every retry — the register
   * endpoint dedupes on it, which is what makes the drain retry-safe.
   */
  clientRequestId: string;
  capturedAt: string;
  state: QueuedPhotoState;
  attempts: number;
  error?: string;
  intent: CaptureIntent;
  /** Server photo id this retake replaces, when it was known at capture time. */
  retakeOf?: string;
  /** Set once registered: the server row this entry became. */
  photoId?: string;
  uploadedAt?: string;
  /** Epoch ms before which a failed entry must not be retried (backoff). */
  nextAttemptAt?: number;
  /** Set with `state: 'failed'`. */
  failureKind?: FailureKind;
}

export interface CreateQueuedPhotoInput {
  inspectionId: string;
  inspectionLoopItemId: string;
  cycleIndex: number;
  localUri: string;
  sha256: string;
  capturedAt?: string;
  intent?: CaptureIntent;
  retakeOf?: string;
}

let seq = 0;

export function createQueuedPhoto(input: CreateQueuedPhotoInput): QueuedPhoto {
  if (!input.sha256) {
    throw new Error(
      'sha256 is required at capture time — the content-hash chain is the tamper-proof guarantee',
    );
  }
  const nonce = `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `q-${nonce}`,
    inspectionId: input.inspectionId,
    inspectionLoopItemId: input.inspectionLoopItemId,
    cycleIndex: input.cycleIndex,
    localUri: input.localUri,
    sha256: input.sha256,
    clientRequestId: `mob-${nonce}`,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    state: 'pending',
    attempts: 0,
    intent: input.intent ?? 'fill',
    ...(input.retakeOf ? { retakeOf: input.retakeOf } : {}),
  };
}

// ── Queue predicates ────────────────────────────────────────────────────────

/** Queue WORK: anything not yet on the server. Cache records are excluded. */
export function isActive(q: QueuedPhoto): boolean {
  return q.state !== 'uploaded';
}

export function activeEntries(queue: readonly QueuedPhoto[], inspectionId?: string): QueuedPhoto[] {
  return queue.filter((q) => isActive(q) && (!inspectionId || q.inspectionId === inspectionId));
}

export function cachedEntries(queue: readonly QueuedPhoto[], inspectionId?: string): QueuedPhoto[] {
  return queue.filter(
    (q) => q.state === 'uploaded' && (!inspectionId || q.inspectionId === inspectionId),
  );
}

function sameSlot(q: QueuedPhoto, inspectionId: string, slot: SlotRef): boolean {
  return (
    q.inspectionId === inspectionId &&
    q.inspectionLoopItemId === slot.inspectionLoopItemId &&
    q.cycleIndex === slot.cycleIndex
  );
}

/** The ACTIVE entry aimed at a slot (work in flight), if any. */
export function queuedForSlot(
  queue: readonly QueuedPhoto[],
  inspectionId: string,
  slot: SlotRef,
): QueuedPhoto | undefined {
  return queue.find((q) => isActive(q) && sameSlot(q, inspectionId, slot));
}

/** Any entry for a slot, newest first — active work wins over a cache record. */
export function entryForSlot(
  queue: readonly QueuedPhoto[],
  inspectionId: string,
  slot: SlotRef,
): QueuedPhoto | undefined {
  return (
    queuedForSlot(queue, inspectionId, slot) ??
    queue.find((q) => q.state === 'uploaded' && sameSlot(q, inspectionId, slot))
  );
}

/**
 * The on-device bytes to SHOW for a slot, preferring the cache record whose
 * hash matches what the server holds. `serverHash` absent → any entry.
 */
export function cachedUriForSlot(
  queue: readonly QueuedPhoto[],
  inspectionId: string,
  slot: SlotRef,
  serverHash?: string | null,
): string | undefined {
  const active = queuedForSlot(queue, inspectionId, slot);
  if (active) return active.localUri;
  const cached = queue.filter((q) => q.state === 'uploaded' && sameSlot(q, inspectionId, slot));
  if (serverHash) {
    const match = cached.find((q) => q.sha256 === serverHash);
    if (match) return match.localUri;
    // Server holds bytes this device never produced (retaken elsewhere) —
    // showing our stale cache would misrepresent the evidence.
    return undefined;
  }
  return cached[0]?.localUri;
}

// ── Queue transitions (all pure, all return a new array) ────────────────────

/** Add a `fill` capture. Refuses when work is already aimed at the slot. */
export function enqueue(queue: readonly QueuedPhoto[], photo: QueuedPhoto): QueuedPhoto[] {
  if (queuedForSlot(queue, photo.inspectionId, photo)) {
    throw new Error('a photo is already queued for this slot — one image per slot');
  }
  return [...queue, photo];
}

/**
 * Add a `replace` capture: any ACTIVE entry aimed at the same slot is
 * superseded (returned so the shell can abort its upload and delete its
 * bytes). Cache records for the slot are left alone until the new bytes land —
 * see `markUploaded`, which evicts them.
 */
export function supersede(
  queue: readonly QueuedPhoto[],
  photo: QueuedPhoto,
): { queue: QueuedPhoto[]; superseded: QueuedPhoto | undefined } {
  const superseded = queuedForSlot(queue, photo.inspectionId, photo);
  const rest = superseded ? queue.filter((q) => q.id !== superseded.id) : [...queue];
  // If the superseded entry had already landed once (a retake of a retake
  // mid-flight), carry its server identity so the drain retakes, not registers.
  const retakeOf = photo.retakeOf ?? superseded?.retakeOf ?? superseded?.photoId;
  return {
    queue: [...rest, { ...photo, intent: 'replace', ...(retakeOf ? { retakeOf } : {}) }],
    superseded,
  };
}

function transition(
  queue: readonly QueuedPhoto[],
  id: string,
  fn: (q: QueuedPhoto) => QueuedPhoto,
): QueuedPhoto[] {
  return queue.map((q) => (q.id === id ? fn(q) : q));
}

export function markUploading(queue: readonly QueuedPhoto[], id: string): QueuedPhoto[] {
  return transition(queue, id, (q) => ({
    ...q,
    state: 'uploading',
    error: undefined,
    nextAttemptAt: undefined,
  }));
}

/**
 * Upload registered server-side. The entry becomes a CACHE RECORD (bytes kept
 * for display until the loop ends) and any older cache record for the same
 * slot is evicted — returned so the shell can delete its bytes.
 */
export function markUploaded(
  queue: readonly QueuedPhoto[],
  id: string,
  photoId: string,
  now: number = Date.now(),
): { queue: QueuedPhoto[]; evicted: QueuedPhoto[] } {
  const me = queue.find((q) => q.id === id);
  if (!me) return { queue: [...queue], evicted: [] };
  const evicted = queue.filter(
    (q) => q.id !== id && q.state === 'uploaded' && sameSlot(q, me.inspectionId, me),
  );
  const evictedIds = new Set(evicted.map((q) => q.id));
  return {
    queue: queue
      .filter((q) => !evictedIds.has(q.id))
      .map((q) =>
        q.id === id
          ? {
              ...q,
              state: 'uploaded' as const,
              photoId,
              uploadedAt: new Date(now).toISOString(),
              error: undefined,
              nextAttemptAt: undefined,
            }
          : q,
      ),
    evicted,
  };
}

/**
 * @deprecated in favour of `markUploaded` — kept so the "registered → gone"
 * semantics remain available where no cache is wanted.
 */
export function markDone(queue: readonly QueuedPhoto[], id: string): QueuedPhoto[] {
  return queue.filter((q) => q.id !== id);
}

/**
 * The slot filled while this `fill` photo waited (server 409). The entry is
 * RETAINED for a human to resolve — keep mine as a retake, or discard. Never
 * dropped.
 */
export function markConflict(queue: readonly QueuedPhoto[], id: string): QueuedPhoto[] {
  return transition(queue, id, (q) => ({ ...q, state: 'conflict', nextAttemptAt: undefined }));
}

/** Backoff schedule for automatic retries, capped. `attempts` counts failures so far. */
export function backoffMs(attempts: number): number {
  const ladder = [2_000, 5_000, 15_000, 30_000, 60_000];
  return ladder[Math.min(Math.max(attempts, 1), ladder.length) - 1];
}

export function markFailed(
  queue: readonly QueuedPhoto[],
  id: string,
  error: string,
  now: number = Date.now(),
  kind: FailureKind = 'transient',
): QueuedPhoto[] {
  return transition(queue, id, (q) => {
    const attempts = q.attempts + 1;
    return {
      ...q,
      state: 'failed',
      attempts,
      error,
      failureKind: kind,
      // Offline: nothing to back off from — the reconnect re-arms it. Permanent:
      // never auto-retried. Transient: the ladder.
      nextAttemptAt:
        kind === 'permanent'
          ? Number.MAX_SAFE_INTEGER
          : kind === 'offline'
            ? now + 5_000
            : now + backoffMs(attempts),
    };
  });
}

/** Minimal error shape the classifier reads — an `Error`, an `ApiError`, or a string. */
export interface ErrorLike {
  name?: string;
  message?: string;
  status?: number;
}

/**
 * Sort an upload error into what to do next. Offline/transient are retried
 * automatically; permanent failures wait for a human.
 */
export function classifyUploadError(e: unknown, online: boolean | null = null): FailureKind {
  const err: ErrorLike =
    typeof e === 'string' ? { message: e } : ((e as ErrorLike | null) ?? {});
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (status !== undefined) {
    if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient';
    if (status >= 400) return 'permanent';
    return 'transient';
  }
  if (online === false) return 'offline';
  const msg = `${err.name ?? ''} ${err.message ?? ''}`.toLowerCase();
  if (/network request failed|failed to connect|unable to resolve host|enotfound|econnrefused|econnreset|network is unreachable|no address associated|software caused connection abort|socket/i.test(msg)) {
    return online === null ? 'offline' : 'transient';
  }
  if (/missing on this device/i.test(msg)) return 'permanent';
  return 'transient';
}

/**
 * The network is back (or the app returned to the foreground): every
 * offline/transient failure may be tried right now. Permanent ones are NOT
 * touched — the same request would fail the same way.
 */
export function rearmRetryable(queue: readonly QueuedPhoto[]): QueuedPhoto[] {
  return queue.map((q) =>
    q.state === 'failed' && q.failureKind !== 'permanent'
      ? { ...q, state: 'pending', nextAttemptAt: undefined, failureKind: undefined }
      : q,
  );
}

/**
 * Re-arm failed entries for an IMMEDIATE retry (a human tapped retry, or the
 * loop is being ended). Conflicts are NOT retried — they need a decision.
 */
export function retryFailed(queue: readonly QueuedPhoto[], inspectionId?: string): QueuedPhoto[] {
  return queue.map((q) =>
    q.state === 'failed' && (!inspectionId || q.inspectionId === inspectionId)
      ? { ...q, state: 'pending', nextAttemptAt: undefined, failureKind: undefined }
      : q,
  );
}

/**
 * A human chose "keep mine" on a conflict: the entry becomes a deliberate
 * retake of whatever occupies the slot and goes back to work.
 */
export function resolveConflictAsRetake(queue: readonly QueuedPhoto[], id: string): QueuedPhoto[] {
  return transition(queue, id, (q) => ({
    ...q,
    state: 'pending',
    intent: 'replace',
    error: undefined,
    nextAttemptAt: undefined,
  }));
}

/** Explicit human decision to drop a queued photo (e.g. resolving a conflict). */
export function discardQueued(queue: readonly QueuedPhoto[], id: string): QueuedPhoto[] {
  return queue.filter((q) => q.id !== id);
}

/** Entries that may be uploaded right now — pending, or failed and past backoff. */
export function uploadable(queue: readonly QueuedPhoto[], now: number = Date.now()): QueuedPhoto[] {
  return queue.filter(
    (q) =>
      q.state === 'pending' ||
      (q.state === 'failed' && (q.nextAttemptAt === undefined || q.nextAttemptAt <= now)),
  );
}

/** The single entry the drain should work on next, oldest capture first. */
export function selectNextUpload(
  queue: readonly QueuedPhoto[],
  now: number = Date.now(),
): QueuedPhoto | undefined {
  const ready = uploadable(queue, now);
  // Pending (never tried, or explicitly re-armed) before backed-off failures,
  // then by capture time so a unit lands in the order it was shot.
  return [...ready].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'pending' ? -1 : 1;
    return a.capturedAt.localeCompare(b.capturedAt);
  })[0];
}

/**
 * Milliseconds until the earliest backed-off failure is due; null when none.
 * Permanent failures never come due.
 */
export function nextRetryDelay(queue: readonly QueuedPhoto[], now: number = Date.now()): number | null {
  const due = queue
    .filter(
      (q) =>
        q.state === 'failed' && q.nextAttemptAt !== undefined && q.failureKind !== 'permanent',
    )
    .map((q) => Math.max(0, (q.nextAttemptAt as number) - now));
  return due.length ? Math.min(...due) : null;
}

/** Cache records old enough to sweep regardless of the loop's fate. */
export function staleCache(
  queue: readonly QueuedPhoto[],
  now: number = Date.now(),
  maxAgeMs: number = 30 * 24 * 60 * 60 * 1000,
): QueuedPhoto[] {
  return queue.filter((q) => {
    if (q.state !== 'uploaded') return false;
    const at = Date.parse(q.uploadedAt ?? q.capturedAt);
    return Number.isFinite(at) && now - at > maxAgeMs;
  });
}

// ── Slot geometry: what is filled, where the frontier is ────────────────────

/** Minimal item shape the overlay needs from the server payload. */
export interface ServerItemSlots {
  id: string;
  photos?: { cycleIndex: number }[];
}

/**
 * A slot is filled if the server holds a photo for it OR the device holds one
 * (queued work, or a cache record the server has not been re-read for yet).
 */
export function effectiveSlotFilled(
  serverItems: readonly ServerItemSlots[],
  queue: readonly QueuedPhoto[],
  inspectionId: string,
  slot: SlotRef,
): boolean {
  const item = serverItems.find((i) => i.id === slot.inspectionLoopItemId);
  if (item?.photos?.some((p) => p.cycleIndex === slot.cycleIndex)) return true;
  return entryForSlot(queue, inspectionId, slot) !== undefined;
}

export interface Cursor {
  cycleIndex: number;
  itemIndex: number;
}

/** Every filled slot (server ∪ device) as cursors, deduplicated. */
export function filledCursors(
  serverItems: readonly ServerItemSlots[],
  queue: readonly QueuedPhoto[],
  inspectionId: string,
): Cursor[] {
  const seen = new Set<string>();
  const out: Cursor[] = [];
  const push = (cycleIndex: number, itemIndex: number) => {
    const key = `${cycleIndex}:${itemIndex}`;
    if (itemIndex < 0 || seen.has(key)) return;
    seen.add(key);
    out.push({ cycleIndex, itemIndex });
  };
  serverItems.forEach((item, itemIndex) =>
    (item.photos ?? []).forEach((p) => push(p.cycleIndex, itemIndex)),
  );
  for (const q of queue) {
    if (q.inspectionId !== inspectionId) continue;
    push(
      q.cycleIndex,
      serverItems.findIndex((i) => i.id === q.inspectionLoopItemId),
    );
  }
  return out;
}

/**
 * The ONE empty slot the guided flow may capture into. Mirrors the server's
 * `cycleState.nextSlot` rule exactly (apps/api/src/inspections/cycle-state.ts)
 * with the device's photos overlaid: the first missing item of the lowest
 * partial unit; otherwise item 0 of a brand-new unit ABOVE the highest index
 * (discard gaps are never refilled — they would collide with the surviving
 * rows' unique slot).
 */
export function frontier(itemCount: number, filled: readonly Cursor[]): Cursor {
  if (itemCount === 0 || filled.length === 0) return { cycleIndex: 0, itemIndex: 0 };
  const byCycle = new Map<number, Set<number>>();
  for (const c of filled) {
    const set = byCycle.get(c.cycleIndex) ?? new Set<number>();
    set.add(c.itemIndex);
    byCycle.set(c.cycleIndex, set);
  }
  const cycles = [...byCycle.keys()].sort((a, b) => a - b);
  for (const cycleIndex of cycles) {
    const shot = byCycle.get(cycleIndex)!;
    for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
      if (!shot.has(itemIndex)) return { cycleIndex, itemIndex };
    }
  }
  return { cycleIndex: Math.max(...cycles) + 1, itemIndex: 0 };
}

export function sameCursor(a: Cursor, b: Cursor): boolean {
  return a.cycleIndex === b.cycleIndex && a.itemIndex === b.itemIndex;
}

function compareCursor(a: Cursor, b: Cursor): number {
  return a.cycleIndex - b.cycleIndex || a.itemIndex - b.itemIndex;
}

/**
 * Where the cursor is allowed to be: every filled slot plus the frontier, in
 * (unit, item) order. There is no other empty slot to stand on, which is what
 * makes "skip ahead and leave a hole" impossible from the UI.
 */
export function slotSequence(itemCount: number, filled: readonly Cursor[]): Cursor[] {
  const f = frontier(itemCount, filled);
  const all = [...filled];
  if (!all.some((c) => sameCursor(c, f))) all.push(f);
  return all.sort(compareCursor);
}

/** Step along the sequence; clamps at both ends. */
export function stepCursor(sequence: readonly Cursor[], cursor: Cursor, dir: 1 | -1): Cursor {
  const i = sequence.findIndex((c) => sameCursor(c, cursor));
  if (i < 0) return sequence[sequence.length - 1] ?? cursor;
  return sequence[Math.min(Math.max(i + dir, 0), sequence.length - 1)] ?? cursor;
}

/**
 * Keep a cursor that is still legal (a filled slot or the frontier); otherwise
 * — its unit was discarded, or the flow just landed — snap it to the frontier.
 */
export function snapCursor(sequence: readonly Cursor[], frontierCursor: Cursor, cursor: Cursor): Cursor {
  return sequence.some((c) => sameCursor(c, cursor)) ? cursor : frontierCursor;
}

/** +1 item within the unit; past the last item, roll to item 0 of the next unit. */
export function advanceCursor(itemCount: number, cursor: Cursor): Cursor {
  if (cursor.itemIndex + 1 < itemCount) {
    return { cycleIndex: cursor.cycleIndex, itemIndex: cursor.itemIndex + 1 };
  }
  return { cycleIndex: cursor.cycleIndex + 1, itemIndex: 0 };
}

/** Mirror of advance; refuses to go below unit 1 item 1. */
export function retreatCursor(itemCount: number, cursor: Cursor): Cursor {
  if (cursor.itemIndex > 0) {
    return { cycleIndex: cursor.cycleIndex, itemIndex: cursor.itemIndex - 1 };
  }
  if (cursor.cycleIndex > 0) {
    return { cycleIndex: cursor.cycleIndex - 1, itemIndex: itemCount - 1 };
  }
  return cursor;
}

// ── The submit gate ─────────────────────────────────────────────────────────

export type CanSubmitResult =
  | { ok: true }
  | { ok: false; reason: 'queue-not-empty' }
  | {
      ok: false;
      reason: 'partial-cycle';
      partial: { cycleIndex: number; missingItemIds: string[] };
    }
  | { ok: false; reason: 'no-complete-unit' };

/**
 * The submit gate as seen from the device. `cycleState` is the SERVER's
 * completeness verdict (never recomputed client-side); `queuedCount` is the
 * device's own count of ACTIVE work (cache records do not count). Submitting
 * with photos still on the device would ask the server to evaluate an
 * inspection that does not exist yet.
 */
export function canSubmit(cycleState: CycleStateDto, queuedCount: number): CanSubmitResult {
  if (queuedCount > 0) return { ok: false, reason: 'queue-not-empty' };
  const partial = cycleState.partialCycles[0];
  if (partial) {
    return {
      ok: false,
      reason: 'partial-cycle',
      partial: {
        cycleIndex: partial.cycleIndex,
        missingItemIds: partial.missingItemIds,
      },
    };
  }
  if (cycleState.completedCycles === 0) return { ok: false, reason: 'no-complete-unit' };
  return { ok: true };
}

// ── Time ────────────────────────────────────────────────────────────────────

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
  }
}

/**
 * Race a promise against a deadline. The losing promise keeps running — for
 * a register call that is harmless because its `clientRequestId` makes the
 * next attempt converge on the same row; for a byte upload the caller passes
 * `onTimeout` to abort the transfer.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError(label, ms));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ── Persistence shape ───────────────────────────────────────────────────────

/**
 * Parse a persisted queue, dropping anything that does not look like an entry.
 * Entries that were `uploading` when the app died are re-armed as `pending`
 * — their stable `clientRequestId` makes the retry converge on the server's
 * row if the lost response had in fact succeeded.
 */
export function parseQueue(raw: string | null | undefined): QueuedPhoto[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (q): q is QueuedPhoto =>
          typeof q === 'object' &&
          q !== null &&
          typeof (q as QueuedPhoto).id === 'string' &&
          typeof (q as QueuedPhoto).sha256 === 'string' &&
          (q as QueuedPhoto).sha256.length > 0 &&
          typeof (q as QueuedPhoto).clientRequestId === 'string',
      )
      .map((q) => ({
        ...q,
        intent: q.intent === 'replace' ? 'replace' : 'fill',
        state: q.state === 'uploading' ? 'pending' : q.state,
        attempts: typeof q.attempts === 'number' ? q.attempts : 0,
      }));
  } catch {
    return [];
  }
}
