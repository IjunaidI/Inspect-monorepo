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
 *
 * INS-092: 44pt reorder/remove controls; pull-to-refresh re-fetches the
 * defect catalog without touching the draft; save confirms with a toast.
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
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { useToast } from '@/components/toast';
import { Button, Field, Input, MIN_TARGET, TextButton, ui } from '@/components/ui';
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
const blankItem = (): DraftItem => ({
  key: newKey(),
  itemName: '',
  description: '',
});

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

const fetchCatalog = () => client.get<DefectCatalogDto[]>('/defect-catalog');

/** Pure fetch — setState only ever happens in .then. */
async function fetchBuilderData(fromId: string | null): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  let catalog: DefectCatalogDto[];
  try {
    catalog = await fetchCatalog();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Load failed',
    };
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

/** A 44pt square control for a one-glyph action (↑ ↓ ✕). */
function Glyph({
  glyph,
  onPress,
  disabled = false,
  danger = false,
  accessibilityLabel,
}: {
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.glyph, pressed && !disabled && styles.glyphPressed]}
    >
      <Text
        style={[styles.glyphText, danger && styles.glyphDanger, disabled && styles.glyphDisabled]}
      >
        {glyph}
      </Text>
    </Pressable>
  );
}

export default function PresetBuilder() {
  const router = useRouter();
  const toast = useToast();
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
        s.measurementFields.map((f) => ({
          key: newKey(),
          label: f.label,
          unit: f.unit ?? '',
        })),
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

  /** Pull-to-refresh: a fresher catalog, the draft untouched. */
  async function refresh() {
    try {
      const catalog = await fetchCatalog();
      setLoad((l) => (l.kind === 'ready' ? { ...l, catalog } : l));
    } catch {
      toast('Could not refresh the defect catalog', { tone: 'danger' });
    }
  }

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
      const body: CreateDefectInput = {
        name: trimmed,
        defaultSeverity: customSeverity,
      };
      const created = await client.post<DefectCatalogDto>('/defect-catalog', body);
      setExtraDefects((prev) => [...prev, created]);
      setSelected((prev) => new Set(prev).add(created.id));
      setCustomName('');
      toast(`Defect “${created.name}” added`);
    } catch (e) {
      setCustomError(e instanceof Error ? e.message : 'Could not add the defect');
    } finally {
      setCustomPending(false);
    }
  }

  async function save() {
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
      toast(`Preset “${created.name}” saved as v${created.version}`);
      router.replace(`/presets/${created.id}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      setPending(false);
    }
  }

  if (load.kind === 'loading') {
    return (
      <SafeAreaView style={ui.screen}>
        <View style={ui.centered}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (load.kind !== 'ready') {
    return (
      <SafeAreaView style={ui.screen}>
        <View style={ui.centered}>
          <Text style={ui.errorTitle}>
            {load.kind === 'forbidden'
              ? 'QA Manager access required'
              : 'Could not load the defect catalog'}
          </Text>
          {load.kind === 'error' ? <Text style={ui.mutedText}>{load.message}</Text> : null}
          <View style={ui.centerActions}>
            {load.kind === 'error' ? <TextButton label="Retry" onPress={reload} /> : null}
            <BackButton label="Go back" />
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
    <FormScreen onRefresh={refresh}>
      <Text style={ui.title}>{seed ? `Duplicate “${seed.name}”` : 'New preset'}</Text>
      <Text style={ui.hint}>{versionHint} AQL General Level II (the MVP engine).</Text>
      {seedFailed ? (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>
            The preset to duplicate could not be loaded — starting from a blank builder.
          </Text>
        </View>
      ) : null}
      {saveError ? <Text style={ui.errorText}>{saveError}</Text> : null}

      <Field label="Preset name *">
        <Input value={name} onChangeText={setName} placeholder="e.g. Knitwear pre-shipment" />
      </Field>
      <Field label="Description">
        <Input
          style={{ minHeight: 70 }}
          value={description}
          onChangeText={setDescription}
          placeholder="What this loop covers…"
          multiline
        />
      </Field>

      {/* The loop: ordered single-image items (INS-081). */}
      <View style={ui.card}>
        <Text style={styles.sectionLabel}>Loop items · one image each · {items.length}</Text>
        {items.map((it, i) => (
          <View key={it.key} style={styles.itemBlock}>
            <View style={styles.itemHead}>
              <View style={styles.itemIndex}>
                <Text style={styles.itemIndexLabel}>{i + 1}</Text>
              </View>
              <View style={styles.itemControls}>
                <Glyph
                  glyph="↑"
                  onPress={() => moveItem(it.key, -1)}
                  disabled={i === 0}
                  accessibilityLabel={`Move item ${i + 1} up`}
                />
                <Glyph
                  glyph="↓"
                  onPress={() => moveItem(it.key, 1)}
                  disabled={i === items.length - 1}
                  accessibilityLabel={`Move item ${i + 1} down`}
                />
                {items.length > 1 ? (
                  <TextButton
                    label="Remove"
                    tone="danger"
                    onPress={() => removeItem(it.key)}
                    labelStyle={styles.ctlDanger}
                  />
                ) : null}
              </View>
            </View>
            <Input
              value={it.itemName}
              onChangeText={(v) => updateItem(it.key, { itemName: v })}
              placeholder="Item name (e.g. Front view) *"
            />
            <Input
              value={it.description}
              onChangeText={(v) => updateItem(it.key, { description: v })}
              placeholder="Guidance for the inspector (optional)"
            />
            {it.referenceImageUrl ? (
              <Text style={ui.hint}>Reference image kept from the duplicated preset.</Text>
            ) : (
              <Text style={ui.hint}>Reference-image upload is web-only for now.</Text>
            )}
          </View>
        ))}
        <TextButton
          label="+ Add loop item"
          onPress={() => setItems((prev) => [...prev, blankItem()])}
        />
      </View>

      {/* Loop-global defect tags. */}
      <View style={ui.card}>
        <Text style={styles.sectionLabel}>
          Defect tags (loop-global) · {selected.size} selected
        </Text>
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
                      hitSlop={{ top: 6, bottom: 6 }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
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
        <Input
          value={customName}
          onChangeText={setCustomName}
          placeholder="Add a custom defect…"
        />
        <View style={styles.chipWrap}>
          {SEVERITIES.map((sev) => {
            const tint = severityTint[SEV_KEY[sev]];
            const on = customSeverity === sev;
            return (
              <Pressable
                key={sev}
                onPress={() => setCustomSeverity(sev)}
                hitSlop={{ top: 6, bottom: 6 }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? tint.bg : palette.lineSoft }]}
              >
                <Text style={[styles.chipLabel, { color: on ? tint.fg : palette.sub }]}>
                  {tint.label}
                </Text>
              </Pressable>
            );
          })}
          <TextButton
            label={customPending ? 'Adding…' : 'Add'}
            onPress={addCustomDefect}
            disabled={customPending}
          />
        </View>
        {customError ? <Text style={ui.errorText}>{customError}</Text> : null}
      </View>

      {/* Loop-global measurement sheet. */}
      <View style={ui.card}>
        <Text style={styles.sectionLabel}>Measurement sheet (per unit)</Text>
        {fields.map((f) => (
          <View key={f.key} style={styles.fieldRow}>
            <Input
              style={{ flex: 2 }}
              value={f.label}
              onChangeText={(v) =>
                setFields((prev) => prev.map((x) => (x.key === f.key ? { ...x, label: v } : x)))
              }
              placeholder="Label (e.g. Chest width)"
            />
            <Input
              style={{ flex: 1 }}
              value={f.unit}
              onChangeText={(v) =>
                setFields((prev) => prev.map((x) => (x.key === f.key ? { ...x, unit: v } : x)))
              }
              placeholder="Unit"
            />
            <Glyph
              glyph="✕"
              danger
              onPress={() => setFields((prev) => prev.filter((x) => x.key !== f.key))}
              accessibilityLabel={`Remove measurement field ${f.label || ''}`.trim()}
            />
          </View>
        ))}
        <TextButton
          label="+ Add measurement field"
          onPress={() => setFields((prev) => [...prev, { key: newKey(), label: '', unit: '' }])}
        />
      </View>

      <Button label="Save preset" loadingLabel="Saving…" loading={pending} onPress={save} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  warnBanner: {
    borderWidth: 1,
    borderColor: severityTint.major.fg,
    backgroundColor: severityTint.major.bg,
    borderRadius: 8,
    padding: 12,
  },
  warnText: { color: severityTint.major.fg, fontSize: 13, lineHeight: 18 },
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
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  itemControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  glyph: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  glyphPressed: { backgroundColor: palette.lineSoft },
  glyphText: { color: palette.accent, fontSize: 18, fontWeight: '700' },
  glyphDisabled: { color: palette.faint },
  glyphDanger: { color: palette.danger, fontSize: 15 },
  ctlDanger: { fontSize: 13 },
  sevLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 32,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 12.5, fontWeight: '600' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
