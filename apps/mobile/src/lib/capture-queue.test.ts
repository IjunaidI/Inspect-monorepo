/**
 * INS-093 — the camera hardening: retakes THROUGH the queue, on-device cache
 * records, automatic retry scheduling, upload timeouts, and the frontier rule
 * that replaced the free "next" button.
 */
import { describe, expect, it } from 'vitest';
import {
  QueuedPhoto,
  activeEntries,
  backoffMs,
  cachedUriForSlot,
  classifyUploadError,
  createQueuedPhoto,
  enqueue,
  entryForSlot,
  filledCursors,
  frontier,
  markConflict,
  markFailed,
  markUploaded,
  nextRetryDelay,
  parseQueue,
  queuedForSlot,
  rearmRetryable,
  resolveConflictAsRetake,
  retryFailed,
  selectNextUpload,
  slotSequence,
  snapCursor,
  staleCache,
  stepCursor,
  supersede,
  uploadable,
  withTimeout,
} from './capture-core';

const slot = { inspectionLoopItemId: 'item-1', cycleIndex: 0 };

function make(overrides: Partial<Parameters<typeof createQueuedPhoto>[0]> = {}): QueuedPhoto {
  return createQueuedPhoto({
    inspectionId: 'insp-1',
    inspectionLoopItemId: 'item-1',
    cycleIndex: 0,
    localUri: `file:///photos/${Math.random().toString(36).slice(2)}.jpg`,
    sha256: 'ab'.repeat(32),
    ...overrides,
  });
}

describe('intent: fill vs replace', () => {
  it('defaults to fill; a retake is a replace carrying the server photo it replaces', () => {
    expect(make().intent).toBe('fill');
    const r = make({ intent: 'replace', retakeOf: 'photo-9' });
    expect(r.intent).toBe('replace');
    expect(r.retakeOf).toBe('photo-9');
  });

  it('supersede replaces the ACTIVE entry for the slot and hands it back for cleanup', () => {
    const first = make();
    const q = enqueue([], first);
    const second = make();
    const res = supersede(q, second);
    // The inspector went back and re-shot before the first upload landed: the
    // first shot is dead weight (its upload gets aborted, its bytes deleted).
    expect(res.superseded?.id).toBe(first.id);
    expect(res.queue.map((e) => e.id)).toEqual([second.id]);
    expect(res.queue[0].intent).toBe('replace');
    expect(activeEntries(res.queue)).toHaveLength(1);
  });

  it('supersede inherits the server identity of a mid-flight entry that already targets one', () => {
    const landed: QueuedPhoto = { ...make(), state: 'uploaded', photoId: 'photo-1' };
    const again = make();
    const r1 = supersede([landed], again);
    // A cache record is not active work, so nothing is superseded — the
    // screen passes `retakeOf` explicitly from the server photo in that case.
    expect(r1.superseded).toBeUndefined();
    expect(r1.queue).toHaveLength(2);

    const inflight: QueuedPhoto = { ...make(), state: 'pending', retakeOf: 'photo-1' };
    const third = make();
    const r2 = supersede([inflight], third);
    expect(r2.superseded?.id).toBe(inflight.id);
    expect(r2.queue[0].retakeOf).toBe('photo-1');
  });

  it('a conflict resolved as "keep mine" becomes a replace and goes back to work', () => {
    const p = make();
    let q = markConflict(enqueue([], p), p.id);
    q = resolveConflictAsRetake(q, p.id);
    expect(q[0]).toMatchObject({ state: 'pending', intent: 'replace' });
    expect(uploadable(q)).toHaveLength(1);
  });
});

