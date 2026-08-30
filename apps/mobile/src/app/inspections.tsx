import { ApiError } from '@inspect/api-client';
import { palette, severity } from '@inspect/design-tokens';
import type { InspectionDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { client, loadIdentity, signOut, type Identity } from '@/lib/session';

/**
 * Status chip presentation, composed from the shared tokens only — no new
 * hexes. Severity fg/bg pairs double as generic amber/red/gray chip tints.
 */
const STATUS_TINT: Record<string, { fg: string; bg: string }> = {
  DRAFT: { fg: severity.minor.fg, bg: severity.minor.bg },
  ASSIGNED: { fg: severity.minor.fg, bg: severity.minor.bg },
  IN_PROGRESS: { fg: palette.accent, bg: palette.accentSoft },
  SUBMITTED: { fg: severity.major.fg, bg: severity.major.bg },
  UNDER_REVIEW: { fg: severity.major.fg, bg: severity.major.bg },
  APPROVED: { fg: palette.accent, bg: palette.accentSoft },
  REPORT_ISSUED: { fg: palette.accent, bg: palette.accentSoft },
  REJECTED: { fg: severity.critical.fg, bg: severity.critical.bg },
  HOLD: { fg: severity.major.fg, bg: severity.major.bg },
};

function StatusChip({ status }: { status: string }) {
  const tint = STATUS_TINT[status] ?? { fg: palette.sub, bg: palette.lineSoft };
  return (
    <View style={[styles.chip, { backgroundColor: tint.bg }]}>
      <Text style={[styles.chipLabel, { color: tint.fg }]}>{status.replace(/_/g, ' ')}</Text>
    </View>
  );
}

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
      message:
        e instanceof ApiError ? e.message : 'Could not reach the Inspect API. Pull to retry.',
    };
  }
}

export default function Inspections() {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [rows, setRows] = useState<InspectionDto[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    async (result: LoadResult) => {
      if (result.kind === 'unauthorized') {
        // Session expired beyond refresh — back to login, cleanly.
        await signOut();
        router.replace('/login');
        return;
      }
      if (result.kind === 'rows') {
        setRows(result.rows);
        setError(null);
      } else {
        setError(result.message);
      }
    },
    [router],
  );

  useEffect(() => {
    loadIdentity().then(setIdentity);
    fetchInspections().then(apply);
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await apply(await fetchInspections());
    setRefreshing(false);
  }, [apply]);

  async function onSignOut() {
    await signOut();
    router.replace('/login');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Inspections</Text>
          {identity ? (
            <Text style={styles.subtitle}>
              {identity.orgName ?? identity.email ?? ''}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={onSignOut} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={rows ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={palette.accent}
          />
        }
        contentContainerStyle={rows?.length ? styles.list : styles.listEmpty}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          rows === null ? null : (
            <Text style={styles.empty}>
              {error ? '' : 'No inspections in this workspace yet.'}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.po} numberOfLines={1}>
                {item.purchaseOrder?.poNumber ?? '—'}
              </Text>
              <StatusChip status={item.status} />
            </View>
            <Text style={styles.rowSub} numberOfLines={1}>
              {item.clientCompany?.name ?? '—'}
              {item.product?.styleNumber ? `  ·  ${item.product.styleNumber}` : ''}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {(item.inspectionType ?? '').replace(/_/g, ' ')}
              {item.createdAt ? `  ·  ${new Date(item.createdAt).toLocaleDateString()}` : ''}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.panel,
  },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  subtitle: { color: palette.sub, fontSize: 13, marginTop: 2 },
  signOut: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  notice: {
    margin: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
  },
  noticeText: { color: palette.danger, fontSize: 13 },
  list: { padding: 16 },
  listEmpty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  separator: { height: 8 },
  empty: { color: palette.faint, fontSize: 14 },
  row: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 4,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  po: { color: palette.ink, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  rowSub: { color: palette.sub, fontSize: 14 },
  rowMeta: { color: palette.faint, fontSize: 12 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
});
