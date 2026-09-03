/**
 * Signed report (INS-086 Phase 4) — port of the web `/inspections/[id]/report`
 * behaviour contract. Any authenticated role sees the live preview; the signed
 * report itself (and its generation) is QA_MANAGER-gated by the API, and this
 * screen gates client-side too so an inspector gets an honest note instead of
 * the web page's misleading "not yet generated" banner.
 *
 * Differences from the web screen, each deliberate:
 * - `POST /inspections/:id/report` (idempotent — the API returns the frozen
 *   row and never re-signs) is only fired for QA_MANAGER+, never blind.
 * - 403 / 404 / not-approved are three different states, not one banner.
 * - A pre-generation preview shows an em-dash for the report date, not today.
 * - "Open PDF" exists (GET /reports/:id/pdf → presigned URL); the web screen
 *   renders no action at all — recorded as a product gap, not copied.
 */
import { ApiError } from '@inspect/api-client';
import { palette, severity as severityTint } from '@inspect/design-tokens';
import {
  REPORTABLE_STATUSES,
  conclusionFrom,
  formatGps,
  formatInspectionType,
  reportNumber,
  roleAtLeast,
  type ReportConclusion,
} from '@inspect/domain';
import type {
  InspectionDto,
  MeasurementDto,
  ReportDto,
  ReportPdfDownloadDto,
} from '@inspect/shared-types';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { client, loadIdentity } from '@/lib/session';

const REPORTABLE = new Set<string>(REPORTABLE_STATUSES);
const CLASSES = ['critical', 'major', 'minor'] as const;
const TINT = {
  critical: severityTint.critical,
  major: severityTint.major,
  minor: severityTint.minor,
};
/** Same accept-green the review screen uses; not a severity token. */
const PASS_GREEN = '#1F8A4C';
/** The no-brand-colour fallback the branded report uses on web. */
const CLIENT_FALLBACK = '#1457A3';

const CONCLUSION_LABEL: Record<ReportConclusion, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  hold: 'HOLD',
  pending: 'PENDING',
};

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      inspection: InspectionDto;
      report: ReportDto | null;
      /** Why there is no signed report, when the reason is not plain status. */
      reportNote: string | null;
    };

