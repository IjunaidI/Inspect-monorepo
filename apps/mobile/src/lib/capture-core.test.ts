import { describe, expect, it } from 'vitest';
import type { CycleStateDto } from '@inspect/shared-types';
import {
  QueuedPhoto,
  advanceCursor,
  canSubmit,
  createQueuedPhoto,
  discardQueued,
  effectiveSlotFilled,
  enqueue,
  markConflict,
  markDone,
  markFailed,
  markUploading,
  queuedForSlot,
  retreatCursor,
  retryFailed,
  uploadable,
} from './capture-core';

const slot = { inspectionLoopItemId: 'item-1', cycleIndex: 0 };

function make(overrides: Partial<Parameters<typeof createQueuedPhoto>[0]> = {}): QueuedPhoto {
  return createQueuedPhoto({
    inspectionId: 'insp-1',
    inspectionLoopItemId: 'item-1',
    cycleIndex: 0,
    localUri: 'file:///photos/a.jpg',
    sha256: 'ab'.repeat(32),
    ...overrides,
  });
}

describe('hash-at-capture', () => {
  it('refuses to create a queue item without a sha256', () => {
    // The content-hash chain is the tamper-proof guarantee; bytes must be
    // hashed on-device before anything else can touch them.
    expect(() => make({ sha256: '' })).toThrow(/sha256/i);
    expect(() => make({ sha256: undefined as unknown as string })).toThrow(/sha256/i);
  });

  it('mints a clientRequestId at creation that never changes afterwards', () => {
    const p = make();
    expect(p.clientRequestId).toMatch(/^mob-/);
    let q = enqueue([], p);
    q = markUploading(q, p.id);
    q = markFailed(q, p.id, 'network down');
    q = retryFailed(q);
    // Retry-safety rests on the SAME id reaching the API on every attempt —
    // the register endpoint dedupes on it.
    expect(q[0].clientRequestId).toBe(p.clientRequestId);
  });
});

describe('one image per slot (local)', () => {
  it('refuses a second queued photo aimed at the same slot', () => {
    const q = enqueue([], make());
    expect(() => enqueue(q, make())).toThrow(/slot/i);
  });

  it('allows the same slot on a different cycle or item', () => {
    let q = enqueue([], make());
    q = enqueue(q, make({ cycleIndex: 1 }));
    q = enqueue(q, make({ inspectionLoopItemId: 'item-2' }));
    expect(q).toHaveLength(3);
  });
});

describe('queue transitions', () => {
  it('done removes the item; conflict and failed retain it', () => {
    const p = make();
    let q = enqueue([], p);
    q = markUploading(q, p.id);
    expect(markDone(q, p.id)).toHaveLength(0);
    // A 409 on a filled slot surfaces as a conflict for a human, NEVER a
    // silent drop — dropping loses evidence.
    expect(markConflict(q, p.id)[0].state).toBe('conflict');
    expect(markFailed(q, p.id, 'timeout')[0].state).toBe('failed');
  });

  it('only pending items are uploadable; retryFailed re-arms failures', () => {
    const a = make();
    const b = make({ inspectionLoopItemId: 'item-2' });
    let q = enqueue(enqueue([], a), b);
    q = markUploading(q, a.id);
    q = markFailed(q, a.id, 'x');
    expect(uploadable(q).map((i) => i.id)).toEqual([b.id]);
    q = retryFailed(q);
    expect(uploadable(q)).toHaveLength(2);
    expect(q.find((i) => i.id === a.id)?.attempts).toBe(1);
  });

  it('a conflict is resolved only by an explicit discard (or retake outside the queue)', () => {
    const p = make();
    let q = markConflict(enqueue([], p), p.id);
    expect(retryFailed(q)).toEqual(q); // retry never touches conflicts
    expect(uploadable(q)).toHaveLength(0);
    q = discardQueued(q, p.id);
    expect(q).toHaveLength(0);
  });
});

describe('effective slot state (server + queue overlay)', () => {
  const serverItems = [
    { id: 'item-1', photos: [{ cycleIndex: 0 }] },
    { id: 'item-2', photos: [] },
  ];

  it('a slot is filled if the server holds a photo OR the queue targets it', () => {
    const q = enqueue([], make({ inspectionLoopItemId: 'item-2', cycleIndex: 0 }));
    expect(effectiveSlotFilled(serverItems, q, 'insp-1', slot)).toBe(true); // server
    expect(
      effectiveSlotFilled(serverItems, q, 'insp-1', { inspectionLoopItemId: 'item-2', cycleIndex: 0 }),
    ).toBe(true); // queue
    expect(
      effectiveSlotFilled(serverItems, q, 'insp-1', { inspectionLoopItemId: 'item-2', cycleIndex: 1 }),
    ).toBe(false);
  });

  it('queue overlay is scoped to the inspection', () => {
    const q = enqueue([], make({ inspectionLoopItemId: 'item-2' }));
    expect(
      effectiveSlotFilled(serverItems, q, 'OTHER', { inspectionLoopItemId: 'item-2', cycleIndex: 0 }),
    ).toBe(false);
    expect(queuedForSlot(q, 'OTHER', { inspectionLoopItemId: 'item-2', cycleIndex: 0 })).toBeUndefined();
  });
});

describe('cursor', () => {
  it('advances item-by-item and rolls to the next unit past the last item', () => {
    expect(advanceCursor(3, { cycleIndex: 0, itemIndex: 1 })).toEqual({ cycleIndex: 0, itemIndex: 2 });
    expect(advanceCursor(3, { cycleIndex: 0, itemIndex: 2 })).toEqual({ cycleIndex: 1, itemIndex: 0 });
  });

  it('retreats in mirror and refuses to go below unit 1 item 1', () => {
    expect(retreatCursor(3, { cycleIndex: 1, itemIndex: 0 })).toEqual({ cycleIndex: 0, itemIndex: 2 });
    expect(retreatCursor(3, { cycleIndex: 0, itemIndex: 0 })).toEqual({ cycleIndex: 0, itemIndex: 0 });
  });
});

describe('canSubmit', () => {
  const clean: CycleStateDto = {
    completedCycles: 2,
    partialCycles: [],
    nextSlot: null,
    totalPhotos: 6,
  };

  it('is blocked while the upload queue is non-empty', () => {
    // Completeness is judged server-side against what the server HOLDS;
    // submitting with photos still on the device evaluates an inspection
    // that does not exist yet.
    expect(canSubmit(clean, 1)).toEqual({ ok: false, reason: 'queue-not-empty' });
  });

  it('is blocked on a partial cycle, naming it', () => {
    const partial: CycleStateDto = {
      ...clean,
      partialCycles: [{ cycleIndex: 2, missingItemIds: ['item-2', 'item-3'] }],
    };
    expect(canSubmit(partial, 0)).toEqual({
      ok: false,
      reason: 'partial-cycle',
      partial: { cycleIndex: 2, missingItemIds: ['item-2', 'item-3'] },
    });
  });

  it('is blocked when no cycle is complete', () => {
    expect(canSubmit({ ...clean, completedCycles: 0 }, 0)).toEqual({
      ok: false,
      reason: 'no-complete-unit',
    });
  });

  it('passes on complete cycles with an empty queue', () => {
    expect(canSubmit(clean, 0)).toEqual({ ok: true });
  });
});
