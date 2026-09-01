/**
 * Company directory (INS-086 Phase 4) — the directory half of the web
 * `/dashboard` (there is no web /companies list route; on the phone it is its
 * own screen, as the ledger anticipated). Role floor QA_MANAGER.
 *
 * INS-055: ONE directory. Trade role (client vs factory) lives on the
 * PurchaseOrder/Inspection edge, never on the row, so there are no
 * Buyers/Suppliers tabs — the filter is `kind` (ownership: internal vs
 * third-party). Counts are the API's flattened `_count` across both role
 * edges; the client never sums the two sides itself.
 *
 * Deliberate deviations from the web directory, recorded in the ledger:
 * - ONE search behaviour: a debounced server-side `q` (the web stacks a
 *   client-side current-page filter on live typing plus a server search on
 *   Enter — two behaviours on one input).
 * - Fallback avatar colour keys on a hash of the company id (shared
 *   `hashIndex`), so it cannot change between pages — the web bug this
 *   session fixed at the same time.
 * - Read-only v1: create/edit/archive stay on the web until
 *   `/companies/[id]` ports; rows are not yet tappable.
 * - Pagination is a "Load more" append (same 50-row pages, same full-page
 *   heuristic for "there may be more").
 */
import { ApiError } from '@inspect/api-client';
import { brandFallbacks, palette } from '@inspect/design-tokens';
import { hashIndex, initialsFrom, roleAtLeast } from '@inspect/domain';
import type { CompanyDto, CompanyKind } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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

type KindFilter = 'all' | CompanyKind;
type ViewFilter = 'active' | 'all' | 'archived';

type Page =
  | { kind: 'rows'; rows: CompanyDto[] }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

/** Pure fetch — no component state captured, so effects may call it freely. */
async function fetchCompanies(
  q: string,
  kindF: KindFilter,
  view: ViewFilter,
  skip: number,
): Promise<Page> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  const params = new URLSearchParams({ take: String(PAGE_SIZE) });
  if (skip > 0) params.set('skip', String(skip));
  if (q) params.set('q', q);
  if (kindF !== 'all') params.set('kind', kindF);
  // The API has no "archived only" param — `includeArchived` widens the fetch
  // and the archived-only view narrows it client-side, exactly like the web.
  if (view !== 'active') params.set('includeArchived', '1');
  try {
    return { kind: 'rows', rows: await client.get<CompanyDto[]>(`/companies?${params.toString()}`) };
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

export default function Companies() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [kindF, setKindF] = useState<KindFilter>('all');
  const [view, setView] = useState<ViewFilter>('active');
  const [rows, setRows] = useState<CompanyDto[] | null>(null);
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

  // One effect owns the initial load (immediate) and every filter/search
  // change (debounced 300ms); stale responses are dropped via `cancelled`.
  useEffect(() => {
    let cancelled = false;
    const delay = firstLoad.current ? 0 : 300;
    firstLoad.current = false;
    const t = setTimeout(() => {
      fetchCompanies(q, kindF, view, 0).then((r) => {
        if (!cancelled) apply(r, 'replace');
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, kindF, view, apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await apply(await fetchCompanies(q, kindF, view, 0), 'replace');
    setRefreshing(false);
  }, [q, kindF, view, apply]);

  async function loadMore() {
    if (loadingMore || !rows) return;
    setLoadingMore(true);
    await apply(await fetchCompanies(q, kindF, view, rows.length), 'append');
    setLoadingMore(false);
  }

  if (forbidden) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.forbiddenTitle}>QA Manager access required</Text>
          <Text style={styles.forbiddenBody}>
            The company directory is visible to QA Managers and above.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const visible = view === 'archived' ? (rows ?? []).filter((c) => c.archivedAt) : (rows ?? []);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Companies</Text>
        {rows !== null ? (
          <Text style={styles.subtitle}>
            {visible.length} compan{visible.length === 1 ? 'y' : 'ies'}
            {q ? ` matching “${q}”` : ''}
          </Text>
        ) : null}
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search name or address…"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        <View style={styles.filterRow}>
          <Chip label="All kinds" active={kindF === 'all'} onPress={() => setKindF('all')} />
          <Chip
            label="Third-party"
            active={kindF === 'THIRD_PARTY'}
            onPress={() => setKindF('THIRD_PARTY')}
          />
          <Chip label="Internal" active={kindF === 'INTERNAL'} onPress={() => setKindF('INTERNAL')} />
        </View>
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
                {q ? `No companies match “${q}”.` : 'No companies in this workspace yet.'}
              </Text>
            )
          }
          ListFooterComponent={
            hasNext && visible.length ? (
              <Pressable style={styles.loadMore} onPress={loadMore} disabled={loadingMore}>
                <Text style={styles.loadMoreLabel}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => {
            const color =
              item.primaryColor || brandFallbacks[hashIndex(item.id, brandFallbacks.length)];
            return (
              <View style={[styles.row, item.archivedAt ? styles.rowArchived : null]}>
                {/* INS-072: render logoViewUrl only — logoUrl is a raw object key. */}
                {item.logoViewUrl ? (
                  <Image source={{ uri: item.logoViewUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: color }]}>
                    <Text style={styles.avatarInitials}>{initialsFrom(item.name)}</Text>
                  </View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.rowTop}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <View style={styles.kindBadge}>
                      <Text style={styles.kindBadgeLabel}>
                        {item.kind === 'INTERNAL' ? 'Internal' : 'Third-party'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {item.address ?? '—'}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {item._count
                      ? `${item._count.purchaseOrders ?? 0} POs · ${item._count.inspections ?? 0} inspections · ${item._count.reports ?? 0} reports`
                      : '—'}
                    {item.archivedAt ? '  ·  Archived' : ''}
                  </Text>
                </View>
              </View>
            );
          }}
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
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  rowArchived: { opacity: 0.6 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.lineSoft,
  },
  avatarInitials: { color: palette.panel, fontSize: 14, fontWeight: '700' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: palette.ink, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  kindBadge: {
    borderRadius: 999,
    backgroundColor: palette.lineSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  kindBadgeLabel: { color: palette.sub, fontSize: 10.5, fontWeight: '600' },
  rowSub: { color: palette.sub, fontSize: 13 },
  rowMeta: { color: palette.faint, fontSize: 12 },
  loadMore: { alignItems: 'center', paddingVertical: 14 },
  loadMoreLabel: { color: palette.accent, fontSize: 14, fontWeight: '600' },
});
