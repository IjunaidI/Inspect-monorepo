/**
 * Inspections tab (INS-096 M2). The org's inspections (inspector-scoped by the
 * API), searchable on PO / style / client and filterable by the shared
 * `STATUS_BUCKETS`. Every row opens the inspection: capture while it is open,
 * review once it is locked — mirroring the API's "viewable after submit" rule.
 */
import { ApiError } from '@inspect/api-client';
import { STATUS_BUCKETS, filterOptions, isLockedStatus, roleAtLeast } from '@inspect/domain';
import type { InspectionDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  ListRow,
  SkeletonRows,
  StatusChip,
} from '@/components/ui';
import { client, signOut } from '@/lib/session';
import { useSession } from '@/lib/session-context';
import { theme } from '@/theme';

const { colors, space } = theme;

type LoadResult =
  | { kind: 'rows'; rows: InspectionDto[] }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string };

/** Pure fetch — no component state captured, so effects may call it freely. */
async function fetchInspections(): Promise<LoadResult> {
  try {
    return { kind: 'rows', rows: await client.get<InspectionDto[]>('/inspections') };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { kind: 'unauthorized' };
    return {
      kind: 'error',
      message: e instanceof ApiError ? e.message : 'Could not reach the Inspect API. Pull to retry.',
    };
  }
}

type BucketKey = (typeof STATUS_BUCKETS)[number]['key'] | 'all';

function searchText(row: InspectionDto): string {
  return [row.purchaseOrder?.poNumber, row.product?.styleNumber, row.clientCompany?.name, row.factoryCompany?.name, row.status]
    .filter(Boolean)
    .join(' ');
}

export default function Inspections() {
  const router = useRouter();
  const { identity } = useSession();
  const qa = roleAtLeast(identity?.role, 'QA_MANAGER');

  const [rows, setRows] = useState<InspectionDto[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState<BucketKey>('all');

  const apply = useCallback(async (result: LoadResult) => {
    if (result.kind === 'unauthorized') {
      // Session expired beyond refresh — the root guard shows login.
      await signOut();
      return;
    }
    if (result.kind === 'rows') {
      setRows(result.rows);
      setError(null);
    } else {
      setError(result.message);
    }
  }, []);

  useEffect(() => {
    fetchInspections().then(apply);
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await apply(await fetchInspections());
    setRefreshing(false);
  }, [apply]);

  const visible = useMemo(() => {
    const all = rows ?? [];
    const inBucket =
      bucket === 'all'
        ? all
        : all.filter((r) => STATUS_BUCKETS.find((b) => b.key === bucket)?.statuses.includes(r.status as never));
    return filterOptions(query, inBucket, searchText);
  }, [rows, bucket, query]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    const out: Record<string, number> = { all: all.length };
    for (const b of STATUS_BUCKETS) out[b.key] = all.filter((r) => b.statuses.includes(r.status as never)).length;
    return out;
  }, [rows]);

  const header = (
    <Header
      title="Inspections"
      subtitle={identity?.orgName ?? null}
      action={qa ? { label: 'New', onPress: () => router.push('/inspections/new') } : undefined}
    >
      <Input
        leading="searchOutline"
        placeholder="Search PO, style or client"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={`All · ${counts.all}`} active={bucket === 'all'} onPress={() => setBucket('all')} />
        {STATUS_BUCKETS.map((b) => (
          <Chip
            key={b.key}
            label={counts[b.key] ? `${b.label} · ${counts[b.key]}` : b.label}
            active={bucket === b.key}
            onPress={() => setBucket(b.key)}
          />
        ))}
      </ScrollView>
    </Header>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      {header}
      {rows === null && !error ? (
        <View style={styles.body}>
          <SkeletonRows count={6} />
        </View>
      ) : rows === null && error ? (
        <ErrorState title="Could not load inspections" body={error} onRetry={() => void refresh()} back={false} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
          contentContainerStyle={visible.length ? styles.list : styles.listEmpty}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <EmptyState
              icon="inspections"
              title={query || bucket !== 'all' ? 'No matches' : 'No inspections yet'}
              body={
                query || bucket !== 'all'
                  ? 'Try another search or filter.'
                  : qa
                    ? 'Start the first one from New.'
                    : 'Inspections assigned to you will appear here.'
              }
              action={qa && !query && bucket === 'all' ? { label: 'New inspection', icon: 'camera', onPress: () => router.push('/inspections/new') } : undefined}
            />
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.purchaseOrder?.poNumber ?? '—'}
              subtitle={[item.clientCompany?.name ?? '—', item.product?.styleNumber].filter(Boolean).join(' · ')}
              meta={[
                (item.inspectionType ?? '').replace(/_/g, ' ').toLowerCase(),
                item.createdAt ? new Date(item.createdAt).toLocaleDateString() : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              trailing={<StatusChip status={item.status} />}
              chevron
              onPress={() =>
                router.push(
                  isLockedStatus(item.status)
                    ? (`/inspections/${item.id}/review` as never)
                    : (`/inspections/${item.id}/capture` as never),
                )
              }
            />
          )}
        />
      )}
      {error && rows !== null ? <View style={styles.noticeSpacer} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  chips: { gap: space[2], paddingRight: space[6] },
  body: { padding: space[6] },
  list: { padding: space[6], paddingBottom: space[8] },
  listEmpty: { flexGrow: 1 },
  separator: { height: space[2] },
  noticeSpacer: { height: 0 },
});
