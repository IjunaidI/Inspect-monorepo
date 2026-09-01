/**
 * Purchase orders list (INS-086 Phase 4) — port of the web `/purchase-orders`
 * list. Role floor QA_MANAGER. The API's list takes no query params (no
 * search/paging exists in the stack for POs — a recorded gap, not something
 * to invent client-side); the demo-data fallback is not ported.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { PurchaseOrderDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { client, loadIdentity, signOut } from '@/lib/session';

type Load =
  | { kind: 'rows'; rows: PurchaseOrderDto[] }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

/** Pure fetch — no component state captured, so effects may call it freely. */
async function fetchPos(): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    return { kind: 'rows', rows: await client.get<PurchaseOrderDto[]>('/purchase-orders') };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { kind: 'unauthorized' };
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return {
      kind: 'error',
      message:
        e instanceof ApiError ? e.message : 'Could not reach the Inspect API. Pull to retry.',
    };
  }
}

export default function PurchaseOrders() {
  const router = useRouter();
  const [rows, setRows] = useState<PurchaseOrderDto[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const apply = useCallback(
    async (result: Load) => {
      if (result.kind === 'unauthorized') {
        await signOut();
        router.replace('/login');
        return;
      }
      if (result.kind === 'forbidden') {
        setForbidden(true);
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
    fetchPos().then(apply);
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await apply(await fetchPos());
    setRefreshing(false);
  }, [apply]);

  if (forbidden) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.forbiddenTitle}>QA Manager access required</Text>
          <Text style={styles.forbiddenBody}>
            Purchase orders are visible to QA Managers and above.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Purchase orders</Text>
          <Pressable onPress={() => router.push('/purchase-orders/new')} hitSlop={8}>
            <Text style={styles.newLink}>New</Text>
          </Pressable>
        </View>
        {rows !== null ? (
          <Text style={styles.subtitle}>
            {rows.length} purchase order{rows.length === 1 ? '' : 's'}
          </Text>
        ) : null}
      </View>

      {error ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{error}</Text>
          <Pressable onPress={refresh} hitSlop={8}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {rows === null && !error ? (
        <View style={styles.centered}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent} />
          }
          contentContainerStyle={rows?.length ? styles.list : styles.listEmpty}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            error ? null : (
              <Text style={styles.empty}>No purchase orders yet. Add one with “New”.</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/purchase-orders/${item.id}`)}
            >
              <Text style={styles.poNo}>{item.poNumber}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.clientCompany?.name ?? '—'} → {item.factoryCompany?.name ?? '—'}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {item.product?.styleNumber ?? '—'}
                {item.totalQuantity != null
                  ? `  ·  ${item.totalQuantity.toLocaleString('en-US')} pcs`
                  : ''}
              </Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.panel,
    gap: 4,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  newLink: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  subtitle: { color: palette.sub, fontSize: 13 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  forbiddenTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  forbiddenBody: { color: palette.sub, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  notice: {
    margin: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  noticeText: { color: palette.danger, fontSize: 13, flexShrink: 1 },
  retry: { color: palette.accent, fontSize: 13, fontWeight: '600' },
  list: { padding: 16 },
  listEmpty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  separator: { height: 8 },
  empty: { color: palette.faint, fontSize: 14, textAlign: 'center' },
  row: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 4,
  },
  poNo: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  rowSub: { color: palette.sub, fontSize: 13 },
  rowMeta: { color: palette.faint, fontSize: 12 },
});