describe('cache records (uploaded)', () => {
  it('markUploaded keeps the entry as a cache record, not as work', () => {
    const p = make();
    const { queue: q, evicted } = markUploaded(enqueue([], p), p.id, 'photo-1', 1_000);
    expect(evicted).toEqual([]);
    expect(q[0]).toMatchObject({ state: 'uploaded', photoId: 'photo-1' });
    // Submit-gate arithmetic counts WORK only; the cached bytes must not block.
    expect(activeEntries(q)).toHaveLength(0);
    expect(queuedForSlot(q, 'insp-1', slot)).toBeUndefined();
    expect(entryForSlot(q, 'insp-1', slot)?.id).toBe(p.id);
  });

  it('a retake that lands evicts the older cache record for the same slot', () => {
    const first: QueuedPhoto = { ...make(), state: 'uploaded', photoId: 'photo-1' };
    const retake = make({ intent: 'replace', retakeOf: 'photo-1' });
    const { queue: q, evicted } = markUploaded([first, retake], retake.id, 'photo-1');
    expect(evicted.map((e) => e.id)).toEqual([first.id]);
    expect(q.map((e) => e.id)).toEqual([retake.id]);
  });

  it('serves the cached bytes for a slot only when they match what the server holds', () => {
    const cached: QueuedPhoto = { ...make(), state: 'uploaded', photoId: 'photo-1' };
    expect(cachedUriForSlot([cached], 'insp-1', slot)).toBe(cached.localUri);
    expect(cachedUriForSlot([cached], 'insp-1', slot, cached.sha256)).toBe(cached.localUri);
    // Retaken on another device: our bytes are stale evidence — do not show them.
    expect(cachedUriForSlot([cached], 'insp-1', slot, 'cd'.repeat(32))).toBeUndefined();
    // Active work always shows (it is what the inspector just shot).
    const active = make({ inspectionLoopItemId: 'item-2' });
    expect(
      cachedUriForSlot([active], 'insp-1', { inspectionLoopItemId: 'item-2', cycleIndex: 0 }, 'zz'),
    ).toBe(active.localUri);
  });

  it('staleCache sweeps only old uploaded records', () => {
    const old: QueuedPhoto = { ...make(), state: 'uploaded', uploadedAt: new Date(0).toISOString() };
    const fresh: QueuedPhoto = {
      ...make(),
      state: 'uploaded',
      uploadedAt: new Date(5_000).toISOString(),
    };
    const work = make();
    expect(staleCache([old, fresh, work], 10_000, 8_000).map((e) => e.id)).toEqual([old.id]);
  });
});

describe('retry scheduling', () => {
  it('backs off on a ladder and caps', () => {
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(5_000);
    expect(backoffMs(99)).toBe(60_000);
  });

  it('a failure is not uploadable until its backoff elapses; retryFailed makes it immediate', () => {
    const p = make();
    let q = markFailed(enqueue([], p), p.id, 'net', 1_000);
    expect(q[0].nextAttemptAt).toBe(3_000);
    expect(uploadable(q, 1_500)).toHaveLength(0);
    expect(nextRetryDelay(q, 1_500)).toBe(1_500);
    expect(uploadable(q, 3_000)).toHaveLength(1);
    q = retryFailed(q);
    expect(uploadable(q, 1_500)).toHaveLength(1);
    expect(nextRetryDelay(q, 1_500)).toBeNull();
  });

  it('retryFailed can be scoped to one inspection', () => {
    const mine = make();
    const other = make({ inspectionId: 'OTHER' });
    let q = markFailed(markFailed([mine, other], mine.id, 'x', 0), other.id, 'x', 0);
    q = retryFailed(q, 'insp-1');
    expect(q.find((e) => e.id === mine.id)?.state).toBe('pending');
    expect(q.find((e) => e.id === other.id)?.state).toBe('failed');
  });

  it('selectNextUpload prefers pending work, then the oldest capture', () => {
    const a = make({ capturedAt: '2026-01-01T00:00:02Z' });
    const b = make({ inspectionLoopItemId: 'item-2', capturedAt: '2026-01-01T00:00:01Z' });
    let q = enqueue(enqueue([], a), b);
    expect(selectNextUpload(q, 0)?.id).toBe(b.id);
    q = markFailed(q, b.id, 'x', 0);
    expect(selectNextUpload(q, 0)?.id).toBe(a.id);
    q = markFailed(q, a.id, 'x', 0);
    expect(selectNextUpload(q, 0)).toBeUndefined();
    expect(selectNextUpload(q, 2_000)?.id).toBe(b.id);
  });

  it('parseQueue re-arms entries that were uploading when the app died and defaults legacy intent', () => {
    const p: QueuedPhoto = { ...make(), state: 'uploading' };
    const legacy = { ...make({ inspectionLoopItemId: 'item-2' }) } as Record<string, unknown>;
    delete legacy.intent; // a pre-INS-093 persisted entry
    const parsed = parseQueue(JSON.stringify([p, legacy]));
    expect(parsed[0].state).toBe('pending');
    expect(parsed[1].intent).toBe('fill');
  });
});

