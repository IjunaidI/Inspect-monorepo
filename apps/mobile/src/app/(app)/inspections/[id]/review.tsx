/**
 * Report review (INS-086 Phase 4) — port of the web `/inspections/[id]/review`
 * behaviour contract. Any authenticated role can view; the decision form and
 * re-inspect are QA_MANAGER-gated in the UI, with the API as the authority.
 *
 * The status machine comes from @inspect/domain's shared transition sets —
 * the same tables the API's guards and the web page read.
 *
 * INS-092:
 * - A read-only "Photo evidence" section in CAPTURE order — one block per
 *   unit (cycle, rendered 1-based), items by position. Tiles are served
 *   local-first from this device's cache (`cachedUriForSlot`) and fall back to
 *   the server's presigned URL. The evidence comes from the populate read
 *   (the only read that decorates `viewUrl`); it fails independently of the
 *   inspection itself and has its own Retry.
 * - "Submit for review" is BLOCKED while this device still holds uploads for
 *   the inspection (the capture screen's own gate, mirrored): the server
 *   judges cycle completeness against what it holds, and a report must never
 *   end with evidence still on the phone.
 * - Pull-to-refresh.
 */
import { ApiError } from '@inspect/api-client';
import { palette, severity as severityTint } from '@inspect/design-tokens';
import {
  DECIDABLE_STATUSES,
  REINSPECTABLE_STATUSES,
  REPORTABLE_STATUSES,
  SUBMITTABLE_STATUSES,
  roleAtLeast,
} from '@inspect/domain';
import type { InspectionDto, InspectionLoopItemDto, QaDecision } from '@inspect/shared-types';
import * as Device from 'expo-device';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { SlotImage } from '@/components/capture/slot-image';
import { FormScreen } from '@/components/form-screen';
import { useToast } from '@/components/toast';
import { Button, Field, Input, TextButton, ui } from '@/components/ui';
import { activeEntries, cachedUriForSlot, queuedForSlot, type QueuedPhoto } from '@/lib/capture-core';
import { photoQueue } from '@/lib/photo-queue';
import { client, loadIdentity } from '@/lib/session';

const SUBMITTABLE = new Set<string>(SUBMITTABLE_STATUSES);
const DECIDABLE = new Set<string>(DECIDABLE_STATUSES);
const REPORTABLE = new Set<string>(REPORTABLE_STATUSES);
const REINSPECTABLE = new Set<string>(REINSPECTABLE_STATUSES);
const CLASSES = ['critical', 'major', 'minor'] as const;
const TINT = {
  critical: severityTint.critical,
  major: severityTint.major,
  minor: severityTint.minor,
};
const DECISIONS: { value: QaDecision; label: string; hint: string }[] = [
  {
    value: 'PASS',
    label: 'Pass',
    hint: 'Release the lot. Overrides the system flag.',
  },
  {
    value: 'FAIL',
    label: 'Fail',
    hint: 'Reject the lot. Matches a system FAIL.',
  },
  {
    value: 'HOLD',
    label: 'Hold',
    hint: 'Pause for clarification or re-inspection.',
  },
];

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      inspection: InspectionDto;
      role?: string;
      /** The populate read's items (photos carry `viewUrl`); null = failed. */
      evidence: InspectionLoopItemDto[] | null;
    };

/** The one read that decorates photos with a presigned `viewUrl`. */
const fetchEvidence = (id: string) =>
  client.get<InspectionDto>(`/inspections/${id}/populate`).then((i) => i.items ?? []);

/** Pure fetch — setState only ever happens in .then. */
async function fetchReview(id: string): Promise<Load> {
  try {
    const [inspection, identity, evidence] = await Promise.all([
      client.get<InspectionDto>(`/inspections/${id}`),
      loadIdentity(),
      // Evidence failing must not sink the review — null renders as an
      // inline error with its own Retry.
      fetchEvidence(id).catch(() => null),
    ]);
    return { kind: 'ready', inspection, role: identity?.role, evidence };
  } catch (e) {
    // 403 and 404 are deliberately told apart — the web screen collapses them.
    if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
    if (e instanceof ApiError && e.status === 403) {
      return {
        kind: 'error',
        message: 'You do not have access to this inspection.',
      };
    }
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Load failed',
    };
  }
}

