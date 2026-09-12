/**
 * Purchase orders list (INS-086 Phase 4) — port of the web `/purchase-orders`
 * list. Role floor QA_MANAGER. The API's list takes no query params, so
 * search and paging are CLIENT-SIDE over the fully-loaded list (INS-092):
 * the shared `filterOptions` (same tokenised match the pickers use) over
 * PO number, both parties and the style number, and a "Show more" window
 * so a long list does not render every row at once. The demo-data fallback
 * is not ported.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { filterOptions, roleAtLeast } from '@inspect/domain';
import type { PurchaseOrderDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { TextButton } from '@/components/ui';
import { client, loadIdentity, signOut } from '@/lib/session';

/** Rows shown before the first "Show more". */
const PAGE_SIZE = 30;

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
    return {
      kind: 'rows',
      rows: await client.get<PurchaseOrderDto[]>('/purchase-orders'),
    };
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

/** Everything a person might type to find a PO. */
const searchLabel = (po: PurchaseOrderDto) =>
  [
    po.poNumber,
    po.clientCompany?.name ?? '',
    po.factoryCompany?.name ?? '',
    po.product?.styleNumber ?? '',
  ].join(' ');

export default function PurchaseOrders() {
  const router = useRouter();
  const [rows, setRows] = useState<PurchaseOrderDto[] | null>(null);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
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

  const filtered = useMemo(() => filterOptions(q, rows ?? [], searchLabel), [q, rows]);
  const visible = filtered.slice(0, shown);
  const hasMore = filtered.length > shown;

  function search(next: string) {
    setQ(next);
    setShown(PAGE_SIZE);
  }

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
        <BackButton fallbackHref="/library" />
        <View style={styles.headerRow}>
          <Text style={styles.title}>Purchase orders</Text>
          <Pressable
            onPress={() => router.push('/purchase-orders/new')}
            hitSlop={8}
            style={styles.newButton}
            accessibilityRole="button"
          >
            <Text style={styles.newLink}>New</Text>
          </Pressable>
        </View>
        {rows !== null ? (
          <Text style={styles.subtitle}>
            {filtered.length} purchase order{filtered.length === 1 ? '' : 's'}
            {q.trim() ? ` matching “${q.trim()}”` : ''}
          </Text>
        ) : null}
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={search}
          placeholder="Search PO number, client, factory or style…"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {error ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{error}</Text>
          <TextButton label="Retry" onPress={refresh} labelStyle={styles.retry} />
        </View>
      ) : null}

      {rows === null && !error ? (
        <View style={styles.centered}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={palette.accent}
            />
          }
          contentContainerStyle={visible.length ? styles.list : styles.listEmpty}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            error ? null : (
              <Text style={styles.empty}>
                {q.trim()
                  ? `No purchase orders match “${q.trim()}”.`
                  : 'No purchase orders yet. Add one with “New”.'}
              </Text>
            )
          }
          ListFooterComponent={
            hasMore ? (
              <Pressable
                style={styles.loadMore}
                onPress={() => setShown((n) => n + PAGE_SIZE)}
                accessibilityRole="button"
              >
                <Text style={styles.loadMoreLabel}>
                  Show more · {filtered.length - shown} remaining
                </Text>
              </Pressable>
            ) : null
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
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  newButton: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  newLink: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  subtitle: { color: palette.sub, fontSize: 13 },
  search: {
    height: 40,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: palette.ink,
    backgroundColor: palette.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  forbiddenTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  forbiddenBody: {
    color: palette.sub,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
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
  retry: { fontSize: 13 },
  list: { padding: 16 },
  listEmpty: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
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
  loadMore: { alignItems: 'center', paddingVertical: 14, minHeight: 44 },
  loadMoreLabel: { color: palette.accent, fontSize: 14, fontWeight: '600' },
});