describe('frontier + slot sequence (no free "next")', () => {
  it('an empty loop starts at unit 1 item 1', () => {
    expect(frontier(3, [])).toEqual({ cycleIndex: 0, itemIndex: 0 });
    expect(slotSequence(3, [])).toEqual([{ cycleIndex: 0, itemIndex: 0 }]);
  });

  it('the frontier is the first missing item of the lowest partial unit', () => {
    const filled = [
      { cycleIndex: 0, itemIndex: 0 },
      { cycleIndex: 0, itemIndex: 2 },
    ];
    expect(frontier(3, filled)).toEqual({ cycleIndex: 0, itemIndex: 1 });
  });

  it('a complete unit opens a NEW unit above the highest index — discard gaps are never refilled', () => {
    // Unit 2 (index 1) was discarded; unit 3 (index 2) is complete.
    const filled = [0, 1, 2].flatMap((itemIndex) => [
      { cycleIndex: 0, itemIndex },
      { cycleIndex: 2, itemIndex },
    ]);
    expect(frontier(3, filled)).toEqual({ cycleIndex: 3, itemIndex: 0 });
    const seq = slotSequence(3, filled);
    expect(seq).toHaveLength(7);
    expect(seq.some((c) => c.cycleIndex === 1)).toBe(false);
    expect(seq[seq.length - 1]).toEqual({ cycleIndex: 3, itemIndex: 0 });
  });

  it('the cursor steps only across filled slots and the frontier, clamped', () => {
    const filled = [
      { cycleIndex: 0, itemIndex: 0 },
      { cycleIndex: 0, itemIndex: 1 },
    ];
    const seq = slotSequence(3, filled); // + frontier (0,2)
    expect(stepCursor(seq, { cycleIndex: 0, itemIndex: 0 }, 1)).toEqual({
      cycleIndex: 0,
      itemIndex: 1,
    });
    expect(stepCursor(seq, { cycleIndex: 0, itemIndex: 1 }, 1)).toEqual({
      cycleIndex: 0,
      itemIndex: 2,
    });
    // Cannot step past the frontier: there is nothing to stand on.
    expect(stepCursor(seq, { cycleIndex: 0, itemIndex: 2 }, 1)).toEqual({
      cycleIndex: 0,
      itemIndex: 2,
    });
    expect(stepCursor(seq, { cycleIndex: 0, itemIndex: 0 }, -1)).toEqual({
      cycleIndex: 0,
      itemIndex: 0,
    });
  });

  it('a cursor whose unit was discarded snaps to the frontier', () => {
    const filled = [{ cycleIndex: 0, itemIndex: 0 }];
    const seq = slotSequence(3, filled);
    const f = frontier(3, filled);
    expect(snapCursor(seq, f, { cycleIndex: 0, itemIndex: 0 })).toEqual({
      cycleIndex: 0,
      itemIndex: 0,
    });
    expect(snapCursor(seq, f, { cycleIndex: 4, itemIndex: 1 })).toEqual(f);
  });

  it('filledCursors overlays device work AND cache records on the server photos', () => {
    const server = [
      { id: 'a', photos: [{ cycleIndex: 0 }] },
      { id: 'b', photos: [] },
      { id: 'c', photos: [] },
    ];
    const work = make({ inspectionLoopItemId: 'b' });
    const cached: QueuedPhoto = { ...make({ inspectionLoopItemId: 'c' }), state: 'uploaded' };
    const other = make({ inspectionId: 'OTHER', inspectionLoopItemId: 'c' });
    const filled = filledCursors(server, [work, cached, other], 'insp-1');
    expect(filled).toEqual([
      { cycleIndex: 0, itemIndex: 0 },
      { cycleIndex: 0, itemIndex: 1 },
      { cycleIndex: 0, itemIndex: 2 },
    ]);
    expect(frontier(server.length, filled)).toEqual({ cycleIndex: 1, itemIndex: 0 });
  });
});

