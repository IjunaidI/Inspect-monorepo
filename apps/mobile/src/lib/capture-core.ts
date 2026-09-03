/**
 * The pure core of the capture loop (INS-086 Phase 3) — no I/O, no React, no
 * Expo imports, so it runs under plain Vitest. The impure shell
 * (`photo-queue.ts`, the capture screen) is deliberately thin over this.
 *
 * The three rules this module exists to pin (see
 * `.claude/rules/migration-discipline.md`):
 *  - hash-at-capture: a queue item cannot exist without a sha256;
 *  - a 409 on a filled slot becomes a `conflict` a human resolves, never a drop;
 *  - submit is blocked while the queue is non-empty.
 */
import type { CycleStateDto } from '@inspect/shared-types';

export interface SlotRef {
  inspectionLoopItemId: string;
  cycleIndex: number;
}

export type QueuedPhotoState = 'pending' | 'uploading' | 'conflict' | 'failed';

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
}

export interface CreateQueuedPhotoInput {
  inspectionId: string;
  inspectionLoopItemId: string;
  cycleIndex: number;
  localUri: string;
  sha256: string;
  capturedAt?: string;
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
  };
}

export function queuedForSlot(
  queue: readonly QueuedPhoto[],
  inspectionId: string,
  slot: SlotRef,
): QueuedPhoto | undefined {
  return queue.find(
    (q) =>
      q.inspectionId === inspectionId &&
      q.inspectionLoopItemId === slot.inspectionLoopItemId &&
      q.cycleIndex === slot.cycleIndex,
  );
}

export function enqueue(queue: readonly QueuedPhoto[], photo: QueuedPhoto): QueuedPhoto[] {
  if (queuedForSlot(queue, photo.inspectionId, photo)) {
    throw new Error('a photo is already queued for this slot — one image per slot');
  }
  return [...queue, photo];
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
  }));
}

/** Upload registered server-side — the entry has served its purpose. */
export function markDone(queue: readonly QueuedPhoto[], id: string): QueuedPhoto[] {
  return queue.filter((q) => q.id !== id);
}

/**
 * The slot filled while this photo waited (server 409). The entry is RETAINED
 * for a human to resolve — keep mine as a retake, or discard. Never dropped.
 */
export function markConflict(queue: readonly QueuedPhoto[], id: string): QueuedPhoto[] {
  return transition(queue, id, (q) => ({ ...q, state: 'conflict' }));
}

export function markFailed(
  queue: readonly QueuedPhoto[],
  id: string,
  error: string,
): QueuedPhoto[] {
  return transition(queue, id, (q) => ({
    ...q,
    state: 'failed',
    attempts: q.attempts + 1,
    error,
  }));
}

/** Re-arm failed entries for the next drain. Conflicts are NOT retried. */
export function retryFailed(queue: readonly QueuedPhoto[]): QueuedPhoto[] {
  return queue.map((q) => (q.state === 'failed' ? { ...q, state: 'pending' } : q));
}

/** Explicit human decision to drop a queued photo (e.g. resolving a conflict). */
export function discardQueued(queue: readonly QueuedPhoto[], id: string): QueuedPhoto[] {
  return queue.filter((q) => q.id !== id);
}

export function uploadable(queue: readonly QueuedPhoto[]): QueuedPhoto[] {
  return queue.filter((q) => q.state === 'pending');
}

/** Minimal item shape the overlay needs from the server payload. */
export interface ServerItemSlots {
  id: string;
  photos?: { cycleIndex: number }[];
}

/** A slot is filled if the server holds a photo for it OR the queue targets it. */
export function effectiveSlotFilled(
  serverItems: readonly ServerItemSlots[],
  queue: readonly QueuedPhoto[],
  inspectionId: string,
  slot: SlotRef,
): boolean {
  const item = serverItems.find((i) => i.id === slot.inspectionLoopItemId);
  if (item?.photos?.some((p) => p.cycleIndex === slot.cycleIndex)) return true;
  return queuedForSlot(queue, inspectionId, slot) !== undefined;
}

export interface Cursor {
  cycleIndex: number;
  itemIndex: number;
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
 * completeness verdict (never recomputed client-side); the queue length is the
 * device's own knowledge. Submitting with photos still on the device would ask
 * the server to evaluate an inspection that does not exist yet.
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

/** Parse a persisted queue, dropping anything that does not look like an entry. */
export function parseQueue(raw: string | null | undefined): QueuedPhoto[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (q): q is QueuedPhoto =>
        typeof q === 'object' &&
        q !== null &&
        typeof (q as QueuedPhoto).id === 'string' &&
        typeof (q as QueuedPhoto).sha256 === 'string' &&
        (q as QueuedPhoto).sha256.length > 0 &&
        typeof (q as QueuedPhoto).clientRequestId === 'string',
    );
  } catch {
    return [];
  }
}
