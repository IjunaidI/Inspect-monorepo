/**
 * Home (INS-099). What the person opening the app should do next, and where
 * the work stands — role-shaped:
 *
 * - QA Manager and above: quick-start tiles (New inspection · New loop ·
 *   Continue · Reports), the pipeline stat cards from `GET /dashboard/summary`
 *   (the same `STATUS_BUCKETS` fold as the console — the four tiles always sum
 *   to the org total), recent inspections and recent reports.
 * - Inspector: a "Continue / Start" callout for their next inspection
 *   (`nextForInspector`), their own counts folded from `GET /inspections`
 *   (already inspector-scoped server-side), and the rows assigned to them.
 *
 * `passRate` / `dphu` render "—" when null, never 0 % — "no decisions yet"
 * must not read as "everything failed" (INS-068). No new API (decision D11).
 */
import { ApiError } from '@inspect/api-client';
import {
  STATUS_BUCKETS,
  bucketCounts,
  isLockedStatus,
  nextForInspector,
  roleAtLeast,
  statusCounts,
} from '@inspect/domain';
import type { DashboardSummaryDto, InspectionDto, ReportListItemDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  Avatar,
  Button,
  Card,
  ErrorState,
  Grid,
  Header,
  IconTile,
  ListRow,
  Screen,
  SectionHeading,
  SectionLabel,
  SkeletonRows,
  StatCard,
  StatusChip,
  type IconName,
} from '@/components/ui';
import { fetchMissing } from '@/lib/fetch-missing';
import { client, signOut } from '@/lib/session';
import { useSession } from '@/lib/session-context';
import { text, theme } from '@/theme';

const { colors, space } = theme;

type Lists = {
  inspections: InspectionDto[];
  summary: DashboardSummaryDto;
  reports: ReportListItemDto[];
};

const num = (value: number) => value.toLocaleString('en-US');
const pct = (value: number | null) => (value === null ? '—' : `${num(value)}%`);

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const ROLE_LABEL: Record<string, string> = {
  INSPECTOR: 'Inspector',
  QA_MANAGER: 'QA Manager',
  ORG_OWNER: 'Owner',
  PLATFORM_ADMIN: 'Admin',
};

/** First name from the profile name, else from an email like `riya.saraf@…` → "Riya", else the role label. */
function displayName(name: string | null | undefined, email: string | undefined, role: string | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  if (first) return first;
  if (email) {
    const local = email.split('@')[0] ?? '';
    const first = local.split(/[._-]/)[0];
    if (first && first.length > 1) return first.charAt(0).toUpperCase() + first.slice(1);
  }
  return ROLE_LABEL[role ?? ''] ?? 'there';
}

function inspectionTitle(row: InspectionDto): string {
  const po = row.purchaseOrder?.poNumber ?? '—';
  const style = row.product?.styleNumber;
  return style ? `${po} · ${style}` : po;
}

function inspectionSubtitle(row: InspectionDto): string {
  const parts = [row.clientCompany?.name, row.factoryCompany?.name].filter(Boolean) as string[];
  if (row.createdAt) parts.push(new Date(row.createdAt).toLocaleDateString());
  return parts.join(' · ') || '—';
}

function QuickTile({
  icon,
  tone,
  title,
  sub,
  onPress,
}: {
  icon: IconName;
  tone: 'primary' | 'accent' | 'neutral' | 'info';
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Card onPress={onPress} padded={false} style={styles.quickTile} accessibilityLabel={title}>
      <IconTile name={icon} tone={tone} round />
      <Text style={styles.quickTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.quickSub} numberOfLines={1}>
        {sub}
      </Text>
    </Card>
  );
}