/** Pure fetch — setState only ever happens in .then. */
async function fetchReport(id: string): Promise<Load> {
  let inspection: InspectionDto;
  let role: string | undefined;
  try {
    const [insp, identity] = await Promise.all([
      client.get<InspectionDto>(`/inspections/${id}`),
      loadIdentity(),
    ]);
    inspection = insp;
    role = identity?.role;
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

  let report: ReportDto | null = null;
  let reportNote: string | null = null;
  if (REPORTABLE.has(inspection.status)) {
    if (!roleAtLeast(role, 'QA_MANAGER')) {
      reportNote = 'The signed report is visible to QA Managers and above.';
    } else {
      try {
        // Idempotent on the API: returns the existing frozen row, never re-signs.
        report = await client.post<ReportDto>(`/inspections/${id}/report`, {});
      } catch (e) {
        reportNote =
          e instanceof ApiError && e.status === 403
            ? 'QA Manager access is required for the signed report.'
            : `Report unavailable: ${e instanceof Error ? e.message : 'unknown error'}`;
      }
    }
  }
  return { kind: 'ready', inspection, report, reportNote };
}

function groupMeasurements(measurements: MeasurementDto[] | undefined) {
  const byCycle = new Map<number, MeasurementDto[]>();
  for (const m of measurements ?? []) {
    byCycle.set(m.cycleIndex, [...(byCycle.get(m.cycleIndex) ?? []), m]);
  }
  return [...byCycle.keys()]
    .sort((a, b) => a - b)
    .map((c) => ({
      cycleIndex: c,
      items: byCycle.get(c) ?? [],
    }));
}

export default function Report() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspectionId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [pdfPending, setPdfPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchReport(inspectionId).then(setLoad);
  }, [inspectionId]);
  useEffect(reload, [reload]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLoad(await fetchReport(inspectionId));
    setRefreshing(false);
  }, [inspectionId]);

  async function openPdf(reportId: string) {
    setPdfPending(true);
    setActionError(null);
    try {
      const { url } = await client.get<ReportPdfDownloadDto>(`/reports/${reportId}/pdf`);
      await Linking.openURL(url);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not open the PDF.');
    } finally {
      setPdfPending(false);
    }
  }

  if (load.kind === 'loading') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (load.kind === 'missing' || load.kind === 'error') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>
            {load.kind === 'missing' ? 'Inspection not found' : 'Could not load the report'}
          </Text>
          {load.kind === 'error' ? <Text style={styles.mutedText}>{load.message}</Text> : null}
          <View style={styles.centerActions}>
            {load.kind === 'error' ? (
              <Pressable onPress={reload} hitSlop={8}>
                <Text style={styles.link}>Retry</Text>
              </Pressable>
            ) : null}
            <BackButton label="Go back" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const { inspection: insp, report, reportNote } = load;
  const conclusion = conclusionFrom(insp.aqlResult?.qaDecision);
  const clientColor = insp.clientCompany?.primaryColor ?? CLIENT_FALLBACK;
  const conclusionColor =
    conclusion === 'pass'
      ? PASS_GREEN
      : conclusion === 'fail'
        ? severityTint.critical.fg
        : conclusion === 'hold'
          ? severityTint.major.fg
          : palette.sub;
  const gps = formatGps(insp.factoryCompany?.gps);
  const photoGroups = (insp.items ?? []).filter((i) => (i.photos?.length ?? 0) > 0);
  const measurementGroups = groupMeasurements(insp.measurements);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent} />
        }
      >
        {/* Identity */}
        <View style={styles.headRow}>
          <View style={[styles.brandDot, { backgroundColor: clientColor }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.clientName} numberOfLines={1}>
              {insp.clientCompany?.name ?? '—'}
            </Text>
            <Text style={styles.reportNo}>
              {report ? reportNumber(report.id) : 'Report preview'}
            </Text>
          </View>
          <View style={[styles.conclusion, { borderColor: conclusionColor }]}>
            <Text style={[styles.conclusionLabel, { color: conclusionColor }]}>
              {CONCLUSION_LABEL[conclusion]}
            </Text>
          </View>
        </View>

        {!report ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {reportNote ??
                `Report not yet generated — the inspection must be APPROVED. Current status: ${insp.status.replace(/_/g, ' ')}.`}
            </Text>
          </View>
        ) : null}
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

        {/* Meta */}
        <View style={styles.card}>
          <MetaRow label="PO" value={insp.purchaseOrder?.poNumber ?? '—'} />
          <MetaRow label="Product" value={insp.product?.styleNumber ?? '—'} />
          <MetaRow label="Factory" value={insp.factoryCompany?.name ?? '—'} />
          <MetaRow label="Type" value={formatInspectionType(insp.inspectionType)} />
          {gps ? <MetaRow label="Factory GPS" value={gps} /> : null}
          <MetaRow
            label="Report date"
            value={report?.generatedAt ? report.generatedAt.slice(0, 10) : '—'}
          />
        </View>

        {/* Sampling plan */}
        {insp.computedSampling ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Sampling plan (ISO 2859-1, Level II)</Text>
            <Text style={styles.hint}>
              Lot {insp.lotSize ?? '—'} · code {insp.computedSampling.sampleSizeCodeLetter} · sample
              n {insp.computedSampling.sampleSize}
            </Text>
            {CLASSES.map((cls) => {
              const plan = insp.computedSampling?.perClass?.[cls];
              const result = insp.aqlResult?.perClass?.[cls];
              if (!plan && !result) return null;
              const rej = result?.outcome === 'FAIL';
              return (
                <View key={cls} style={styles.classRow}>
                  <View style={[styles.chip, { backgroundColor: TINT[cls].bg }]}>
                    <Text style={[styles.chipLabel, { color: TINT[cls].fg }]}>
                      {cls.charAt(0).toUpperCase() + cls.slice(1)}
                    </Text>
                  </View>
                  <Text style={styles.classCell}>AQL {plan?.aql ?? '—'}</Text>
                  <Text style={styles.classCell}>
                    {result ? `found ${result.found}` : 'found —'}
                  </Text>
                  <Text style={styles.classCell}>
                    Ac {(result ?? plan)?.ac ?? '—'} · Re {(result ?? plan)?.re ?? '—'}
                  </Text>
                  {result ? (
                    <Text
                      style={[
                        styles.classOutcome,
                        { color: rej ? severityTint.critical.fg : PASS_GREEN },
                      ]}
                    >
                      {rej ? 'Reject' : 'Accept'}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Photo evidence — grouped by loop ITEM (INS-081). */}
        {photoGroups.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Photo evidence</Text>
            {photoGroups.map((item) => {
              const flagged = (item.defects ?? []).filter((d) => d.severity === 'MAJOR').length;
              return (
                <View key={item.id} style={styles.photoGroup}>
                  <Text style={styles.photoGroupTitle}>
                    {item.itemName}
                    <Text style={styles.hint}>
                      {'  '}
                      {item.photos?.length ?? 0} shot
                      {(item.photos?.length ?? 0) === 1 ? '' : 's'}
                      {flagged ? ` · ${flagged} flagged` : ''}
                    </Text>
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.photoStrip}>
                      {(item.photos ?? []).map((p) =>
                        p.viewUrl ? (
                          <Image key={p.id} source={{ uri: p.viewUrl }} style={styles.thumb} />
                        ) : (
                          <View key={p.id} style={[styles.thumb, styles.thumbFallback]}>
                            <Text style={styles.thumbFallbackText}>U{p.cycleIndex + 1}</Text>
                          </View>
                        ),
                      )}
                    </View>
                  </ScrollView>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Measurements — loop-global sheet, grouped by UNIT (INS-081). */}
        {measurementGroups.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Measurements</Text>
            {measurementGroups.map((g) => (
              <View key={g.cycleIndex} style={styles.measureGroup}>
                <Text style={styles.measureUnit}>Unit {g.cycleIndex + 1}</Text>
                {g.items.map((m) => (
                  <View key={m.id} style={styles.measureRow}>
                    <Text style={styles.measureLabel} numberOfLines={1}>
                      {m.label}
                    </Text>
                    <Text style={styles.measureValue}>
                      {m.recordedValue ?? '—'}
                      {m.unit ? ` ${m.unit}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {/* Tamper-proof block */}
        {report ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Tamper-proof</Text>
            <MetaRow label="Signed at" value={report.generatedAt.slice(0, 10)} />
            {/* Recording the signer is INS-089 — the model has no column yet. */}
            <MetaRow label="Signed by" value="—" />
            {report.contentHash ? (
              <View style={styles.hashBlock}>
                <Text style={styles.hint}>Content hash (sha256)</Text>
                <Text style={styles.hash}>{report.contentHash}</Text>
              </View>
            ) : null}
            {report.pdfStorageKey ? (
              <Pressable
                style={[styles.button, pdfPending && styles.buttonDisabled]}
                onPress={() => openPdf(report.id)}
                disabled={pdfPending}
              >
                <Text style={styles.buttonLabel}>{pdfPending ? 'Opening…' : 'Open PDF'}</Text>
              </Pressable>
            ) : (
              <Text style={styles.hint}>PDF not yet rendered.</Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 16, gap: 12 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  centerActions: { flexDirection: 'row', gap: 24, marginTop: 8 },
  errorTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  errorText: { color: palette.danger, fontSize: 13 },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center' },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandDot: { width: 34, height: 34, borderRadius: 17 },
  clientName: { color: palette.ink, fontSize: 18, fontWeight: '700' },
  reportNo: { color: palette.sub, fontSize: 13, marginTop: 1 },
  conclusion: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  conclusionLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  banner: {
    borderWidth: 1,
    borderColor: severityTint.major.fg,
    backgroundColor: severityTint.major.bg,
    borderRadius: 8,
    padding: 12,
  },
  bannerText: { color: severityTint.major.fg, fontSize: 13, lineHeight: 18 },
  card: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  sectionLabel: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hint: { color: palette.faint, fontSize: 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  metaLabel: { color: palette.sub, fontSize: 13 },
  metaValue: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  classRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 68,
    alignItems: 'center',
  },
  chipLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  classCell: { color: palette.sub, fontSize: 12.5 },
  classOutcome: { fontSize: 12.5, fontWeight: '700', marginLeft: 'auto' },
  photoGroup: { gap: 6 },
  photoGroupTitle: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  photoStrip: { flexDirection: 'row', gap: 8 },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: palette.lineSoft,
  },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbFallbackText: { color: palette.faint, fontSize: 12, fontWeight: '600' },
  measureGroup: { gap: 4 },
  measureUnit: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  measureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  measureLabel: { color: palette.sub, fontSize: 13, flexShrink: 1 },
  measureValue: { color: palette.ink, fontSize: 13, fontWeight: '600' },
  hashBlock: { gap: 2 },
  hash: { color: palette.ink, fontSize: 11 },
  button: {
    marginTop: 4,
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 10,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
