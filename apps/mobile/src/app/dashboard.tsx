/**
 * Dashboard (INS-086 Phase 4) — port of the web `/dashboard` KPI surface.
 * Role floor QA_MANAGER (the web redirects an inspector away; here the gate
 * renders an honest forbidden card). The company DIRECTORY, which shares the
 * web route, is its own `/companies` screen on the phone — this screen is the
 * QA hub: the four status tiles, the quality KPIs, and links onward.
 *
 * The four tiles read @inspect/domain's STATUS_BUCKETS — the same exhaustive
 * partition the web page renders — so the tiles always sum to the org total
 * on both platforms. `passRate`/`dphu` render "—" when null, never 0%: "no
 * decisions yet" must not read as "everything failed" (INS-068).
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { STATUS_BUCKETS, roleAtLeast } from '@inspect/domain';
import type { DashboardSummaryDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { client, loadIdentity, signOut } from '@/lib/session';

const countIn = (byStatus: Record<string, number>, statuses: readonly string[]) =>
  statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);

const num = (value: number) => value.toLocaleString('en-US');
/** `null` (nothing decided yet) renders as an em dash, never as NaN or a bare 0. */
const pct = (value: number | null) => (value === null ? '—' : `${num(value)}%`);

type Load =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; summary: DashboardSummaryDto };

/** Pure fetch — setState only ever happens in .then. */
async function fetchSummary(): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    return {
      kind: 'ready',
      summary: await client.get<DashboardSummaryDto>('/dashboard/summary'),
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { kind: 'unauthorized' };
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return { kind: 'error', message: e instanceof Error ? e.message : 'Load failed' };
  }
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const apply = useCallback(
    async (result: Load) => {
      if (result.kind === 'unauthorized') {
        await signOut();
        router.replace('/login');
        return;
      }
      setLoad(result);
    },
    [router],
  );

  useEffect(() => {
    fetchSummary().then(apply);
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await apply(await fetchSummary());
    setRefreshing(false);
  }, [apply]);

  if (load.kind === 'loading') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (load.kind === 'forbidden' || load.kind === 'error' || load.kind === 'unauthorized') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>
            {load.kind === 'forbidden' ? 'QA Manager access required' : 'Could not load the dashboard'}
          </Text>
          <Text style={styles.mutedText}>
            {load.kind === 'forbidden'
              ? 'The dashboard is visible to QA Managers and above.'
              : load.kind === 'error'
                ? load.message
                : ''}
          </Text>
          <View style={styles.centerActions}>
            {load.kind === 'error' ? (
              <Pressable onPress={() => fetchSummary().then(apply)} hitSlop={8}>
                <Text style={styles.link}>Retry</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={styles.link}>Go back</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const { summary } = load;
  const byStatus = summary.inspectionsByStatus ?? {};
  const quality = summary.quality;
  // Zero-state: no verdict yet -> "—" with a hint saying why, rather than a
  // confident-looking 0% a QA manager would read as "everything failed".
  const qualityHint =
    quality.passRate === null
      ? 'No decisions yet'
      : `DPHU ${quality.dphu === null ? '—' : num(quality.dphu)} · ${num(quality.verdicts)} verdict${quality.verdicts === 1 ? '' : 's'}${quality.truncated ? ' (recent)' : ''}`;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent} />
        }
      >
        <Text style={styles.title}>Dashboard</Text>

        <View style={styles.tileGrid}>
          {STATUS_BUCKETS.map(({ key, label, statuses }) => (
            <Tile key={key} label={label} value={num(countIn(byStatus, statuses))} />
          ))}
        </View>
        <Tile label="Pass rate" value={pct(quality.passRate)} hint={qualityHint} />

        <View style={styles.tileGrid}>
          <Tile label="Companies" value={num(summary.companies)} />
          <Tile label="Products" value={num(summary.products)} />
          <Tile label="Purchase orders" value={num(summary.purchaseOrders)} />
          <Tile label="Reports" value={num(summary.reports)} />
        </View>

        <View style={styles.navCard}>
          <Pressable onPress={() => router.push('/companies')} hitSlop={4}>
            <Text style={styles.navLink}>Company directory →</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/products')} hitSlop={4}>
            <Text style={styles.navLink}>Products →</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/reports')} hitSlop={4}>
            <Text style={styles.navLink}>Signed reports →</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/inspections')} hitSlop={4}>
            <Text style={styles.navLink}>Inspections →</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  centerActions: { flexDirection: 'row', gap: 24, marginTop: 8 },
  errorTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 4,
  },
  tileLabel: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tileValue: { color: palette.ink, fontSize: 22, fontWeight: '700' },
  tileHint: { color: palette.faint, fontSize: 12 },
  navCard: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 12,
  },
  navLink: { color: palette.accent, fontSize: 15, fontWeight: '600' },
});