export default function Home() {
  const router = useRouter();
  const { identity } = useSession();
  const qa = roleAtLeast(identity?.role, 'QA_MANAGER');

  const [lists, setLists] = useState<Partial<Lists>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Pure fetch — setState only ever happens in `apply`, called from `.then`.
  const fetchLists = useCallback(
    (have: Partial<Lists>) => {
      const fetchers = {
        inspections: () => client.get<InspectionDto[]>('/inspections'),
        ...(qa
          ? {
              summary: () => client.get<DashboardSummaryDto>('/dashboard/summary'),
              reports: () => client.get<ReportListItemDto[]>('/reports'),
            }
          : {}),
      } as Parameters<typeof fetchMissing<Lists>>[1];
      return fetchMissing<Lists>(have, fetchers);
    },
    [qa],
  );

  const apply = useCallback(async (result: Awaited<ReturnType<typeof fetchLists>>) => {
    setLists(result.values);
    const unauthorized = result.failures.find(
      (f) => f.error instanceof ApiError && f.error.status === 401,
    );
    if (unauthorized) {
      // Session expired beyond refresh — the root guard shows login.
      await signOut();
      return;
    }
    const first = result.failures[0];
    setFailed(
      first
        ? first.error instanceof ApiError
          ? first.error.message
          : 'Could not reach the Inspect API.'
        : null,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLists({}).then(apply);
  }, [fetchLists, apply]);

  const load = useCallback(
    async (have: Partial<Lists>) => apply(await fetchLists(have)),
    [fetchLists, apply],
  );

  const inspections = lists.inspections ?? [];
  const mine = qa ? null : nextForInspector(inspections, null);
  const counts = qa && lists.summary ? bucketCounts(lists.summary.inspectionsByStatus ?? {}) : bucketCounts(statusCounts(inspections));
  const quality = lists.summary?.quality;
  const recent = inspections.slice(0, 3);
  const reports = (lists.reports ?? []).slice(0, 3);

  const openInspection = (row: InspectionDto) =>
    router.push(
      isLockedStatus(row.status)
        ? (`/inspections/${row.id}/review` as never)
        : (`/inspections/${row.id}/capture` as never),
    );

  const header = (
    <Header
      overline={identity?.orgName ?? undefined}
      title={`${greeting()}, ${displayName(identity?.name, identity?.email, identity?.role)}`}
      right={
        <Avatar
          name={identity?.name ?? identity?.email ?? 'Inspect'}
          id={identity?.userId ?? identity?.email}
          size={40}
        />
      }
    />
  );

  if (loading && inspections.length === 0 && !failed) {
    return (
      <Screen header={header}>
        <SkeletonRows count={5} />
      </Screen>
    );
  }

  if (failed && inspections.length === 0 && !lists.summary) {
    return (
      <Screen header={header} scroll={false}>
        <ErrorState title="Could not load Home" body={failed} onRetry={() => void load({})} back={false} />
      </Screen>
    );
  }

  return (
    <Screen header={header} onRefresh={() => load({})}>
      {qa ? (
        <View style={styles.section}>
          <SectionLabel>Quick start</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
            <QuickTile icon="camera" tone="primary" title="New inspection" sub="Pick a PO" onPress={() => router.push('/inspections/new')} />
            <QuickTile icon="inspections" tone="accent" title="New loop" sub="Build a preset" onPress={() => router.push('/presets/new')} />
            <QuickTile
              icon="report"
              tone="neutral"
              title="Reports"
              sub={lists.summary ? `${num(lists.summary.reports)} signed` : 'Signed PDFs'}
              onPress={() => router.push('/reports')}
            />
            <QuickTile icon="library" tone="info" title="Library" sub="Presets & data" onPress={() => router.push('/library' as never)} />
          </ScrollView>
        </View>
      ) : mine ? (
        <Card tone="emphasis" padded={20} style={styles.continueCard}>
          <View style={styles.continueRow}>
            <IconTile name="play" tone="primary" />
            <View style={styles.continueText}>
              <Text style={styles.continueOverline}>
                {mine.kind === 'continue' ? 'Continue where you left off' : 'Ready to start'}
              </Text>
              <Text style={styles.continueTitle} numberOfLines={1}>
                {inspectionTitle(mine.inspection)}
              </Text>
              <Text style={styles.continueSub} numberOfLines={1}>
                {inspectionSubtitle(mine.inspection)}
              </Text>
            </View>
          </View>
          <Button
            label={mine.kind === 'continue' ? 'Resume capture' : 'Start capture'}
            icon="camera"
            fullWidth
            onPress={() => router.push(`/inspections/${mine.inspection.id}/capture` as never)}
          />
        </Card>
      ) : null}

      <View style={styles.section}>
        <SectionLabel action={qa && lists.summary?.quality.truncated ? { label: 'Recent window', onPress: () => {} } : undefined}>
          {qa ? 'Pipeline' : 'My work'}
        </SectionLabel>
        <Grid>
          {qa ? (
            <>
              <StatCard label="In progress" value={num(counts.inProgress)} tone="info" />
              <StatCard label="Awaiting review" value={num(counts.awaitingReview)} tone="warning" />
              <StatCard
                label="Pass rate"
                value={pct(quality?.passRate ?? null)}
                tone="success"
                hint={quality ? (quality.passRate === null ? 'No decisions yet' : `${num(quality.verdicts)} verdict${quality.verdicts === 1 ? '' : 's'}`) : null}
              />
              <StatCard
                label="DPHU"
                value={quality?.dphu == null ? '—' : num(quality.dphu)}
                tone="accent"
                hint={quality?.dphu == null ? null : 'defects / 100 units'}
              />
            </>
          ) : (
            STATUS_BUCKETS.map((bucket) => (
              <StatCard
                key={bucket.key}
                label={bucket.key === 'inProgress' ? 'In progress' : bucket.label}
                value={num(counts[bucket.key])}
                tone={bucket.key === 'inProgress' ? 'info' : bucket.key === 'awaitingReview' ? 'warning' : bucket.key === 'passed' ? 'success' : 'danger'}
              />
            ))
          )}
        </Grid>
      </View>

      <View style={styles.section}>
        <SectionHeading
          title={qa ? 'Recent inspections' : 'Assigned to you'}
          action={{ label: 'View all', onPress: () => router.push('/inspections') }}
        />
        {recent.length === 0 ? (
          <Card tone="muted">
            <Text style={text('body', colors.mutedForeground)}>
              {qa ? 'No inspections yet. Start one from Quick start.' : 'Nothing assigned to you yet.'}
            </Text>
          </Card>
        ) : (
          <View style={styles.rows}>
            {recent.map((row) => (
              <ListRow
                key={row.id}
                title={inspectionTitle(row)}
                subtitle={inspectionSubtitle(row)}
                trailing={<StatusChip status={row.status} />}
                onPress={() => openInspection(row)}
              />
            ))}
          </View>
        )}
      </View>

      {qa && reports.length > 0 ? (
        <View style={styles.section}>
          <SectionHeading title="Recent reports" action={{ label: 'View all', onPress: () => router.push('/reports') }} />
          <View style={styles.rows}>
            {reports.map((r) => (
              <ListRow
                key={r.id}
                title={r.clientCompany?.name ?? 'Signed report'}
                subtitle={new Date(r.generatedAt).toLocaleDateString()}
                leading={<IconTile name="signed" tone="success" size={40} />}
                chevron
                onPress={() => router.push(`/inspections/${r.inspectionId}/report` as never)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {failed ? (
        <Card tone="muted">
          <Text style={text('caption', colors.mutedForeground)}>Some data did not load: {failed}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
  carousel: { gap: space[3], paddingRight: space[6] },
  quickTile: {
    minWidth: 124,
    paddingHorizontal: 12,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 8,
  },
  quickTitle: { ...text('label'), textAlign: 'center' },
  quickSub: { ...text('caption', colors.mutedForeground), marginTop: -4, textAlign: 'center' },
  continueCard: { gap: space[4] },
  continueRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  continueText: { flex: 1, minWidth: 0 },
  continueOverline: { ...text('overline', colors.primary) },
  continueTitle: { ...text('subheading'), marginTop: 4 },
  continueSub: { ...text('caption', colors.mutedForeground), marginTop: 2 },
  rows: { gap: space[2] },
});
