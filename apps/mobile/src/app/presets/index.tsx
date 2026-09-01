/**
 * Loop presets list (INS-086 Phase 4) — port of the web `/presets`. Role
 * floor QA_MANAGER. INS-081 vocabulary: a preset IS one loop of ordered
 * single-image items — the card counts loop ITEMS, never "loops".
 *
 * Deviations from the web list, recorded: archive lives on the DETAIL
 * screen behind a native confirm (the web's row-menu archive with alert()
 * errors is not ported); Duplicate arrives with the builder port; search is
 * the same client-side filter over the fully-loaded list.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { LoopPresetDto } from '@inspect/shared-types';
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
  TextInput,
  View,
} from 'react-native';

import { client, loadIdentity, signOut } from '@/lib/session';

type Load =
  | { kind: 'rows'; rows: LoopPresetDto[] }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

/** Pure fetch — no component state captured, so effects may call it freely. */
async function fetchPresets(): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    return { kind: 'rows', rows: await client.get<LoopPresetDto[]>('/loop-presets') };
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

export default function Presets() {
  const router = useRouter();
  const [rows, setRows] = useState<LoopPresetDto[] | null>(null);
  const [q, setQ] = useState('');
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
    fetchPresets().then(apply);
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await apply(await fetchPresets());
    setRefreshing(false);
  }, [apply]);

  if (forbidden) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.forbiddenTitle}>QA Manager access required</Text>
          <Text style={styles.forbiddenBody}>
            Loop presets are visible to QA Managers and above.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const term = q.trim().toLowerCase();
  const visible = term
    ? (rows ?? []).filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          (p.description ?? '').toLowerCase().includes(term),
      )
    : (rows ?? []);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Loop presets</Text>
          <Pressable onPress={() => router.push('/presets/new')} hitSlop={8}>
            <Text style={styles.newLink}>New</Text>
          </Pressable>
        </View>
        {rows !== null ? (
          <Text style={styles.subtitle}>
            {visible.length} preset{visible.length === 1 ? '' : 's'}
            {term ? ` matching “${q.trim()}”` : ''}
          </Text>
        ) : null}
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search presets…"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
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
                {term
                  ? `No presets match “${q.trim()}”.`
                  : 'No presets yet. Add one with “New”.'}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/presets/${item.id}`)}>
              <View style={styles.rowTop}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.version}>v{item.version}</Text>
              </View>
              {item.description ? (
                <Text style={styles.rowSub} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
              <Text style={styles.rowMeta} numberOfLines={1}>
                {/* INS-081: loop ITEMS, one image each — never "loops". */}
                {item._count
                  ? `${item._count.items} loop item${item._count.items === 1 ? '' : 's'} · one image each · ${item._count.inspections} inspection${item._count.inspections === 1 ? '' : 's'}`
                  : '—'}
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
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { color: palette.ink, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  version: { color: palette.faint, fontSize: 12, fontWeight: '600' },
  rowSub: { color: palette.sub, fontSize: 13, lineHeight: 18 },
  rowMeta: { color: palette.faint, fontSize: 12 },
});
