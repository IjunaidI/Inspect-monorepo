/**
 * The capture loop (INS-086 Phase 3) — mobile's port of the web populate
 * screen. Behaviour comes from the screen contract + the domain invariants;
 * the LAYOUT deliberately does not: a phone gets a full-screen camera showing
 * one slot at a time, not a three-column console.
 *
 * Decisions live in `@/lib/capture-core` (pure, unit-tested); network and
 * files live in `@/lib/photo-queue`. This file is the thin, stateful glue.
 */
import { ApiError } from '@inspect/api-client';
import { palette, severity as severityTint } from '@inspect/design-tokens';
import { isLockedStatus } from '@inspect/domain';
import type {
  DefectCatalogDto,
  DefectSeverity,
  InspectionDto,
  MeasurementDto,
  PhotoDto,
} from '@inspect/shared-types';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';

import {
  advanceCursor,
  canSubmit,
  createQueuedPhoto,
  discardQueued,
  effectiveSlotFilled,
  enqueue,
  queuedForSlot,
  retreatCursor,
  retryFailed,
  type Cursor,
  type QueuedPhoto,
} from '@/lib/capture-core';
import {
  defaultIo,
  deleteQueuedBytes,
  drainQueue,
  hashFile,
  loadQueue,
  retakeWithQueued,
  saveQueue,
  stashCapture,
} from '@/lib/photo-queue';
import { client } from '@/lib/session';

