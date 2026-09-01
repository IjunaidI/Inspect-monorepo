/**
 * Products list (INS-086 Phase 4) — port of the web `/products` list. Role
 * floor QA_MANAGER. The web list sends no query params at all despite the API
 * supporting q/includeArchived/take/skip; this screen uses them (debounced
 * server search, archived views, load-more) rather than inventing client-side
 * filtering. The web's demo-data fallback is not ported — failure states are
 * honest (error+retry, 401→login, 403→forbidden card, true empty).
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { ProductDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { client, loadIdentity, signOut } from '@/lib/session';

const PAGE_SIZE = 50;
type ViewFilter = 'active' | 'all' | 'archived';

type Page =
  | { kind: 'rows'; rows: ProductDto[] }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

/** Pure fetch — no component state captured, so effects may call it freely. */
async function fetchProducts(q: string, view: ViewFilter, skip: number): Promise<Page> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  const params = new URLSearchParams({ take: String(PAGE_SIZE) });
  if (skip > 0) params.set('skip', String(skip));
  if (q) params.set('q', q);
  if (view !== 'active') params.set('includeArchived', '1');
  try {
    return { kind: 'rows', rows: await client.get<ProductDto[]>(`/products?${params.toString()}`) };
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

function Chip(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[styles.filterChip, props.active && styles.filterChipActive]}
    >
      <Text style={[styles.filterChipLabel, props.active && styles.filterChipLabelActive]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export default function Products() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [view, setView] = useState<ViewFilter>('active');
  const [rows, setRows] = useState<ProductDto[] | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const firstLoad = useRef(true);

  const apply = useCallback(
    async (result: Page, mode: 'replace' | 'append') => {
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
        setRows((prev) => (mode === 'append' ? [...(prev ?? []), ...result.rows] : result.rows));
        setHasNext(result.rows.length === PAGE_SIZE);
        setError(null);
      } else {
        setError(result.message);
      }
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    const delay = firstLoad.current ? 0 : 300;
    firstLoad.current = false;
    const t = setTimeout(() => {
      fetchProducts(q, view, 0).then((r) => {
        if (!cancelled) apply(r, 'replace');
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, view, apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await apply(await fetchProducts(q, view, 0), 'replace');
    setRefreshing(false);
  }, [q, view, apply]);

  async function loadMore() {
    if (loadingMore || !rows) return;
    setLoadingMore(true);
    await apply(await fetchProducts(q, view, rows.length), 'append');
    setLoadingMore(false);
  }

  if (forbidden) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.forbiddenTitle}>QA Manager access required</Text>
          <Text style={styles.forbiddenBody}>
            Products are visible to QA Managers and above.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const visible = view === 'archived' ? (rows ?? []).filter((p) => p.archivedAt) : (rows ?? []);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Products</Text>
          <Pressable onPress={() => router.push('/products/new')} hitSlop={8}>
            <Text style={styles.newLink}>New</Text>
          </Pressable>
        </View>
        {rows !== null ? (
          <Text style={styles.subtitle}>
            {visible.length} product{visible.length === 1 ? '' : 's'}
            {q ? ` matching “${q}”` : ''}
          </Text>
        ) : null}
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search style number…"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        <View style={styles.filterRow}>
          <Chip label="Active" active={view === 'active'} onPress={() => setView('active')} />
          <Chip label="All" active={view === 'all'} onPress={() => setView('all')} />
          <Chip label="Archived" active={view === 'archived'} onPress={() => setView('archived')} />
        </View>
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
          data={visible}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent} />
          }
          contentContainerStyle={visible.length ? styles.list : styles.listEmpty}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            error ? null : (
              <Text style={styles.empty}>
                {q ? `No products match “${q}”.` : 'No products yet. Add one with “New”.'}
              </Text>
            )
          }
          ListFooterComponent={
            hasNext && visible.length ? (
              <Pressable style={styles.loadMore} onPress={loadMore} disabled={loadingMore}>
                <Text style={styles.loadMoreLabel}>{loadingMore ? 'Loading…' : 'Load more'}</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, item.archivedAt ? styles.rowArchived : null]}
              onPress={() => router.push(`/products/${item.id}`)}
            >
              <Text style={styles.styleNo}>{item.styleNumber}</Text>
              {item.description ? (
                <Text style={styles.rowSub} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
              <Text style={styles.rowMeta} numberOfLines={1}>
                {item._count
                  ? `${item._count.purchaseOrders ?? 0} POs · ${item._count.inspections ?? 0} inspections`
                  : '—'}
                {item.archivedAt ? '  ·  Archived' : ''}
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
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
  filterRow: { flexDirection: 'row', gap: 6 },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: palette.bg,
  },
  filterChipActive: { backgroundColor: palette.accentSoft, borderColor: palette.accent },
  filterChipLabel: { color: palette.sub, fontSize: 12.5, fontWeight: '600' },
  filterChipLabelActive: { color: palette.accent },
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
  rowArchived: { opacity: 0.6 },
  styleNo: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  rowSub: { color: palette.sub, fontSize: 13, lineHeight: 18 },
  rowMeta: { color: palette.faint, fontSize: 12 },
  loadMore: { alignItems: 'center', paddingVertical: 14 },
  loadMoreLabel: { color: palette.accent, fontSize: 14, fontWeight: '600' },
});
