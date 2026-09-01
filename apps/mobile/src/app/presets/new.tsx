/**
 * Preset builder (INS-086 Phase 4 — the last ledger row). Port of the web
 * `/presets/new` behaviour contract. Role floor QA_MANAGER.
 *
 * INS-081 shape enforced by the data model itself: ONE loop of ordered
 * single-image items; defect tags and the measurement sheet are loop-global.
 * Versioning (INS-076): presets are immutable — reusing a name adds the next
 * version server-side; a new name starts at v1. Only AQL General Level II
 * exists in the MVP engine (INS-052), so the level is displayed, not chosen.
 *
 * Deliberate differences from the web builder, from the contract's gap list:
 * - A failed `?from=` duplicate seed shows a notice and starts blank (the
 *   web silently discards the failure — a broken duplicate link looks like
 *   nothing happened).
 * - Defect chips are real Pressables (the web console's chips are plain
 *   text nodes — the a11y gap recorded in the 2026-08-31 click-through).
 * - Custom-defect errors have their own slot (the web reuses the preset
 *   save-error slot).
 * - Reference-image UPLOAD is deferred (needs expo-image-picker, same as
 *   the company logo); duplicate-seeded items keep their existing keys, so
 *   duplicating preserves images. Recorded in the ledger.
 */
import { ApiError } from '@inspect/api-client';
import { palette, severity as severityTint, type SeverityKey } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type {
  CreateDefectInput,
  CreateLoopPresetInput,
  DefectCatalogDto,
  DefectSeverity,
  LoopPresetDetailDto,
  LoopPresetDto,
} from '@inspect/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { client, loadIdentity } from '@/lib/session';

const SEVERITIES: DefectSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR'];
const SEV_KEY: Record<string, SeverityKey> = {
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
};

type DraftItem = {
  /** Stable local key — survives reorder, never sent to the API. */
  key: string;
  itemName: string;
  description: string;
  /** Storage key under orgs/<orgId>/presets/ (from a duplicate seed). */
  referenceImageUrl?: string;
};
type DraftField = { key: string; label: string; unit: string };

const newKey = () => Math.random().toString(36).slice(2, 10);
const blankItem = (): DraftItem => ({ key: newKey(), itemName: '', description: '' });

type Load =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      catalog: DefectCatalogDto[];
      seed: LoopPresetDetailDto | null;
      /** Set when ?from= was requested but could not be loaded. */
      seedFailed: boolean;
    };

/** Pure fetch — setState only ever happens in .then. */
async function fetchBuilderData(fromId: string | null): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  let catalog: DefectCatalogDto[];
  try {
    catalog = await client.get<DefectCatalogDto[]>('/defect-catalog');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return { kind: 'error', message: e instanceof Error ? e.message : 'Load failed' };
  }
  if (!fromId) return { kind: 'ready', catalog, seed: null, seedFailed: false };
  try {
    const seed = await client.get<LoopPresetDetailDto>(`/loop-presets/${fromId}`);
    return { kind: 'ready', catalog, seed, seedFailed: false };
  } catch {
    // Unlike the web, say so — a broken duplicate link must not look like
    // a deliberate blank builder.
    return { kind: 'ready', catalog, seed: null, seedFailed: true };
  }
}