describe('withTimeout', () => {
  it('rejects with a TimeoutError and fires onTimeout when the deadline passes', async () => {
    let aborted = false;
    const never = new Promise<never>(() => {});
    await expect(
      withTimeout(never, 5, 'storage PUT', () => {
        aborted = true;
      }),
    ).rejects.toThrow(/timed out/);
    expect(aborted).toBe(true);
  });

  it('passes a value through when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 50, 'x')).resolves.toBe(42);
  });
});

// ── Network handling: failure classes, offline pause, reconnect re-arm ──────


describe('failure classification', () => {
  it('server refusals (4xx) are permanent; 5xx/429/timeouts are transient', () => {
    expect(classifyUploadError({ status: 400, message: 'bad' })).toBe('permanent');
    expect(classifyUploadError({ status: 413, message: 'too large' })).toBe('permanent');
    expect(classifyUploadError({ status: 500, message: 'boom' })).toBe('transient');
    expect(classifyUploadError({ status: 429, message: 'slow down' })).toBe('transient');
    expect(classifyUploadError({ name: 'TimeoutError', message: 'x timed out' })).toBe('transient');
  });

  it('a socket-level failure is offline when the network state is unknown or down', () => {
    expect(classifyUploadError(new TypeError('Network request failed'))).toBe('offline');
    expect(classifyUploadError(new TypeError('Network request failed'), false)).toBe('offline');
    // The OS says we are online but the request still died: a hiccup, not an outage.
    expect(classifyUploadError(new TypeError('Network request failed'), true)).toBe('transient');
    expect(classifyUploadError(new Error('anything'), false)).toBe('offline');
  });

  it('missing bytes on disk are permanent — no retry can produce them', () => {
    expect(classifyUploadError(new Error('The photo file is missing on this device'))).toBe(
      'permanent',
    );
  });
});

describe('failed entries by kind', () => {
  it('permanent failures never come due and are skipped by the drain', () => {
    const p = make();
    const q = markFailed(enqueue([], p), p.id, 'refused', 1_000, 'permanent');
    expect(q[0].failureKind).toBe('permanent');
    expect(uploadable(q, Number.MAX_SAFE_INTEGER - 1)).toHaveLength(0);
    expect(nextRetryDelay(q, 1_000)).toBeNull();
    expect(selectNextUpload(q, 10 ** 15)).toBeUndefined();
  });

  it('rearmRetryable wakes offline/transient failures but leaves permanent ones for a human', () => {
    const off = make();
    const tr = make({ inspectionLoopItemId: 'item-2' });
    const perm = make({ inspectionLoopItemId: 'item-3' });
    let q = [off, tr, perm];
    q = markFailed(q, off.id, 'net', 0, 'offline');
    q = markFailed(q, tr.id, '503', 0, 'transient');
    q = markFailed(q, perm.id, '400', 0, 'permanent');
    q = rearmRetryable(q);
    expect(q.map((e) => e.state)).toEqual(['pending', 'pending', 'failed']);
    // An explicit human retry re-arms everything, permanent included.
    expect(retryFailed(q).every((e) => e.state === 'pending')).toBe(true);
    expect(retryFailed(q).every((e) => e.failureKind === undefined)).toBe(true);
  });
});
