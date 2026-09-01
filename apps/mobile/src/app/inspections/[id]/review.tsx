/**
 * Report review (INS-086 Phase 4) — port of the web `/inspections/[id]/review`
 * behaviour contract. Any authenticated role can view; the decision form and
 * re-inspect are QA_MANAGER-gated in the UI, with the API as the authority.
 *
 * The status machine comes from @inspect/domain's shared transition sets —
 * the same tables the API's guards and the web page read.
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
import type { InspectionDto, QaDecision } from '@inspect/shared-types';
import * as Device from 'expo-device';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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
  { value: 'PASS', label: 'Pass', hint: 'Release the lot. Overrides the system flag.' },
  { value: 'FAIL', label: 'Fail', hint: 'Reject the lot. Matches a system FAIL.' },
  { value: 'HOLD', label: 'Hold', hint: 'Pause for clarification or re-inspection.' },
];

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; inspection: InspectionDto; role?: string };

/** Pure fetch — setState only ever happens in .then. */
async function fetchReview(id: string): Promise<Load> {
  try {
    const [inspection, identity] = await Promise.all([
      client.get<InspectionDto>(`/inspections/${id}`),
      loadIdentity(),
    ]);
    return { kind: 'ready', inspection, role: identity?.role };
  } catch (e) {
    // 403 and 404 are deliberately told apart — the web screen collapses them.
    if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
    if (e instanceof ApiError && e.status === 403) {
      return { kind: 'error', message: 'You do not have access to this inspection.' };
    }
    return { kind: 'error', message: e instanceof Error ? e.message : 'Load failed' };
  }
}

