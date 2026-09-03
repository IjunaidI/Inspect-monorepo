/**
 * Reports list (INS-086 Phase 4) — port of the web console's `/reports`
 * behaviour contract. Role floor QA_MANAGER (the API is the authority; this
 * screen gates client-side too so an inspector never sees a list the API
 * would refuse).
 *
 * Deliberately better than the web screen it ports, per the contract's gap
 * list: the web page swallows EVERY failure — network, 401, 403, even the
 * Platform-Admin no-org 403 — into "No reports yet" via `.catch(() => [])`.
 * Here error, session-expiry, forbidden and true-empty are four different
 * states. The desktop's 7-column grid becomes a card per report, and the
 * full-page GET search form becomes a debounced controlled input.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { reportNumber, roleAtLeast } from '@inspect/domain';
import type { ReportListItemDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { client, loadIdentity, signOut } from '@/lib/session';

type Load =
  | { kind: 'rows'; rows: ReportListItemDto[] }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

/** Pure fetch — no component state captured, so effects may call it freely. */
async function fetchReports(q: string): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  const params = new URLSearchParams({ take: '50' });
  if (q) params.set('q', q);
  try {
    return {
      kind: 'rows',
      rows: await client.get<ReportListItemDto[]>(`/reports?${params.toString()}`),
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

export default function Reports() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ReportListItemDto[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const firstLoad = useRef(true);

  const apply = useCallback(
    async (result: Load) => {
      if (result.kind === 'unauthorized') {
        // Session expired beyond refresh — back to login, cleanly.
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

  // One effect owns both the initial load (immediate) and search (debounced
  // 300ms). A cancelled flag drops stale responses so a slow query can never
  // overwrite a newer one.
  useEffect(() => {
    let cancelled = false;
    const delay = firstLoad.current ? 0 : 300;
    firstLoad.current = false;
    const t = setTimeout(() => {
      fetchReports(q).then((r) => {
        if (!cancelled) apply(r);
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    apply(await fetchReports(q));
    setRefreshing(false);
  }, [q, apply]);

  if (forbidden) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.forbiddenTitle}>QA Manager access required</Text>
          <Text style={styles.forbiddenBody}>
            Signed reports are visible to QA Managers and above. Ask an Org Owner if you need
            access.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <BackButton fallbackHref="/dashboard" />
        <Text style={styles.title}>Reports</Text>
        {rows !== null ? (
          <Text style={styles.subtitle}>
            {rows.length} signed report{rows.length === 1 ? '' : 's'}
            {q ? ` matching “${q}”` : ''}
          </Text>
        ) : null}
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search PO or client…"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
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
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={palette.accent}
            />
          }
          contentContainerStyle={rows?.length ? styles.list : styles.listEmpty}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            error ? null : (
              <Text style={styles.empty}>
                {q
                  ? `No reports match “${q}”.`
                  : 'No reports yet — approve an inspection and generate its report.'}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/inspections/${item.inspectionId}/report`)}
            >
              <View style={styles.rowTop}>
                <Text style={styles.reportNo}>{reportNumber(item.id)}</Text>
                <Text style={styles.rowDate}>
                  {item.generatedAt ? new Date(item.generatedAt).toISOString().slice(0, 10) : '—'}
                </Text>
              </View>
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.clientCompany?.name ?? '—'}
                {item.inspection?.purchaseOrder?.poNumber
                  ? `  ·  ${item.inspection.purchaseOrder.poNumber}`
                  : ''}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {item.inspection?.product?.styleNumber ?? '—'}
                {item.pdfStorageKey ? '  ·  PDF available' : ''}
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
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  subtitle: { color: palette.sub, fontSize: 13 },
  search: {
    marginTop: 8,
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
  retry: { color: palette.accent, fontSize: 13, fontWeight: '600' },
  list: { padding: 16 },
  listEmpty: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  separator: { height: 8 },
  empty: {
    color: palette.faint,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  row: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reportNo: { color: palette.accent, fontSize: 16, fontWeight: '700' },
  rowDate: { color: palette.faint, fontSize: 12 },
  rowSub: { color: palette.sub, fontSize: 14 },
  rowMeta: { color: palette.faint, fontSize: 12 },
});
