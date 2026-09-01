/**
 * Loop preset detail (INS-086 Phase 4) — port of the web `/presets/[id]`.
 * Role floor QA_MANAGER. INS-081: defect tags and the measurement sheet are
 * LOOP-GLOBAL and render once, above the ordered single-image items.
 *
 * Differences from the web page, each deliberate: 403/404/network are three
 * states (the web collapses all failures into notFound()); items are
 * explicitly sorted by `position` (the web trusts API order); archive lives
 * here behind a native confirm (the web archives from a row menu with
 * alert() errors); "unavailable" reference images stay distinct from "none".
 * There is no restore endpoint — archiving is the terminal list-removal,
 * safe because inspections freeze their own loopPresetSnapshot.
 */
import { ApiError } from '@inspect/api-client';
import { palette, severity as severityTint, type SeverityKey } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { LoopPresetDetailDto } from '@inspect/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { client, loadIdentity } from '@/lib/session';

const SEV_KEY: Record<string, SeverityKey> = {
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
};

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preset: LoopPresetDetailDto };

/** Pure fetch — setState only ever happens in .then. */
async function fetchPreset(id: string): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    return {
      kind: 'ready',
      preset: await client.get<LoopPresetDetailDto>(`/loop-presets/${id}`),
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return { kind: 'error', message: e instanceof Error ? e.message : 'Load failed' };
  }
}

export default function PresetDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const presetId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchPreset(presetId).then(setLoad);
  }, [presetId]);
  useEffect(reload, [reload]);

  function confirmArchive(preset: LoopPresetDetailDto) {
    Alert.alert(
      'Archive preset?',
      `“${preset.name}” v${preset.version} will disappear from the presets list. Existing inspections keep their frozen snapshot of it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setPending(true);
              setActionError(null);
              try {
                await client.del(`/loop-presets/${preset.id}`);
                router.back();
              } catch (e) {
                setActionError(e instanceof Error ? e.message : 'Archive failed');
              } finally {
                setPending(false);
              }
            })();
          },
        },
      ],
    );
  }

  if (load.kind === 'loading') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (load.kind !== 'ready') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>
            {load.kind === 'missing'
              ? 'Preset not found'
              : load.kind === 'forbidden'
                ? 'QA Manager access required'
                : 'Could not load the preset'}
          </Text>
          {load.kind === 'error' ? <Text style={styles.mutedText}>{load.message}</Text> : null}
          <View style={styles.centerActions}>
            {load.kind === 'error' ? (
              <Pressable onPress={reload} hitSlop={8}>
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

  const { preset } = load;
  // INS-081 ordering is `position`; sort explicitly rather than trusting the
  // wire order the way the web page does.
  const items = [...preset.items].sort((a, b) => a.position - b.position);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.headRow}>
          <Text style={styles.title} numberOfLines={2}>
            {preset.name}
          </Text>
          <Text style={styles.version}>v{preset.version}</Text>
        </View>
        {preset.description ? <Text style={styles.description}>{preset.description}</Text> : null}
        {preset.aqlLevel ? <Text style={styles.hint}>AQL level {preset.aqlLevel}</Text> : null}
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

        {/* Loop-global defect tags (INS-081 — never per item). */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Defect tags (loop-global)</Text>
          {preset.allowedDefects.length === 0 ? (
            <Text style={styles.hint}>No defect tags configured.</Text>
          ) : (
            <View style={styles.chipWrap}>
              {preset.allowedDefects.map((ad) => {
                const sev = severityTint[SEV_KEY[ad.defectCatalog.defaultSeverity] ?? 'minor'];
                return (
                  <View
                    key={`${ad.loopPresetId}-${ad.defectCatalogId}`}
                    style={[styles.chip, { backgroundColor: sev.bg }]}
                  >
                    <Text style={[styles.chipLabel, { color: sev.fg }]}>
                      {ad.defectCatalog.name}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Loop-global measurement sheet. */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Measurement sheet (per unit)</Text>
          {preset.measurementFields.length === 0 ? (
            <Text style={styles.hint}>No measurement fields configured.</Text>
          ) : (
            preset.measurementFields.map((f) => (
              <View key={f.id} style={styles.measureRow}>
                <Text style={styles.measureLabel}>{f.label}</Text>
                <Text style={styles.measureUnit}>{f.unit ?? '—'}</Text>
              </View>
            ))
          )}
        </View>

        {/* The loop: ordered single-image items. */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            {items.length} loop item{items.length === 1 ? '' : 's'} · one image each
          </Text>
          {items.map((item, i) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemIndex}>
                <Text style={styles.itemIndexLabel}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.itemName}>{item.itemName}</Text>
                {item.description ? (
                  <Text style={styles.itemDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              {item.referenceImage ? (
                item.referenceImage.viewUrl ? (
                  <Image source={{ uri: item.referenceImage.viewUrl }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbFallback]}>
                    <Text style={styles.thumbFallbackText}>unavailable</Text>
                  </View>
                )
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Archive preset</Text>
          <Text style={styles.hint}>
            Removes it from the presets list. Inspections keep their frozen snapshot; there is no
            restore.
          </Text>
          <Pressable
            onPress={() => confirmArchive(preset)}
            disabled={pending}
            hitSlop={8}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonLabel}>{pending ? 'Archiving…' : 'Archive'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  centerActions: { flexDirection: 'row', gap: 24, marginTop: 8 },
  errorTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center' },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  headRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700', flexShrink: 1 },
  version: { color: palette.faint, fontSize: 13, fontWeight: '600' },
  description: { color: palette.sub, fontSize: 14, lineHeight: 20 },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  errorText: { color: palette.danger, fontSize: 13 },
  card: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  sectionLabel: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipLabel: { fontSize: 12, fontWeight: '600' },
  measureRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  measureLabel: { color: palette.ink, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  measureUnit: { color: palette.faint, fontSize: 13 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: palette.lineSoft,
    paddingTop: 8,
  },
  itemIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIndexLabel: { color: palette.accent, fontSize: 12.5, fontWeight: '700' },
  itemName: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  itemDesc: { color: palette.sub, fontSize: 12.5, lineHeight: 17 },
  thumb: { width: 52, height: 52, borderRadius: 8, backgroundColor: palette.lineSoft },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbFallbackText: { color: palette.faint, fontSize: 9 },
  dangerCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: severityTint.critical.bg,
    backgroundColor: palette.panel,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  dangerTitle: { color: palette.danger, fontSize: 14, fontWeight: '700' },
  dangerButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: severityTint.critical.bg,
    backgroundColor: severityTint.critical.bg,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dangerButtonLabel: { color: palette.danger, fontSize: 13, fontWeight: '700' },
});