export default function Review() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspectionId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [decision, setDecision] = useState<QaDecision | null>(null);
  const [remarks, setRemarks] = useState('');
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchReview(inspectionId).then(setLoad);
  }, [inspectionId]);
  useEffect(reload, [reload]);

  async function submitForReview() {
    setPending(true);
    setActionError(null);
    try {
      await client.post(`/inspections/${inspectionId}/submit`, {
        deviceId: `mobile-${Device.modelName ?? 'unknown'}`,
      });
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
        ((raw.loopPresetSnapshot as Record<string, unknown> | null)?.presetId as string | undefined);
      const aqlPlan = raw.aqlPlan as Record<string, number> | null | undefined;
      const created = await client.post<{ id: string }>('/inspections', {
        poId,
        ...(loopPresetId ? { loopPresetId } : {}),
        lotSize: orig.lotSize,
        ...(aqlPlan ? { aqlPlan } : {}),
        supersedesInspectionId: inspectionId,
      });
      router.replace(`/inspections/${created.id}/review`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Re-inspection failed');
    } finally {
      setPending(false);
    }
  }

  if (load.kind === 'loading') {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  }
  if (load.kind !== 'ready') {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.mutedText}>
          {load.kind === 'missing' ? 'Inspection not found.' : load.message}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const insp = load.inspection;
  const r = insp.aqlResult;
  const canDecide = roleAtLeast(load.role, 'QA_MANAGER');
  const showDecisionForm = DECIDABLE.has(insp.status) && canDecide;
  const fail = r?.systemRecommendation === 'FAIL';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {insp.purchaseOrder?.poNumber ?? 'Review'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.subLine}>
          {insp.clientCompany?.name ?? '—'} · {insp.product?.styleNumber ?? '—'} · status{' '}
          {insp.status.replace(/_/g, ' ')}
        </Text>

        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

        {/* AQL result */}
        {r ? (
          <View style={styles.card}>
            <View style={styles.recoRow}>
              <Text style={styles.sectionLabel}>System recommendation</Text>
              <Text style={[styles.reco, { color: fail ? severityTint.critical.fg : '#1F8A4C' }]}>
                {r.systemRecommendation}
              </Text>
            </View>
            <Text style={styles.hint}>
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
            <Text style={styles.mutedText}>
              No AQL result yet — submit the inspection to compute the sampling evaluation.
            </Text>
          </View>
        )}

        {/* Pre-submit */}
        {SUBMITTABLE.has(insp.status) ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>QA decision</Text>
            <Text style={styles.hint}>
              This inspection has not been submitted. Submitting locks the audit block and computes
              the AQL result.
            </Text>
            <Pressable
              style={[styles.btn, pending && styles.dim]}
              disabled={pending}
              onPress={submitForReview}
            >
              <Text style={styles.btnLabel}>{pending ? 'Submitting…' : 'Submit for review'}</Text>
            </Pressable>
            <Pressable onPress={() => router.push(`/inspections/${inspectionId}/capture`)}>
              <Text style={styles.link}>Capture photos & defects</Text>
            </Pressable>
          </View>
        ) : showDecisionForm ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>QA decision</Text>
            {DECISIONS.map((d) => (
              <Pressable
                key={d.value}
                style={[styles.decisionRow, decision === d.value && styles.decisionRowActive]}
                onPress={() => setDecision(d.value)}
              >
                <View style={[styles.radio, decision === d.value && styles.radioActive]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.decisionLabel}>{d.label}</Text>
                  <Text style={styles.hint}>{d.hint}</Text>
                </View>
              </Pressable>
            ))}
            <Text style={styles.fieldLabel}>Decision note *</Text>
            <TextInput
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
              value={remarks}
              onChangeText={setRemarks}
              editable={!pending}
              placeholder="Required for every decision, including Pass."
              placeholderTextColor={palette.faint}
            />
            <Pressable
              style={[styles.btn, (!decision || !remarks.trim() || pending) && styles.dim]}
              disabled={!decision || !remarks.trim() || pending}
              onPress={decide}
            >
              <Text style={styles.btnLabel}>{pending ? 'Submitting…' : 'Submit decision'}</Text>
            </Pressable>
            <Text style={styles.hint}>
              Submitting locks the report. Corrections require a new linked re-inspection.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {DECIDABLE.has(insp.status) ? (
              <Text style={styles.mutedText}>Awaiting QA Manager review.</Text>
            ) : (
              <>
                <Text style={styles.sectionLabel}>Final decision</Text>
                <Text style={styles.finalDecision}>{r?.qaDecision ?? insp.status}</Text>
                {r?.qaRemarks ? <Text style={styles.hint}>{r.qaRemarks}</Text> : null}
              </>
            )}
          </View>
        )}

        {REPORTABLE.has(insp.status) ? (
          <Pressable
            onPress={() => router.push(`/inspections/${inspectionId}/report`)}
            hitSlop={8}
          >
            <Text style={styles.reportLink}>View the signed report →</Text>
          </Pressable>
        ) : null}
        {REINSPECTABLE.has(insp.status) && canDecide ? (
          <Pressable
            style={[styles.btnGhost, pending && styles.dim]}
            disabled={pending}
            onPress={() => reInspect(insp)}
          >
            <Text style={styles.btnGhostLabel}>Start linked re-inspection</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
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
  headerTitle: { color: palette.ink, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.4 },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center' },
  errorText: { color: palette.danger, fontSize: 13 },
  body: { padding: 16, gap: 14, paddingBottom: 40 },
  subLine: { color: palette.sub, fontSize: 13 },
  card: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 10,
    backgroundColor: palette.panel,
    padding: 14,
    gap: 10,
  },
  sectionLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  recoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reco: { fontSize: 18, fontWeight: '800' },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  reportLink: { color: palette.accent, fontSize: 14, fontWeight: '600', paddingVertical: 4 },
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
  btn: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnGhost: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: palette.panel,
  },
  btnGhostLabel: { color: palette.sub, fontSize: 14, fontWeight: '600' },
  decisionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    padding: 10,
  },
  decisionRowActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: palette.line,
  },
  radioActive: { borderColor: palette.accent, backgroundColor: palette.accent },
  decisionLabel: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  fieldLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.ink,
    backgroundColor: palette.bg,
    fontSize: 14,
  },
  finalDecision: { color: palette.ink, fontSize: 18, fontWeight: '800' },
});
