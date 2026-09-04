/**
 * The capture loop (INS-086 Phase 3, hardened in INS-093) — mobile's port of
 * the web populate screen. Behaviour comes from the screen contract + the
 * domain invariants; the LAYOUT deliberately does not: a phone gets a
 * full-screen camera showing one slot at a time.
 *
 * How the loop moves (INS-093):
 *  - There is NO free "next". The cursor walks the slots that already hold
 *    evidence plus exactly one empty slot — the frontier — and the only way to
 *    open a new slot is to shoot the frontier. A unit cannot be left with a hole.
 *  - Going back is instant: shots are served from the device (`SlotImage`),
 *    uploads run in the background (`photoQueue`) and keep running after the
 *    screen is left. A retake is just another capture with `intent: 'replace'`;
 *    it never waits for the network.
 *  - Ending the loop with uploads outstanding opens the upload sheet in
 *    finishing mode: failures are re-armed, progress is shown, and submit
 *    follows automatically once every photo is on the server.
 *  - Every photo stays on the device until the loop ends successfully (or the
 *    inspection is found locked), then the cache for it is purged.
 *
 * Decisions live in `@/lib/capture-core` (pure, unit-tested); network and
 * files live in `@/lib/photo-queue`. This file is the stateful glue.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { isLockedStatus } from '@inspect/domain';
import type { DefectCatalogDto, InspectionDto, PhotoDto } from '@inspect/shared-types';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EndGate } from '@/components/capture/end-gate';
import { Gallery } from '@/components/capture/gallery';
import { SlotImage } from '@/components/capture/slot-image';
import { stateLabel, ui } from '@/components/capture/ui';
import { measurementFor, UnitSheet } from '@/components/capture/unit-sheet';
import { UploadSheet } from '@/components/capture/upload-sheet';
import { BackButton } from '@/components/back-button';
import {
  activeEntries,
  cachedUriForSlot,
  canSubmit,
  createQueuedPhoto,
  entryForSlot,
  filledCursors,
  frontier as frontierOf,
  sameCursor,
  slotSequence,
  snapCursor,
  stepCursor,
  type Cursor,
  type QueuedPhoto,
} from '@/lib/capture-core';
import { hashFile, photoQueue, stashCapture, summarize, type QueueSnapshot } from '@/lib/photo-queue';
import { client } from '@/lib/session';

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; inspection: InspectionDto; catalog: DefectCatalogDto[] };

type Sheet = 'none' | 'unit' | 'endgate' | 'uploads' | 'gallery';

/** Idempotency token for one add-defect write (INS-016). Minted per tap, outside render. */
function newDefectRequestId(): string {
  return `mob-defect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Pure fetch — no component state captured, so effects may call it freely. */
async function fetchCapture(inspectionId: string): Promise<Load> {
  try {
    const [inspection, catalog] = await Promise.all([
      client.get<InspectionDto>(`/inspections/${inspectionId}/populate`),
      client.get<DefectCatalogDto[]>('/defect-catalog').catch(() => [] as DefectCatalogDto[]),
    ]);
    return { kind: 'ready', inspection, catalog };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
    return { kind: 'error', message: e instanceof Error ? e.message : 'Load failed' };
  }
}

export default function Capture() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspectionId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [snap, setSnap] = useState<QueueSnapshot>(() => photoQueue().snapshot());
  /** null = "follow the frontier"; set once the inspector navigates by hand. */
  const [rawCursor, setRawCursor] = useState<Cursor | null>(null);
  const [busy, setBusy] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>('none');
  const [retakeMode, setRetakeMode] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const inspection = load.kind === 'ready' ? load.inspection : null;
  const items = useMemo(() => inspection?.items ?? [], [inspection]);
  const locked = inspection ? isLockedStatus(inspection.status) : false;

  const refetch = useCallback(async (): Promise<InspectionDto | null> => {
    const result = await fetchCapture(inspectionId);
    setLoad(result);
    return result.kind === 'ready' ? result.inspection : null;
  }, [inspectionId]);

  // Initial load + follow the queue. A registered upload changes what the
  // server holds (photoId, viewUrl, tag-ability), so each landing refetches.
  useEffect(() => {
    let cachedBefore = summarize(photoQueue().snapshot().queue, inspectionId).cached;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = photoQueue().subscribe((s) => {
      setSnap(s);
      const cachedNow = summarize(s.queue, inspectionId).cached;
      if (cachedNow !== cachedBefore) {
        cachedBefore = cachedNow;
        if (refetchTimer) clearTimeout(refetchTimer);
        refetchTimer = setTimeout(() => void refetch(), 400);
      }
    });
    void fetchCapture(inspectionId).then((result) => {
      setLoad(result);
      if (result.kind === 'ready' && isLockedStatus(result.inspection.status)) {
        // The loop is over — the on-device cache has served its purpose.
        photoQueue().purgeInspection(inspectionId);
      }
    });
    photoQueue().kick(true);
    return () => {
      unsubscribe();
      if (refetchTimer) clearTimeout(refetchTimer);
    };
  }, [inspectionId, refetch]);

  // ── Slot geometry ─────────────────────────────────────────────────────────

  const queue = snap.queue;
  const filled = useMemo(
    () => filledCursors(items, queue, inspectionId),
    [items, queue, inspectionId],
  );
  const frontier = useMemo(() => frontierOf(items.length, filled), [items.length, filled]);
  const sequence = useMemo(() => slotSequence(items.length, filled), [items.length, filled]);
  const cursor: Cursor = rawCursor ? snapCursor(sequence, frontier, rawCursor) : frontier;
  const atFrontier = sameCursor(cursor, frontier);
  const seqIndex = sequence.findIndex((c) => sameCursor(c, cursor));

  const currentItem = items[cursor.itemIndex];
  const slot = currentItem
    ? { inspectionLoopItemId: currentItem.id, cycleIndex: cursor.cycleIndex }
    : null;
  const serverPhoto: PhotoDto | undefined = currentItem?.photos?.find(
    (p) => p.cycleIndex === cursor.cycleIndex,
  );
  const slotEntry = slot ? entryForSlot(queue, inspectionId, slot) : undefined;
  const localUri = slot
    ? cachedUriForSlot(queue, inspectionId, slot, serverPhoto?.contentHash)
    : undefined;
  const slotHasEvidence = Boolean(serverPhoto || slotEntry);

  const counts = summarize(queue, inspectionId);
  const myActive = useMemo(() => activeEntries(queue, inspectionId), [queue, inspectionId]);
  const inflight = myActive.find((q) => q.state === 'uploading');

  // ── Actions ───────────────────────────────────────────────────────────────

  async function capture() {
    if (!cameraRef.current || !slot || shooting || !cameraReady) return;
    setShooting(true);
    setActionError(null);
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!shot?.uri) throw new Error('The camera returned no image');
      // Freeze the frame on screen while we hash + stash — the inspector sees
      // their shot, not a spinner over a live viewfinder.
      setPreview(shot.uri);
      // Hash-at-capture, before the bytes can be touched again.
      const sha256 = await hashFile(shot.uri);
      const intent = retakeMode || slotHasEvidence ? 'replace' : 'fill';
      const entry = createQueuedPhoto({
        inspectionId,
        inspectionLoopItemId: slot.inspectionLoopItemId,
        cycleIndex: slot.cycleIndex,
        localUri: shot.uri,
        sha256,
        intent,
        retakeOf: serverPhoto?.id,
      });
      entry.localUri = stashCapture(shot.uri, entry.id);
      photoQueue().add(entry);
      if (intent === 'fill') {
        setRawCursor(null); // follow the frontier to the next empty slot
      } else {
        setRawCursor(cursor); // stay: show the retake where it was taken
        setRetakeMode(false);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Capture failed');
    } finally {
      setPreview(null);
      setShooting(false);
    }
  }

  async function post(path: string, body: unknown) {
    setBusy(true);
    setActionError(null);
    try {
      await client.post(path, body);
      await refetch();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function tagDefect(catalogItem: DefectCatalogDto) {
    if (!slot) return;
    await post(`/inspections/${inspectionId}/populate/defects`, {
      defectCatalogId: catalogItem.id,
      severity: catalogItem.defaultSeverity,
      inspectionLoopItemId: slot.inspectionLoopItemId,
      cycleIndex: slot.cycleIndex,
      clientRequestId: newDefectRequestId(),
    });
  }

  async function saveMeasurement(label: string, unit: string | undefined, value: string) {
    const existing = measurementFor(inspection?.measurements, cursor.cycleIndex, label);
    if ((existing?.recordedValue ?? '') === value) return;
    await post(`/inspections/${inspectionId}/populate/measurements`, {
      cycleIndex: cursor.cycleIndex,
      label,
      unit,
      recordedValue: value,
    });
  }

  async function discardUnit(cycleIndex: number) {
    setBusy(true);
    setActionError(null);
    try {
      await client.del(`/inspections/${inspectionId}/populate/cycles/${cycleIndex}`);
      photoQueue().discardCycle(inspectionId, cycleIndex);
      setSheet('none');
      setRawCursor(null);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Discard failed');
    } finally {
      setBusy(false);
    }
  }

  /** Re-check the server, then submit or explain. Called only with an empty queue. */
  const submitIfClean = useCallback(async () => {
    const fresh = await refetch();
    const state = fresh?.cycleState;
    if (!state) return;
    const verdict = canSubmit(state, summarize(photoQueue().snapshot().queue, inspectionId).active);
    if (!verdict.ok) {
      setSheet('endgate');
      return;
    }
    Alert.alert(
      'End loop?',
      `${state.completedCycles} complete unit${state.completedCycles === 1 ? '' : 's'} will be submitted to QA for review. This cannot be undone.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Submit',
          style: 'default',
          onPress: async () => {
            const ok = await post(`/inspections/${inspectionId}/submit`, {
              deviceId: `mobile-${Device.modelName ?? 'unknown'}`,
            });
            if (ok) {
              photoQueue().purgeInspection(inspectionId);
              router.replace(`/inspections/${inspectionId}/review`);
            }
          },
        },
      ],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- post/router are stable for this screen
  }, [inspectionId, refetch]);

  function endLoop() {
    if (counts.active > 0) {
      // Finishing mode: re-arm failures, show the queue landing, submit after.
      setFinishing(true);
      setSheet('uploads');
      photoQueue().retryNow(inspectionId);
      return;
    }
    void submitIfClean();
  }

  // Finishing mode completes itself when the last upload lands.
  useEffect(() => {
    if (!finishing || counts.active > 0) return;
    const t = setTimeout(() => {
      setFinishing(false);
      setSheet('none');
      void submitIfClean();
    }, 300);
    return () => clearTimeout(t);
  }, [finishing, counts.active, submitIfClean]);

  function jumpTo(c: Cursor) {
    setRetakeMode(false);
    setRawCursor(c);
    setSheet('none');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (load.kind === 'loading') {
    return (
      <SafeAreaView style={[ui.screen, ui.center]}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  }
  if (load.kind === 'missing' || load.kind === 'error') {
    return (
      <SafeAreaView style={[ui.screen, ui.center]}>
        <Text style={ui.errorText}>
          {load.kind === 'missing' ? 'Inspection not found.' : load.message}
        </Text>
        {load.kind === 'error' ? (
          <Pressable onPress={() => void refetch()}>
            <Text style={ui.link}>Try again</Text>
          </Pressable>
        ) : null}
        <BackButton />
      </SafeAreaView>
    );
  }
  if (!items.length) {
    return (
      <SafeAreaView style={[ui.screen, ui.center]}>
        <Text style={ui.errorText}>No loop items defined on this inspection.</Text>
        <BackButton />
      </SafeAreaView>
    );
  }

  const state = inspection!.cycleState;
  const target = inspection!.computedSampling?.sampleSize;
  const showCamera = !locked && (atFrontier || retakeMode);
  const stageBadge = slotEntry
    ? stateLabel(slotEntry.state, snap.progress[slotEntry.id])
    : serverPhoto
      ? stateLabel('server')
      : null;
  const lastShot = [...queue]
    .filter((q) => q.inspectionId === inspectionId)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];

  return (
    <SafeAreaView style={ui.screen}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton
          label="Close"
          onPress={() => {
            if (counts.active > 0) {
              Alert.alert(
                'Uploads still running',
                `${counts.active} photo${counts.active === 1 ? ' is' : 's are'} still uploading. They keep going in the background while the app stays open, and resume when you come back.`,
                [
                  { text: 'Stay', style: 'cancel' },
                  { text: 'Leave', onPress: () => router.back() },
                ],
              );
            } else {
              router.back();
            }
          }}
        />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {inspection!.purchaseOrder?.poNumber ?? 'Capture'}
          </Text>
          <Text style={styles.headerSub}>
            Unit {cursor.cycleIndex + 1}
            {target ? ` of ${target}` : ''} · {cursor.itemIndex + 1}/{items.length}
          </Text>
        </View>
        {locked ? (
          <Text style={styles.lockedBadge}>Read-only</Text>
        ) : (
          <Pressable onPress={endLoop} disabled={busy} hitSlop={8} accessibilityRole="button">
            <Text style={[ui.link, busy && ui.dim]}>End loop</Text>
          </Pressable>
        )}
      </View>

      {/* Upload strip — tap for the full sheet */}
      {counts.active > 0 ? (
        <Pressable style={styles.strip} onPress={() => setSheet('uploads')}>
          <View style={styles.stripRow}>
            {counts.uploading > 0 ? <ActivityIndicator size="small" color={palette.accent} /> : null}
            <Text style={styles.stripText} numberOfLines={1}>
              {counts.uploading > 0 ? `${counts.uploading} uploading` : null}
              {counts.uploading > 0 && (counts.failed > 0 || counts.conflicts > 0) ? ' · ' : null}
              {counts.failed > 0 ? `${counts.failed} failed, retrying` : null}
              {counts.failed > 0 && counts.conflicts > 0 ? ' · ' : null}
              {counts.conflicts > 0
                ? `${counts.conflicts} need${counts.conflicts === 1 ? 's' : ''} your decision`
                : null}
            </Text>
            <Text style={ui.link}>Details</Text>
          </View>
          {inflight ? (
            <View style={ui.progressTrack}>
              <View
                style={[
                  ui.progressFill,
                  { width: `${Math.round((snap.progress[inflight.id] ?? 0) * 100)}%` },
                ]}
              />
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {locked ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            This inspection is {inspection!.status.replace(/_/g, ' ').toLowerCase()} and can no
            longer be populated. Corrections require a new linked re-inspection.
          </Text>
        </View>
      ) : null}
      {actionError ? (
        <Pressable style={styles.notice} onPress={() => setActionError(null)}>
          <Text style={styles.noticeError} numberOfLines={3}>
            {actionError}
          </Text>
        </Pressable>
      ) : null}

      {/* The slot */}
      <View style={styles.stage}>
        <View style={styles.stageFrame}>
          {showCamera ? (
            permission?.granted ? (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                animateShutter={false}
                onCameraReady={() => setCameraReady(true)}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, ui.center]}>
                <Text style={[ui.errorText, { color: '#fff' }]}>
                  Camera permission is required to capture.
                </Text>
                <Pressable onPress={requestPermission} style={ui.btn}>
                  <Text style={ui.btnLabel}>Grant camera access</Text>
                </Pressable>
              </View>
            )
          ) : (
            <SlotImage
              localUri={localUri}
              remoteUri={serverPhoto?.viewUrl}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              emptyLabel={slotHasEvidence ? 'Photo saved — preview unavailable' : 'No photo'}
            />
          )}

          {/* Frozen frame while the shot is hashed + stashed */}
          {preview ? (
            <View style={StyleSheet.absoluteFill}>
              <Image source={{ uri: preview }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={[styles.pill, styles.pillCenter]}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.pillText}>Saving…</Text>
              </View>
            </View>
          ) : null}

          {/* Item overlay */}
          <View style={styles.slotHeader} pointerEvents="none">
            <Text style={styles.itemName} numberOfLines={1}>
              {currentItem?.itemName}
            </Text>
            {currentItem?.description ? (
              <Text style={styles.itemDesc} numberOfLines={2}>
                {currentItem.description}
              </Text>
            ) : null}
          </View>

          {/* State badge */}
          {!showCamera && stageBadge ? (
            <View style={[styles.pill, styles.pillBottomLeft, { backgroundColor: stageBadge.bg }]}>
              <Text style={[styles.pillText, { color: stageBadge.color }]}>{stageBadge.text}</Text>
            </View>
          ) : null}
          {retakeMode ? (
            <View style={[styles.pill, styles.pillBottomLeft, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
              <Text style={styles.pillText}>
                Retaking · unit {cursor.cycleIndex + 1} · {currentItem?.itemName}
              </Text>
            </View>
          ) : null}
          {showCamera && !retakeMode && !locked && permission?.granted ? (
            <View style={[styles.pill, styles.pillBottomLeft, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
              <Text style={styles.pillText}>Next shot</Text>
            </View>
          ) : null}
        </View>

        {/* Slot dots for the current unit — reachable ones only */}
        <View style={styles.dots}>
          {items.map((item, i) => {
            const c = { cycleIndex: cursor.cycleIndex, itemIndex: i };
            const reachable = sequence.some((s) => sameCursor(s, c));
            const isFilled = reachable && !sameCursor(c, frontier);
            return (
              <Pressable
                key={item.id}
                disabled={!reachable}
                onPress={() => jumpTo(c)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={item.itemName}
                style={[
                  styles.dot,
                  isFilled && styles.dotFilled,
                  sameCursor(c, frontier) && styles.dotFrontier,
                  i === cursor.itemIndex && styles.dotCurrent,
                  !reachable && ui.dim,
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* Navigation: only across shot slots + the frontier */}
      <View style={styles.nav}>
        <Pressable
          onPress={() => jumpTo(stepCursor(sequence, cursor, -1))}
          disabled={seqIndex <= 0}
          hitSlop={8}
          style={[styles.navBtn, seqIndex <= 0 && ui.dim]}
          accessibilityRole="button"
          accessibilityLabel="Previous shot"
        >
          <Text style={styles.navGlyph}>‹</Text>
          <Text style={ui.link}>Prev</Text>
        </Pressable>
        <Pressable
          onPress={() => setRawCursor(null)}
          disabled={atFrontier}
          hitSlop={8}
          style={[styles.navCenter, atFrontier && { opacity: 0 }]}
          accessibilityRole="button"
        >
          <Text style={styles.jump}>Jump to next shot ⇥</Text>
        </Pressable>
        <Pressable
          onPress={() => jumpTo(stepCursor(sequence, cursor, 1))}
          disabled={atFrontier || seqIndex < 0 || seqIndex >= sequence.length - 1}
          hitSlop={8}
          style={[
            styles.navBtn,
            (atFrontier || seqIndex >= sequence.length - 1) && ui.dim,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Next shot"
        >
          <Text style={ui.link}>Next</Text>
          <Text style={styles.navGlyph}>›</Text>
        </Pressable>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable
          style={styles.galleryBtn}
          onPress={() => setSheet('gallery')}
          accessibilityRole="button"
          accessibilityLabel="Open gallery"
        >
          {lastShot ? (
            <SlotImage localUri={lastShot.localUri} style={StyleSheet.absoluteFill} />
          ) : (
            <Text style={styles.galleryGlyph}>▦</Text>
          )}
          <View style={styles.galleryCount}>
            <Text style={styles.galleryCountText}>{filled.length}</Text>
          </View>
        </Pressable>

        {showCamera ? (
          <Pressable
            style={[styles.shutter, (shooting || !permission?.granted || !cameraReady) && ui.dim]}
            disabled={shooting || !permission?.granted || !cameraReady}
            onPress={capture}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
          >
            {shooting ? <ActivityIndicator color="#fff" /> : <View style={styles.shutterInner} />}
          </Pressable>
        ) : (
          <View style={ui.rowButtons}>
            {!locked && slotHasEvidence ? (
              <Pressable
                style={ui.btnGhost}
                onPress={() => setRetakeMode(true)}
                accessibilityRole="button"
              >
                <Text style={ui.btnGhostLabel}>Retake</Text>
              </Pressable>
            ) : null}
            <Pressable style={ui.btn} onPress={() => setSheet('unit')} accessibilityRole="button">
              <Text style={ui.btnLabel}>Defects & measurements</Text>
            </Pressable>
          </View>
        )}

        {retakeMode ? (
          <Pressable
            style={styles.sideBtn}
            onPress={() => setRetakeMode(false)}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={ui.link}>Cancel</Text>
          </Pressable>
        ) : showCamera ? (
          <Pressable
            style={styles.sideBtn}
            onPress={() => setSheet('unit')}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={ui.link}>Unit notes</Text>
          </Pressable>
        ) : (
          <View style={styles.sideBtn} />
        )}
      </View>

      <Text style={styles.progress}>
        {state
          ? `${state.completedCycles} unit${state.completedCycles === 1 ? '' : 's'} complete`
          : ''}
        {target ? ` / ${target} target — end on any complete unit` : ''}
        {counts.active > 0 ? `  ·  ${counts.active} uploading` : ''}
      </Text>

      {/* Unit sheet: defects + measurements */}
      <Modal
        visible={sheet === 'unit'}
        animationType="slide"
        transparent
        onRequestClose={() => setSheet('none')}
      >
        <View style={ui.sheetBackdrop}>
          <View style={ui.sheetBody}>
            <View style={ui.sheetHandleRow}>
              <Text style={ui.sheetTitle}>
                Unit {cursor.cycleIndex + 1} · {currentItem?.itemName}
              </Text>
              <Pressable onPress={() => setSheet('none')} hitSlop={8}>
                <Text style={ui.link}>Done</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <UnitSheet
                catalog={load.kind === 'ready' ? load.catalog : []}
                inspection={inspection!}
                cursor={cursor}
                canTag={!locked && Boolean(serverPhoto)}
                pendingUpload={!serverPhoto && Boolean(slotEntry)}
                busy={busy}
                onTag={tagDefect}
                onCustom={(text, sev) =>
                  slot
                    ? post(`/inspections/${inspectionId}/populate/defects`, {
                        customText: text,
                        severity: sev,
                        inspectionLoopItemId: slot.inspectionLoopItemId,
                        cycleIndex: slot.cycleIndex,
                      })
                    : Promise.resolve(false)
                }
                onMeasure={saveMeasurement}
                readOnly={locked}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* End-loop gate (server verdicts) */}
      <Modal
        visible={sheet === 'endgate'}
        animationType="fade"
        transparent
        onRequestClose={() => setSheet('none')}
      >
        <View style={[ui.sheetBackdrop, ui.center]}>
          <View style={ui.gateBody}>
            <EndGate
              verdict={
                state ? canSubmit(state, counts.active) : { ok: false, reason: 'no-complete-unit' }
              }
              items={items}
              busy={busy}
              // The frontier IS the first missing slot of the lowest partial
              // unit — land on it, not on item 1 of the unit.
              onFinish={() => {
                setRetakeMode(false);
                setRawCursor(null);
                setSheet('none');
              }}
              onDiscard={discardUnit}
              onCancel={() => setSheet('none')}
            />
          </View>
        </View>
      </Modal>

      {/* Upload status / finishing */}
      <UploadSheet
        visible={sheet === 'uploads'}
        title={finishing ? 'Finishing uploads' : 'Uploads'}
        subtitle={
          finishing
            ? `${counts.active} photo${counts.active === 1 ? '' : 's'} still to land — the loop ends as soon as they do.`
            : 'Photos on their way to the server. Failures retry on their own.'
        }
        entries={myActive}
        progress={snap.progress}
        items={items}
        busy={busy}
        onRetryAll={() => photoQueue().retryNow(inspectionId)}
        onKeepMine={(e: QueuedPhoto) => photoQueue().resolveConflictKeepMine(e.id)}
        onDiscard={(e: QueuedPhoto) =>
          Alert.alert(
            'Discard this photo?',
            'The shot is deleted from this device and its slot opens again for a new photo.',
            [
              { text: 'Keep', style: 'cancel' },
              {
                text: 'Discard',
                style: 'destructive',
                onPress: () => {
                  photoQueue().discard(e.id);
                  setRawCursor(null);
                },
              },
            ],
          )
        }
        onClose={() => {
          setFinishing(false);
          setSheet('none');
        }}
        footer={
          finishing && counts.conflicts > 0 ? (
            <Text style={ui.hint}>
              Resolve the decision{counts.conflicts === 1 ? '' : 's'} above to continue.
            </Text>
          ) : null
        }
      />

      <Gallery
        visible={sheet === 'gallery'}
        onClose={() => setSheet('none')}
        inspectionId={inspectionId}
        items={items}
        queue={queue}
        progress={snap.progress}
        sequence={sequence}
        frontier={frontier}
        cursor={cursor}
        target={target}
        onJump={jumpTo}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.panel,
  },
  headerTitle: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  headerSub: { color: palette.sub, fontSize: 12, marginTop: 1 },
  lockedBadge: { color: palette.faint, fontSize: 12, fontWeight: '600' },
  strip: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    gap: 8,
  },
  stripRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stripText: { color: palette.sub, fontSize: 12.5, flex: 1 },
  notice: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    gap: 6,
  },
  noticeText: { color: palette.sub, fontSize: 12.5 },
  noticeError: { color: palette.danger, fontSize: 12.5 },
  stage: { flex: 1, marginHorizontal: 16, marginTop: 12, gap: 10 },
  stageFrame: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  slotHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 12,
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  itemName: { color: '#fff', fontSize: 17, fontWeight: '700' },
  itemDesc: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  pill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillBottomLeft: { left: 10, bottom: 10 },
  pillCenter: { alignSelf: 'center', top: '46%', backgroundColor: 'rgba(0,0,0,0.6)' },
  pillText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
  },
  dotFilled: { backgroundColor: palette.accent, borderColor: palette.accent },
  dotFrontier: { borderColor: palette.accent, borderStyle: 'dashed' },
  dotCurrent: { transform: [{ scale: 1.5 }] },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 40, minWidth: 64 },
  navGlyph: { color: palette.accent, fontSize: 24, lineHeight: 26, fontWeight: '600' },
  navCenter: { minHeight: 40, justifyContent: 'center' },
  jump: { color: palette.sub, fontSize: 12.5, fontWeight: '600' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  galleryBtn: {
    width: 52,
    height: 52,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryGlyph: { color: palette.sub, fontSize: 20 },
  galleryCount: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    backgroundColor: palette.accent,
    borderTopLeftRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  galleryCountText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  sideBtn: { minWidth: 52, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#fff',
  },
  progress: {
    color: palette.faint,
    fontSize: 12,
    textAlign: 'center',
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
});