/**
 * Units in cycle order, items by position. A unit exists when the server
 * holds a photo for it OR this device has one queued for it, so a shot that
 * is still uploading is already visible here.
 */
function unitsFor(items: InspectionLoopItemDto[], queue: readonly QueuedPhoto[], inspectionId: string) {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const cycles = new Set<number>();
  for (const item of ordered) for (const p of item.photos ?? []) cycles.add(p.cycleIndex);
  for (const q of queue) if (q.inspectionId === inspectionId) cycles.add(q.cycleIndex);
  return { ordered, cycles: [...cycles].sort((a, b) => a - b) };
}

export default function Review() {
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspectionId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [decision, setDecision] = useState<QaDecision | null>(null);
  const [remarks, setRemarks] = useState('');
  const [pending, setPending] = useState(false);
  const [evidencePending, setEvidencePending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The device's photo queue, live — drives the submit gate and the tiles.
  const [queue, setQueue] = useState<QueuedPhoto[]>(() => photoQueue().snapshot().queue);

  useEffect(() => {
    const unsubscribe = photoQueue().subscribe((s) => setQueue(s.queue));
    photoQueue().kick(true);
    return unsubscribe;
  }, []);

  const reload = useCallback(() => {
    fetchReview(inspectionId).then(setLoad);
  }, [inspectionId]);
  useEffect(reload, [reload]);

  /** Pull-to-refresh: never flip a loaded screen into an error state. */
  async function refresh() {
    const result = await fetchReview(inspectionId);
    if (result.kind === 'ready') setLoad(result);
    else toast('Could not refresh the inspection', { tone: 'danger' });
  }

  /** INS-092: re-fetch ONLY the evidence. */
  async function retryEvidence() {
    setEvidencePending(true);
    try {
      const evidence = await fetchEvidence(inspectionId);
      setLoad((l) => (l.kind === 'ready' ? { ...l, evidence } : l));
    } catch {
      toast('Photo evidence still unavailable', { tone: 'danger' });
    } finally {
      setEvidencePending(false);
    }
  }

  const pendingUploads = activeEntries(queue, inspectionId).length;

  async function submitForReview() {
    // Mirrors the capture screen's gate: never ask the server to judge an
    // inspection whose evidence is still on this device.
    if (pendingUploads > 0) return;
    setPending(true);
    setActionError(null);
    try {
      await client.post(`/inspections/${inspectionId}/submit`, {
        deviceId: `mobile-${Device.modelName ?? 'unknown'}`,
      });
      toast('Submitted for review');
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setPending(false);
    }
  }

  async function decide() {
    if (!decision || !remarks.trim()) return;
    setPending(true);
    setActionError(null);
    try {
      await client.post(`/inspections/${inspectionId}/decision`, {
        decision,
        remarks: remarks.trim(),
      });
      toast(`Decision recorded: ${decision}`);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Decision failed');
    } finally {
      setPending(false);
    }
  }

  async function reInspect(orig: InspectionDto) {
    const poId = orig.purchaseOrder?.id;
    if (!poId) {
      setActionError('No purchase order on the original inspection.');
      return;
    }
    setPending(true);
    setActionError(null);
    try {
      // INS-063: carry the ORIGINAL per-class AQL plan across — a
      // re-inspection corrects the same lot under the same agreement.
      const raw = orig as unknown as Record<string, unknown>;
      const loopPresetId =
        (raw.loopPresetId as string | undefined) ??
        ((raw.loopPresetSnapshot as Record<string, unknown> | null)?.presetId as
          | string
          | undefined);
      const aqlPlan = raw.aqlPlan as Record<string, number> | null | undefined;
      const created = await client.post<{ id: string }>('/inspections', {
        poId,
        ...(loopPresetId ? { loopPresetId } : {}),
        lotSize: orig.lotSize,
        ...(aqlPlan ? { aqlPlan } : {}),
        supersedesInspectionId: inspectionId,
      });
      toast('Linked re-inspection created');
      router.replace(`/inspections/${created.id}/review`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Re-inspection failed');
    } finally {
      setPending(false);
    }
  }

  if (load.kind === 'loading') {
    return (
      <SafeAreaView style={[ui.screen, styles.center]}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  }
  if (load.kind !== 'ready') {
    return (
      <SafeAreaView style={[ui.screen, styles.center]}>
        <Text style={ui.mutedText}>
          {load.kind === 'missing' ? 'Inspection not found.' : load.message}
        </Text>
        <View style={ui.centerActions}>
          {load.kind === 'error' ? <TextButton label="Retry" onPress={reload} /> : null}
          <BackButton />
        </View>
      </SafeAreaView>
    );
  }

  const insp = load.inspection;
  const r = insp.aqlResult;
  const canDecide = roleAtLeast(load.role, 'QA_MANAGER');
  const showDecisionForm = DECIDABLE.has(insp.status) && canDecide;
  const fail = r?.systemRecommendation === 'FAIL';
  const evidence = load.evidence ? unitsFor(load.evidence, queue, inspectionId) : null;

  const header = (
    <View style={styles.header}>
      <BackButton />
      <Text style={styles.headerTitle} numberOfLines={1}>
        {insp.purchaseOrder?.poNumber ?? 'Review'}
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );

  return (
    <FormScreen header={header} onRefresh={refresh}>
      <Text style={styles.subLine}>
        {insp.clientCompany?.name ?? '—'} · {insp.product?.styleNumber ?? '—'} · status{' '}
        {insp.status.replace(/_/g, ' ')}
      </Text>

      {actionError ? <Text style={ui.errorText}>{actionError}</Text> : null}

      {/* AQL result */}
      {r ? (
        <View style={styles.card}>
          <View style={styles.recoRow}>
            <Text style={ui.sectionLabel}>System recommendation</Text>
            <Text style={[styles.reco, { color: fail ? severityTint.critical.fg : '#1F8A4C' }]}>
              {r.systemRecommendation}
            </Text>
          </View>
          <Text style={ui.hint}>
            Sample n {insp.computedSampling?.sampleSize ?? '—'} · code{' '}
            {insp.computedSampling?.sampleSizeCodeLetter ?? '—'} · lot {insp.lotSize ?? '—'}
          </Text>
          {CLASSES.map((cls) => {
            const c = r.perClass[cls];
            if (!c) return null;
            const rej = c.outcome === 'FAIL';
            return (
              <View key={cls} style={styles.classRow}>
                <View style={[styles.chip, { backgroundColor: TINT[cls].bg }]}>
                  <Text style={[styles.chipLabel, { color: TINT[cls].fg }]}>
                    {cls.charAt(0).toUpperCase() + cls.slice(1)}
                  </Text>
                </View>
                <Text style={styles.classCell}>found {c.found}</Text>
                <Text style={styles.classCell}>
                  Ac {c.ac} · Re {c.re}
                </Text>
                <Text
                  style={[
                    styles.classOutcome,
                    { color: rej ? severityTint.critical.fg : '#1F8A4C' },
                  ]}
                >
                  {rej ? 'Reject' : 'Accept'}
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={ui.mutedText}>
            No AQL result yet — submit the inspection to compute the sampling evaluation.
          </Text>
        </View>
      )}

      {/* Pre-submit */}
      {SUBMITTABLE.has(insp.status) ? (
        <View style={styles.card}>
          <Text style={ui.sectionLabel}>QA decision</Text>
          <Text style={ui.hint}>
            This inspection has not been submitted. Submitting locks the audit block and computes
            the AQL result.
          </Text>
          {pendingUploads > 0 ? (
            <View style={styles.gateBanner}>
              <Text style={styles.gateText}>
                {pendingUploads} photo{pendingUploads === 1 ? ' is' : 's are'} still uploading from
                this device — submit is available once they land. Open the capture screen to see
                progress.
              </Text>
              <TextButton
                label="Open capture screen →"
                onPress={() => router.push(`/inspections/${inspectionId}/capture`)}
              />
            </View>
          ) : null}
          <Button
            label="Submit for review"
            loadingLabel="Submitting…"
            loading={pending}
            disabled={pendingUploads > 0}
            onPress={submitForReview}
            labelStyle={styles.btnLabel}
          />
          <TextButton
            label="Capture photos & defects"
            onPress={() => router.push(`/inspections/${inspectionId}/capture`)}
          />
        </View>
      ) : showDecisionForm ? (
        <View style={styles.card}>
          <Text style={ui.sectionLabel}>QA decision</Text>
          {DECISIONS.map((d) => (
            <Pressable
              key={d.value}
              style={[styles.decisionRow, decision === d.value && styles.decisionRowActive]}
              onPress={() => setDecision(d.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: decision === d.value }}
            >
              <View style={[styles.radio, decision === d.value && styles.radioActive]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.decisionLabel}>{d.label}</Text>
                <Text style={ui.hint}>{d.hint}</Text>
              </View>
            </Pressable>
          ))}
          <Field label="Decision note *">
            <Input
              style={styles.inputOnPanel}
              multiline
              value={remarks}
              onChangeText={setRemarks}
              editable={!pending}
              placeholder="Required for every decision, including Pass."
            />
          </Field>
          <Button
            label="Submit decision"
            loadingLabel="Submitting…"
            loading={pending}
            disabled={!decision || !remarks.trim()}
            onPress={decide}
            labelStyle={styles.btnLabel}
          />
          <Text style={ui.hint}>
            Submitting locks the report. Corrections require a new linked re-inspection.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          {DECIDABLE.has(insp.status) ? (
            <Text style={ui.mutedText}>Awaiting QA Manager review.</Text>
          ) : (
            <>
              <Text style={ui.sectionLabel}>Final decision</Text>
              <Text style={styles.finalDecision}>{r?.qaDecision ?? insp.status}</Text>
              {r?.qaRemarks ? <Text style={ui.hint}>{r.qaRemarks}</Text> : null}
            </>
          )}
        </View>
      )}

      {/* Photo evidence — read-only, capture order (unit → item position). */}
      <View style={styles.card}>
        <Text style={ui.sectionLabel}>Photo evidence</Text>
        {evidence === null ? (
          <View style={styles.inlineError}>
            <Text style={[ui.errorText, { flexShrink: 1 }]}>
              The photo evidence could not be loaded.
            </Text>
            <TextButton
              label={evidencePending ? 'Retrying…' : 'Retry'}
              onPress={retryEvidence}
              disabled={evidencePending}
            />
          </View>
        ) : evidence.cycles.length === 0 ? (
          <Text style={ui.hint}>No photos yet.</Text>
        ) : (
          evidence.cycles.map((cycleIndex) => {
            const shot = evidence.ordered.filter(
              (item) =>
                item.photos?.some((p) => p.cycleIndex === cycleIndex) ||
                queuedForSlot(queue, inspectionId, { inspectionLoopItemId: item.id, cycleIndex }),
            ).length;
            return (
              <View key={cycleIndex} style={styles.unit}>
                <View style={styles.unitHead}>
                  <Text style={styles.unitTitle}>Unit {cycleIndex + 1}</Text>
                  <Text style={ui.hint}>
                    {shot}/{evidence.ordered.length} photos
                  </Text>
                </View>
                <View style={styles.tiles}>
                  {evidence.ordered.map((item) => {
                    const slot = { inspectionLoopItemId: item.id, cycleIndex };
                    const serverPhoto = item.photos?.find((p) => p.cycleIndex === cycleIndex);
                    const local = cachedUriForSlot(queue, inspectionId, slot, serverPhoto?.contentHash);
                    const queued = queuedForSlot(queue, inspectionId, slot);
                    const empty = !serverPhoto && !local;
                    return (
                      <View
                        key={item.id}
                        style={[styles.tile, empty && styles.tileEmpty]}
                        accessibilityLabel={`Unit ${cycleIndex + 1}, ${item.itemName}${
                          empty ? ', no photo' : ''
                        }`}
                      >
                        {empty ? (
                          <View style={[StyleSheet.absoluteFill, styles.tileCenter]}>
                            <Text style={styles.tileEmptyText}>—</Text>
                          </View>
                        ) : (
                          <SlotImage
                            localUri={local}
                            remoteUri={serverPhoto?.viewUrl}
                            style={StyleSheet.absoluteFill}
                            emptyLabel="Preview unavailable"
                          />
                        )}
                        {queued ? (
                          <View style={styles.tileBadge}>
                            <Text style={styles.tileBadgeText}>
                              {queued.state === 'conflict' ? 'Decide' : 'Uploading'}
                            </Text>
                          </View>
                        ) : null}
                        <Text
                          style={[styles.tileLabel, empty && styles.tileLabelEmpty]}
                          numberOfLines={1}
                        >
                          {item.itemName}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
      </View>

      {REPORTABLE.has(insp.status) ? (
        <TextButton
          label="View the signed report →"
          onPress={() => router.push(`/inspections/${inspectionId}/report`)}
        />
      ) : null}
      {REINSPECTABLE.has(insp.status) && canDecide ? (
        <Button
          variant="ghost"
          label="Start linked re-inspection"
          disabled={pending}
          onPress={() => reInspect(insp)}
        />
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.panel,
  },
  headerTitle: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  subLine: { color: palette.sub, fontSize: 13 },
  card: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 10,
    backgroundColor: palette.panel,
    padding: 14,
    gap: 10,
  },
  recoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reco: { fontSize: 18, fontWeight: '800' },
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: palette.lineSoft,
    paddingTop: 10,
  },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipLabel: { fontSize: 11, fontWeight: '600' },
  classCell: { color: palette.sub, fontSize: 12.5 },
  classOutcome: { fontSize: 12.5, fontWeight: '700', marginLeft: 'auto' },
  btnLabel: { fontSize: 14, fontWeight: '600' },
  gateBanner: {
    borderWidth: 1,
    borderColor: severityTint.major.fg,
    backgroundColor: severityTint.major.bg,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  gateText: { color: severityTint.major.fg, fontSize: 13, lineHeight: 18 },
  decisionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    padding: 10,
    minHeight: 44,
  },
  decisionRowActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: palette.line,
  },
  radioActive: { borderColor: palette.accent, backgroundColor: palette.accent },
  decisionLabel: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  inputOnPanel: { backgroundColor: palette.bg, minHeight: 70 },
  finalDecision: { color: palette.ink, fontSize: 18, fontWeight: '800' },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  unit: { gap: 6 },
  unitHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  unitTitle: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: palette.ink,
    justifyContent: 'flex-end',
  },
  tileEmpty: {
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.line,
    borderStyle: 'dashed',
  },
  tileCenter: { alignItems: 'center', justifyContent: 'center' },
  tileEmptyText: { color: palette.faint, fontSize: 16, fontWeight: '600' },
  tileBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(3,123,244,0.85)',
  },
  tileBadgeText: { color: palette.panel, fontSize: 10, fontWeight: '700' },
  tileLabel: {
    color: palette.panel,
    fontSize: 10.5,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  tileLabelEmpty: { color: palette.faint, backgroundColor: 'transparent' },
});