export default function PresetBuilder() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromId = from ? String(from) : null;

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraDefects, setExtraDefects] = useState<DefectCatalogDto[]>([]);
  // Custom defect form
  const [customName, setCustomName] = useState('');
  const [customSeverity, setCustomSeverity] = useState<DefectSeverity>('MINOR');
  const [customPending, setCustomPending] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  // Save
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const apply = useCallback((result: Load) => {
    setLoad(result);
    if (result.kind === 'ready' && result.seed) {
      const s = result.seed;
      setName(s.name);
      setDescription(s.description ?? '');
      setItems(
        [...s.items]
          .sort((a, b) => a.position - b.position)
          .map((it) => ({
            key: newKey(),
            itemName: it.itemName,
            description: it.description ?? '',
            ...(it.referenceImageUrl ? { referenceImageUrl: it.referenceImageUrl } : {}),
          })),
      );
      setFields(
        s.measurementFields.map((f) => ({ key: newKey(), label: f.label, unit: f.unit ?? '' })),
      );
      setSelected(new Set(s.allowedDefects.map((ad) => ad.defectCatalogId)));
    }
  }, []);

  useEffect(() => {
    fetchBuilderData(fromId).then(apply);
  }, [fromId, apply]);
  const reload = useCallback(() => {
    setLoad({ kind: 'loading' });
    fetchBuilderData(fromId).then(apply);
  }, [fromId, apply]);

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function moveItem(key: string, dir: -1 | 1) {
    setItems((prev) => {
      const i = prev.findIndex((it) => it.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev));
  }
  function toggleDefect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addCustomDefect() {
    const trimmed = customName.trim();
    if (!trimmed) {
      setCustomError('Defect name is required.');
      return;
    }
    setCustomPending(true);
    setCustomError(null);
    try {
      const body: CreateDefectInput = { name: trimmed, defaultSeverity: customSeverity };
      const created = await client.post<DefectCatalogDto>('/defect-catalog', body);
      setExtraDefects((prev) => [...prev, created]);
      setSelected((prev) => new Set(prev).add(created.id));
      setCustomName('');
    } catch (e) {
      setCustomError(e instanceof Error ? e.message : 'Could not add the defect');
    } finally {
      setCustomPending(false);
    }
  }

  async function save(seed: LoopPresetDetailDto | null) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveError('Preset name is required.');
      return;
    }
    if (items.some((it) => !it.itemName.trim())) {
      setSaveError('Every loop item needs a name.');
      return;
    }
    setPending(true);
    setSaveError(null);
    try {
      const body: CreateLoopPresetInput = {
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
        aqlLevel: 'II',
        // Position is array order — the API derives position: i+1.
        items: items.map((it) => ({
          itemName: it.itemName.trim(),
          ...(it.description.trim() ? { description: it.description.trim() } : {}),
          ...(it.referenceImageUrl ? { referenceImageUrl: it.referenceImageUrl } : {}),
        })),
        ...(fields.some((f) => f.label.trim())
          ? {
              measurementFields: fields
                .filter((f) => f.label.trim())
                .map((f) => ({
                  label: f.label.trim(),
                  ...(f.unit.trim() ? { unit: f.unit.trim() } : {}),
                })),
            }
          : {}),
        ...(selected.size ? { allowedDefectCatalogIds: [...selected] } : {}),
      };
      const created = await client.post<LoopPresetDto>('/loop-presets', body);
      router.replace(`/presets/${created.id}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      setPending(false);
    }
    void seed;
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
            {load.kind === 'forbidden'
              ? 'QA Manager access required'
              : 'Could not load the defect catalog'}
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

  const { catalog, seed, seedFailed } = load;
  const allDefects = [...catalog, ...extraDefects];
  // INS-076 guidance only — the version number is decided server-side.
  const versionHint =
    seed && name.trim() === seed.name
      ? `Will save as “${seed.name}” v${seed.version + 1}.`
      : 'Reusing an existing preset name adds its next version; a new name starts at v1.';

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{seed ? `Duplicate “${seed.name}”` : 'New preset'}</Text>
        <Text style={styles.hint}>{versionHint} AQL General Level II (the MVP engine).</Text>
        {seedFailed ? (
          <View style={styles.warnBanner}>
            <Text style={styles.warnText}>
              The preset to duplicate could not be loaded — starting from a blank builder.
            </Text>
          </View>
        ) : null}
        {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Preset name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Knitwear pre-shipment"
            placeholderTextColor={palette.faint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="What this loop covers…"
            placeholderTextColor={palette.faint}
            multiline
          />
        </View>

        {/* The loop: ordered single-image items (INS-081). */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>
            Loop items · one image each · {items.length}
          </Text>
          {items.map((it, i) => (
            <View key={it.key} style={styles.itemBlock}>
              <View style={styles.itemHead}>
                <View style={styles.itemIndex}>
                  <Text style={styles.itemIndexLabel}>{i + 1}</Text>
                </View>
                <View style={styles.itemControls}>
                  <Pressable onPress={() => moveItem(it.key, -1)} hitSlop={6} disabled={i === 0}>
                    <Text style={[styles.ctl, i === 0 && styles.ctlDisabled]}>↑</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => moveItem(it.key, 1)}
                    hitSlop={6}
                    disabled={i === items.length - 1}
                  >
                    <Text style={[styles.ctl, i === items.length - 1 && styles.ctlDisabled]}>
                      ↓
                    </Text>
                  </Pressable>
                  {items.length > 1 ? (
                    <Pressable onPress={() => removeItem(it.key)} hitSlop={6}>
                      <Text style={styles.ctlDanger}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              <TextInput
                style={styles.input}
                value={it.itemName}
                onChangeText={(v) => updateItem(it.key, { itemName: v })}
                placeholder="Item name (e.g. Front view) *"
                placeholderTextColor={palette.faint}
              />
              <TextInput
                style={styles.input}
                value={it.description}
                onChangeText={(v) => updateItem(it.key, { description: v })}
                placeholder="Guidance for the inspector (optional)"
                placeholderTextColor={palette.faint}
              />
              {it.referenceImageUrl ? (
                <Text style={styles.hint}>
                  Reference image kept from the duplicated preset.
                </Text>
              ) : (
                <Text style={styles.hint}>Reference-image upload is web-only for now.</Text>
              )}
            </View>
          ))}
          <Pressable onPress={() => setItems((prev) => [...prev, blankItem()])} hitSlop={6}>
            <Text style={styles.addLink}>+ Add loop item</Text>
          </Pressable>
        </View>

        {/* Loop-global defect tags. */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Defect tags (loop-global) · {selected.size} selected</Text>
          {SEVERITIES.map((sev) => {
            const group = allDefects.filter((d) => d.defaultSeverity === sev);
            if (group.length === 0) return null;
            const tint = severityTint[SEV_KEY[sev]];
            return (
              <View key={sev} style={{ gap: 6 }}>
                <Text style={[styles.sevLabel, { color: tint.fg }]}>{tint.label}</Text>
                <View style={styles.chipWrap}>
                  {group.map((d) => {
                    const on = selected.has(d.id);
                    return (
                      <Pressable
                        key={d.id}
                        onPress={() => toggleDefect(d.id)}
                        style={[
                          styles.chip,
                          { backgroundColor: on ? tint.bg : palette.lineSoft },
                          on && { borderColor: tint.fg, borderWidth: 1 },
                        ]}
                      >
                        <Text style={[styles.chipLabel, { color: on ? tint.fg : palette.sub }]}>
                          {d.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
          <View style={styles.customRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={customName}
              onChangeText={setCustomName}
              placeholder="Add a custom defect…"
              placeholderTextColor={palette.faint}
            />
          </View>
          <View style={styles.chipWrap}>
            {SEVERITIES.map((sev) => {
              const tint = severityTint[SEV_KEY[sev]];
              const on = customSeverity === sev;
              return (
                <Pressable
                  key={sev}
                  onPress={() => setCustomSeverity(sev)}
                  style={[styles.chip, { backgroundColor: on ? tint.bg : palette.lineSoft }]}
                >
                  <Text style={[styles.chipLabel, { color: on ? tint.fg : palette.sub }]}>
                    {tint.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable onPress={addCustomDefect} disabled={customPending} hitSlop={6}>
              <Text style={styles.addLink}>{customPending ? 'Adding…' : 'Add'}</Text>
            </Pressable>
          </View>
          {customError ? <Text style={styles.errorText}>{customError}</Text> : null}
        </View>

        {/* Loop-global measurement sheet. */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Measurement sheet (per unit)</Text>
          {fields.map((f) => (
            <View key={f.key} style={styles.fieldRow}>
              <TextInput
                style={[styles.input, { flex: 2 }]}
                value={f.label}
                onChangeText={(v) =>
                  setFields((prev) =>
                    prev.map((x) => (x.key === f.key ? { ...x, label: v } : x)),
                  )
                }
                placeholder="Label (e.g. Chest width)"
                placeholderTextColor={palette.faint}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={f.unit}
                onChangeText={(v) =>
                  setFields((prev) => prev.map((x) => (x.key === f.key ? { ...x, unit: v } : x)))
                }
                placeholder="Unit"
                placeholderTextColor={palette.faint}
              />
              <Pressable
                onPress={() => setFields((prev) => prev.filter((x) => x.key !== f.key))}
                hitSlop={6}
              >
                <Text style={styles.ctlDanger}>✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => setFields((prev) => [...prev, { key: newKey(), label: '', unit: '' }])}
            hitSlop={6}
          >
            <Text style={styles.addLink}>+ Add measurement field</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.button, pending && styles.buttonDisabled]}
          onPress={() => save(seed)}
          disabled={pending}
        >
          <Text style={styles.buttonLabel}>{pending ? 'Saving…' : 'Save preset'}</Text>
        </Pressable>
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
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  warnBanner: {
    borderWidth: 1,
    borderColor: severityTint.major.fg,
    backgroundColor: severityTint.major.bg,
    borderRadius: 8,
    padding: 12,
  },
  warnText: { color: severityTint.major.fg, fontSize: 13, lineHeight: 18 },
  errorText: { color: palette.danger, fontSize: 13 },
  field: { gap: 6 },
  fieldLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    backgroundColor: palette.panel,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.ink,
    fontSize: 14,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  card: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  sectionLabel: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemBlock: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.lineSoft,
    paddingTop: 10,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIndexLabel: { color: palette.accent, fontSize: 12.5, fontWeight: '700' },
  itemControls: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ctl: { color: palette.accent, fontSize: 18, fontWeight: '700' },
  ctlDisabled: { color: palette.faint },
  ctlDanger: { color: palette.danger, fontSize: 13, fontWeight: '600' },
  addLink: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  sevLabel: { fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipLabel: { fontSize: 12.5, fontWeight: '600' },
  customRow: { flexDirection: 'row', gap: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