const SEVERITIES: DefectSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR'];
const TINT: Record<DefectSeverity, { fg: string; bg: string }> = {
  CRITICAL: severityTint.critical,
  MAJOR: severityTint.major,
  MINOR: severityTint.minor,
};

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; inspection: InspectionDto; catalog: DefectCatalogDto[] };

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
  // Lazy init: the persisted queue is read once, synchronously, before first
  // render — not inside an effect (react-compiler flags the cascade).
  const [queue, setQueue] = useState<QueuedPhoto[]>(loadQueue);
  const [cursor, setCursor] = useState<Cursor>({ cycleIndex: 0, itemIndex: 0 });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'none' | 'unit' | 'endgate'>('none');
  const [retakeMode, setRetakeMode] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const draining = useRef(false);

  const inspection = load.kind === 'ready' ? load.inspection : null;
  const items = useMemo(() => inspection?.items ?? [], [inspection]);
  const myQueue = useMemo(
    () => queue.filter((q) => q.inspectionId === inspectionId),
    [queue, inspectionId],
  );
  const locked = inspection ? isLockedStatus(inspection.status) : false;

  const refetch = useCallback(async (): Promise<InspectionDto | null> => {
    const result = await fetchCapture(inspectionId);
    setLoad(result);
    return result.kind === 'ready' ? result.inspection : null;
  }, [inspectionId]);

  /** Drain pending uploads, then refresh server state if anything landed. */
  const drain = useCallback(
    async (current: QueuedPhoto[]) => {
      if (draining.current) return;
      draining.current = true;
      try {
        const before = current.length;
        const after = await drainQueue(current, defaultIo(), setQueue);
        if (after.length < before) await refetch();
      } finally {
        draining.current = false;
      }
    },
    [refetch],
  );

  useEffect(() => {
    fetchCapture(inspectionId).then((result) => {
      setLoad(result);
      if (result.kind === 'ready') {
        const insp = result.inspection;
        const next = insp.cycleState?.nextSlot;
        if (next && insp.items) {
          const idx = insp.items.findIndex((i) => i.id === next.itemId);
          setCursor({ cycleIndex: next.cycleIndex, itemIndex: Math.max(idx, 0) });
        }
      }
      const persisted = loadQueue();
      if (persisted.some((q) => q.state === 'pending')) drain(persisted);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [inspectionId]);

  const currentItem = items[cursor.itemIndex];
  const slot = currentItem
    ? { inspectionLoopItemId: currentItem.id, cycleIndex: cursor.cycleIndex }
    : null;
  const serverPhoto: PhotoDto | undefined = currentItem?.photos?.find(
    (p) => p.cycleIndex === cursor.cycleIndex,
  );
  const queuedPhoto = slot ? queuedForSlot(myQueue, inspectionId, slot) : undefined;
  const slotFilled = Boolean(serverPhoto || queuedPhoto);
  const conflicts = myQueue.filter((q) => q.state === 'conflict');
  const failed = myQueue.filter((q) => q.state === 'failed');
  const uploadingCount = myQueue.filter((q) => q.state !== 'conflict').length;

  /** Advance to the next effective-empty slot (bounded scan past the cursor). */
  const advanceToEmpty = useCallback(
    (from: Cursor, nextQueue: QueuedPhoto[]) => {
      let c = advanceCursor(items.length, from);
      for (let hops = 0; hops < items.length * 2; hops++) {
        const item = items[c.itemIndex];
        if (
          !item ||
          !effectiveSlotFilled(items, nextQueue, inspectionId, {
            inspectionLoopItemId: item.id,
            cycleIndex: c.cycleIndex,
          })
        ) {
          break;
        }
        c = advanceCursor(items.length, c);
      }
      setCursor(c);
    },
    [items, inspectionId],
  );

  async function capture() {
    if (!cameraRef.current || !slot || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const shot = await cameraRef.current.takePictureAsync();
      // Hash-at-capture, before the bytes can be touched again.
      const sha256 = await hashFile(shot.uri);
      const entry = createQueuedPhoto({
        inspectionId,
        inspectionLoopItemId: slot.inspectionLoopItemId,
        cycleIndex: slot.cycleIndex,
        localUri: shot.uri,
        sha256,
      });
      entry.localUri = stashCapture(shot.uri, entry.id);

      if (retakeMode && serverPhoto) {
        // Retake replaces the slot's bytes in place — connectivity required.
        await retakeWithQueued(entry, serverPhoto.id);
        setRetakeMode(false);
        await refetch();
      } else {
        const next = enqueue(queue, entry);
        setQueue(next);
        saveQueue(next);
        advanceToEmpty(cursor, next);
        drain(next);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Capture failed');
    } finally {
      setBusy(false);
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
      clientRequestId: `mob-defect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
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
      // Drop any queued photos aimed at the discarded unit.
      const survivors = queue.filter(
        (q) => !(q.inspectionId === inspectionId && q.cycleIndex === cycleIndex),
      );
      queue
        .filter((q) => q.inspectionId === inspectionId && q.cycleIndex === cycleIndex)
        .forEach(deleteQueuedBytes);
      setQueue(survivors);
      saveQueue(survivors);
      setSheet('none');
      setCursor({ cycleIndex, itemIndex: 0 });
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Discard failed');
    } finally {
      setBusy(false);
    }
  }

  async function endLoop() {
    const state = inspection?.cycleState;
    if (!state) return;
    const verdict = canSubmit(state, uploadingCount);
    if (!verdict.ok) {
      setSheet('endgate');
      return;
    }
    const ok = await post(`/inspections/${inspectionId}/submit`, {
      deviceId: `mobile-${Device.modelName ?? 'unknown'}`,
    });
    if (ok) {
      Alert.alert('Submitted', 'The inspection is now with QA for review.');
      router.replace(`/inspections/${inspectionId}/review`);
    }
  }

  async function resolveConflictKeepMine(entry: QueuedPhoto) {
    setBusy(true);
    setActionError(null);
    try {
      const insp = await refetch();
      const occupying = insp?.items
        ?.find((i) => i.id === entry.inspectionLoopItemId)
        ?.photos?.find((p) => p.cycleIndex === entry.cycleIndex);
      if (!occupying) {
        // The occupying photo vanished (unit discarded elsewhere) — the slot is
        // free again, so re-arm the entry as a plain pending upload.
        const rearmed = retryFailed(
          queue.map((q) => (q.id === entry.id ? { ...q, state: 'failed' as const } : q)),
        );
        setQueue(rearmed);
        saveQueue(rearmed);
        drain(rearmed);
        return;
      }
      await retakeWithQueued(entry, occupying.id);
      const next = discardQueued(queue, entry.id);
      setQueue(next);
      saveQueue(next);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Retake failed');
    } finally {
      setBusy(false);
    }
  }

  function resolveConflictDiscard(entry: QueuedPhoto) {
    deleteQueuedBytes(entry);
    const next = discardQueued(queue, entry.id);
    setQueue(next);
    saveQueue(next);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (load.kind === 'loading') {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  }
  if (load.kind === 'missing' || load.kind === 'error') {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.errorText}>
          {load.kind === 'missing' ? 'Inspection not found.' : load.message}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!items.length) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.errorText}>No loop items defined on this inspection.</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const state = inspection!.cycleState;
  const target = inspection!.computedSampling?.sampleSize;
  const showCamera = !locked && (!slotFilled || retakeMode);

  return (
    <SafeAreaView style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Close</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {inspection!.purchaseOrder?.poNumber ?? 'Capture'}
          </Text>
          <Text style={styles.headerSub}>
            Unit {cursor.cycleIndex + 1}
            {target ? ` of ${target}` : ''} · item {cursor.itemIndex + 1}/{items.length}
          </Text>
        </View>
        {locked ? (
          <Text style={styles.lockedBadge}>Read-only</Text>
        ) : (
          <Pressable onPress={endLoop} disabled={busy} hitSlop={8}>
            <Text style={[styles.link, busy && styles.dim]}>End loop</Text>
          </Pressable>
        )}
      </View>

      {locked ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            This inspection is {inspection!.status.replace(/_/g, ' ').toLowerCase()} and can no
            longer be populated. Corrections require a new linked re-inspection.
          </Text>
        </View>
      ) : null}
      {actionError ? (
        <View style={styles.notice}>
          <Text style={styles.noticeError} numberOfLines={3}>
            {actionError}
          </Text>
        </View>
      ) : null}

      {/* Conflicts + failures need a human */}
      {conflicts.map((c) => (
        <View key={c.id} style={styles.conflict}>
          <Text style={styles.conflictText}>
            A photo for unit {c.cycleIndex + 1} ·{' '}
            {items.find((i) => i.id === c.inspectionLoopItemId)?.itemName ?? 'item'} was taken
            elsewhere while yours waited. Keep yours (replaces it) or discard yours.
          </Text>
          <View style={styles.rowButtons}>
            <Pressable style={styles.btnSmall} disabled={busy} onPress={() => resolveConflictKeepMine(c)}>
              <Text style={styles.btnSmallLabel}>Keep mine</Text>
            </Pressable>
            <Pressable style={styles.btnSmallGhost} onPress={() => resolveConflictDiscard(c)}>
              <Text style={styles.btnSmallGhostLabel}>Discard mine</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {failed.length > 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            {failed.length} upload{failed.length === 1 ? '' : 's'} failed — {failed[0].error}
          </Text>
          <Pressable
            onPress={() => {
              const next = retryFailed(queue);
              setQueue(next);
              saveQueue(next);
              drain(next);
            }}
          >
            <Text style={styles.link}>Retry uploads</Text>
          </Pressable>
        </View>
      ) : null}

      {/* The slot */}
      <View style={styles.stage}>
        <View style={styles.slotHeader}>
          <Text style={styles.itemName} numberOfLines={1}>
            {currentItem?.itemName}
          </Text>
          {currentItem?.description ? (
            <Text style={styles.itemDesc} numberOfLines={2}>
              {currentItem.description}
            </Text>
          ) : null}
        </View>

        {showCamera ? (
          permission?.granted ? (
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
          ) : (
            <View style={[styles.camera, styles.center]}>
              <Text style={styles.errorText}>Camera permission is required to capture.</Text>
              <Pressable onPress={requestPermission}>
                <Text style={styles.link}>Grant camera access</Text>
              </Pressable>
            </View>
          )
        ) : (
          <View style={styles.camera}>
            {serverPhoto?.viewUrl || queuedPhoto ? (
              <Image
                source={{ uri: serverPhoto?.viewUrl ?? queuedPhoto?.localUri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.center]}>
                <Text style={styles.errorText}>Photo uploaded (preview unavailable).</Text>
              </View>
            )}
            {queuedPhoto ? (
              <View style={styles.queuedBadge}>
                <Text style={styles.queuedBadgeText}>
                  {queuedPhoto.state === 'pending' || queuedPhoto.state === 'uploading'
                    ? 'Uploading…'
                    : queuedPhoto.state}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Slot dots for the current unit */}
        <View style={styles.dots}>
          {items.map((item, i) => {
            const filled = effectiveSlotFilled(items, myQueue, inspectionId, {
              inspectionLoopItemId: item.id,
              cycleIndex: cursor.cycleIndex,
            });
            return (
              <Pressable
                key={item.id}
                onPress={() => setCursor({ cycleIndex: cursor.cycleIndex, itemIndex: i })}
                hitSlop={6}
                style={[
                  styles.dot,
                  filled && styles.dotFilled,
                  i === cursor.itemIndex && styles.dotCurrent,
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable
          onPress={() => {
            setRetakeMode(false);
            setCursor(retreatCursor(items.length, cursor));
          }}
          hitSlop={8}
        >
          <Text style={styles.link}>Back</Text>
        </Pressable>

        {showCamera ? (
          <Pressable
            style={[styles.shutter, (busy || !permission?.granted) && styles.dim]}
            disabled={busy || !permission?.granted}
            onPress={capture}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <View style={styles.shutterInner} />}
          </Pressable>
        ) : (
          <View style={styles.rowButtons}>
            {!locked && serverPhoto ? (
              <Pressable style={styles.btnSmallGhost} onPress={() => setRetakeMode(true)}>
                <Text style={styles.btnSmallGhostLabel}>Retake</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.btnSmall} onPress={() => setSheet('unit')}>
              <Text style={styles.btnSmallLabel}>Defects & measurements</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={() => {
            setRetakeMode(false);
            setCursor(advanceCursor(items.length, cursor));
          }}
          hitSlop={8}
        >
          <Text style={styles.link}>Next</Text>
        </Pressable>
      </View>

      <Text style={styles.progress}>
        {state ? `${state.completedCycles} unit${state.completedCycles === 1 ? '' : 's'} complete` : ''}
        {target ? ` / ${target} target — you may end on any complete unit` : ''}
        {uploadingCount > 0 ? `  ·  ${uploadingCount} in queue` : ''}
      </Text>

      {/* Unit sheet: defects + measurements */}
      <Modal visible={sheet === 'unit'} animationType="slide" transparent>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetBody}>
            <View style={styles.sheetHandleRow}>
              <Text style={styles.sheetTitle}>
                Unit {cursor.cycleIndex + 1} · {currentItem?.itemName}
              </Text>
              <Pressable onPress={() => setSheet('none')} hitSlop={8}>
                <Text style={styles.link}>Done</Text>
              </Pressable>
            </View>
            <ScrollView>
              <UnitSheet
                catalog={load.kind === 'ready' ? load.catalog : []}
                inspection={inspection!}
                cursor={cursor}
                itemId={currentItem?.id}
                canTag={!locked && Boolean(serverPhoto)}
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

      {/* End-loop gate */}
      <Modal visible={sheet === 'endgate'} animationType="fade" transparent>
        <View style={[styles.sheetBackdrop, styles.center]}>
          <View style={styles.gateBody}>
            <EndGate
              verdict={state ? canSubmit(state, uploadingCount) : { ok: false, reason: 'no-complete-unit' }}
              items={items}
              busy={busy}
              onFinish={(cycleIndex) => {
                setSheet('none');
                setCursor({ cycleIndex, itemIndex: 0 });
              }}
              onDiscard={discardUnit}
              onCancel={() => setSheet('none')}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function measurementFor(
  measurements: MeasurementDto[] | undefined,
  cycleIndex: number,
  label: string,
): MeasurementDto | undefined {
  return measurements?.find((m) => m.cycleIndex === cycleIndex && m.label === label);
}

function UnitSheet(props: {
  catalog: DefectCatalogDto[];
  inspection: InspectionDto;
  cursor: Cursor;
  itemId?: string;
  canTag: boolean;
  busy: boolean;
  readOnly: boolean;
  onTag: (item: DefectCatalogDto) => void;
  onCustom: (text: string, severity: DefectSeverity) => Promise<boolean>;
  onMeasure: (label: string, unit: string | undefined, value: string) => void;
}) {
  const { catalog, inspection, cursor, canTag, busy, readOnly } = props;
  const [customText, setCustomText] = useState('');
  const [customSeverity, setCustomSeverity] = useState<DefectSeverity>('MINOR');

  const unitDefects = (inspection.items ?? []).flatMap((item) =>
    (item.defects ?? [])
      .filter((d) => d.cycleIndex === cursor.cycleIndex)
      .map((d) => ({ ...d, itemName: item.itemName })),
  );
  const fields = inspection.loopPresetSnapshot?.measurementFields ?? [];

  return (
    <View style={{ gap: 16, paddingBottom: 24 }}>
      <View>
        <Text style={styles.sectionLabel}>Defect tags</Text>
        {!canTag && !readOnly ? (
          <Text style={styles.hint}>
            Upload this item&apos;s photo first — a defect is recorded against the shot it was seen
            on.
          </Text>
        ) : null}
        {SEVERITIES.map((sev) => {
          const group = catalog.filter((c) => c.defaultSeverity === sev && !c.isArchived);
          if (!group.length) return null;
          return (
            <View key={sev} style={{ marginTop: 8 }}>
              <Text style={[styles.severityLabel, { color: TINT[sev].fg }]}>
                {sev.charAt(0) + sev.slice(1).toLowerCase()}
              </Text>
              <View style={styles.chipWrap}>
                {group.map((c) => (
                  <Pressable
                    key={c.id}
                    disabled={!canTag || busy || readOnly}
                    onPress={() => props.onTag(c)}
                    style={[styles.defectChip, { backgroundColor: TINT[sev].bg }, (!canTag || readOnly) && styles.dim]}
                  >
                    <Text style={[styles.defectChipLabel, { color: TINT[sev].fg }]}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
        {!readOnly ? (
          <View style={styles.customRow}>
            <TextInput
              style={styles.input}
              placeholder="Add custom defect tag…"
              placeholderTextColor={palette.faint}
              value={customText}
              onChangeText={setCustomText}
              editable={canTag && !busy}
            />
            <Pressable
              onPress={() =>
                setCustomSeverity(
                  SEVERITIES[(SEVERITIES.indexOf(customSeverity) + 1) % SEVERITIES.length],
                )
              }
              style={[styles.btnSmallGhost, { backgroundColor: TINT[customSeverity].bg }]}
            >
              <Text style={[styles.btnSmallGhostLabel, { color: TINT[customSeverity].fg }]}>
                {customSeverity.charAt(0) + customSeverity.slice(1).toLowerCase()}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.btnSmall, (!canTag || !customText.trim() || busy) && styles.dim]}
              disabled={!canTag || !customText.trim() || busy}
              onPress={async () => {
                if (await props.onCustom(customText.trim(), customSeverity)) setCustomText('');
              }}
            >
              <Text style={styles.btnSmallLabel}>Add</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View>
        <Text style={styles.sectionLabel}>On this unit · {unitDefects.length}</Text>
        {unitDefects.length === 0 ? (
          <Text style={styles.hint}>No defects recorded.</Text>
        ) : (
          unitDefects.map((d) => (
            <View key={d.id} style={styles.unitDefectRow}>
              <Text style={[styles.defectChipLabel, { color: TINT[d.severity].fg }]}>
                {d.defectCatalog?.name ?? d.customText ?? '—'}
              </Text>
              <Text style={styles.hint}>{d.itemName}</Text>
            </View>
          ))
        )}
      </View>

      <View>
        <Text style={styles.sectionLabel}>Measurements · this unit</Text>
        {fields.length === 0 ? (
          <Text style={styles.hint}>No measurement sheet on this loop.</Text>
        ) : (
          fields.map((f) => (
            <MeasurementRow
              key={f.label}
              label={f.label}
              unit={f.unit}
              initial={
                measurementFor(inspection.measurements, cursor.cycleIndex, f.label)?.recordedValue ??
                ''
              }
              readOnly={readOnly}
              onSave={(v) => props.onMeasure(f.label, f.unit, v)}
            />
          ))
        )}
      </View>
    </View>
  );
}

function MeasurementRow(props: {
  label: string;
  unit?: string;
  initial: string;
  readOnly: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <View style={styles.measureRow}>
      <Text style={styles.measureLabel}>{props.label}</Text>
      <TextInput
        style={[styles.input, styles.measureInput]}
        value={value}
        onChangeText={setValue}
        onEndEditing={() => props.onSave(value)}
        editable={!props.readOnly}
        placeholder="—"
        placeholderTextColor={palette.faint}
      />
      <Text style={styles.hint}>{props.unit ?? ''}</Text>
    </View>
  );
}

function EndGate(props: {
  verdict: ReturnType<typeof canSubmit>;
  items: { id: string; itemName: string }[];
  busy: boolean;
  onFinish: (cycleIndex: number) => void;
  onDiscard: (cycleIndex: number) => void;
  onCancel: () => void;
}) {
  const { verdict } = props;
  if (verdict.ok) return null; // endLoop() submits directly when clean
  if (verdict.reason === 'queue-not-empty') {
    return (
      <View style={{ gap: 12 }}>
        <Text style={styles.gateTitle}>Photos still uploading</Text>
        <Text style={styles.gateText}>
          Submit is blocked while the upload queue is non-empty — completeness is judged against
          what the server holds. Wait for uploads to finish (or resolve failures), then end the
          loop again.
        </Text>
        <Pressable style={styles.btnSmall} onPress={props.onCancel}>
          <Text style={styles.btnSmallLabel}>OK</Text>
        </Pressable>
      </View>
    );
  }
  if (verdict.reason === 'no-complete-unit') {
    return (
      <View style={{ gap: 12 }}>
        <Text style={styles.gateTitle}>No complete unit yet</Text>
        <Text style={styles.gateText}>
          A loop can only be ended on a complete unit. Finish at least one unit first.
        </Text>
        <Pressable style={styles.btnSmall} onPress={props.onCancel}>
          <Text style={styles.btnSmallLabel}>OK</Text>
        </Pressable>
      </View>
    );
  }
  const { partial } = verdict;
  const missing = partial.missingItemIds
    .map((mid) => props.items.find((i) => i.id === mid)?.itemName ?? 'item')
    .join(', ');
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.gateTitle}>Unit {partial.cycleIndex + 1} is incomplete</Text>
      <Text style={styles.gateText}>
        Still missing: {missing}. A loop can only be ended on a complete unit — finish this one, or
        discard it.
      </Text>
      <Pressable style={styles.btnSmall} onPress={() => props.onFinish(partial.cycleIndex)}>
        <Text style={styles.btnSmallLabel}>Finish unit {partial.cycleIndex + 1}</Text>
      </Pressable>
      <Pressable
        style={styles.btnSmallGhost}
        disabled={props.busy}
        onPress={() => props.onDiscard(partial.cycleIndex)}
      >
        <Text style={[styles.btnSmallGhostLabel, { color: palette.danger }]}>
          Discard unit {partial.cycleIndex + 1}
        </Text>
      </Pressable>
      <Pressable style={styles.btnSmallGhost} onPress={props.onCancel}>
        <Text style={styles.btnSmallGhostLabel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
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
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.5 },
  errorText: { color: palette.sub, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
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
  conflict: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: severityTint.major.fg,
    backgroundColor: severityTint.major.bg,
    gap: 8,
  },
  conflictText: { color: severityTint.major.fg, fontSize: 12.5 },
  stage: { flex: 1, margin: 16, gap: 10 },
  slotHeader: { gap: 2 },
  itemName: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  itemDesc: { color: palette.sub, fontSize: 13 },
  camera: { flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  queuedBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  queuedBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
  },
  dotFilled: { backgroundColor: palette.accent, borderColor: palette.accent },
  dotCurrent: { transform: [{ scale: 1.4 }] },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  shutter: {
    width: 68,
    height: 68,
    borderRadius: 999,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#fff',
  },
  progress: { color: palette.faint, fontSize: 12, textAlign: 'center', paddingBottom: 10 },
  rowButtons: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btnSmall: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
  },
  btnSmallLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnSmallGhost: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: palette.panel,
  },
  btnSmallGhostLabel: { color: palette.sub, fontSize: 13, fontWeight: '600' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(11,18,32,0.45)', justifyContent: 'flex-end' },
  sheetBody: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    padding: 16,
  },
  sheetHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  gateBody: {
    backgroundColor: palette.bg,
    borderRadius: 14,
    padding: 18,
    marginHorizontal: 24,
    alignSelf: 'stretch',
  },
  gateTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  gateText: { color: palette.sub, fontSize: 13.5, lineHeight: 19 },
  sectionLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  severityLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  defectChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  defectChipLabel: { fontSize: 12.5, fontWeight: '600' },
  customRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: palette.ink,
    backgroundColor: palette.panel,
    fontSize: 13.5,
  },
  hint: { color: palette.faint, fontSize: 12 },
  unitDefectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: palette.lineSoft,
  },
  measureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  measureLabel: { color: palette.ink, fontSize: 13.5, flex: 1 },
  measureInput: { flex: 0, width: 110, textAlign: 'right' },
});
