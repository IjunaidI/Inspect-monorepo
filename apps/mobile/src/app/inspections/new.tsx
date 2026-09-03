/**
 * Create inspection (INS-086 Phase 4) — port of the web console's
 * `/inspections/new` behaviour contract. Role floor QA_MANAGER (the API is the
 * authority; this screen also gates client-side so an inspector never sees a
 * form the API would refuse).
 *
 * Three deliberate improvements over the web screen, from the contract's own
 * gap list: a real initial loading state, a real error + retry (the web
 * swallows failed GETs into fake-empty lists), and pre-submit required-field
 * gating so a tap never silently no-ops.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type {
  AqlPreviewDto,
  InspectionDto,
  LoopPresetDto,
  PurchaseOrderDto,
  UserDto,
} from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OptionPicker } from '@/components/option-picker';
import { BackButton } from '@/components/back-button';
import { client, loadIdentity } from '@/lib/session';

/** Mirrors the API's ALLOWED_AQL_VALUES; 0 = "any defect rejects". */
const AQL_VALUES = [0, 1.0, 1.5, 2.5, 4.0, 6.5];
const DEFAULT_AQL = { critical: 0, major: 2.5, minor: 4.0 };
const AQL_CLASSES = ['critical', 'major', 'minor'] as const;

type Load =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      pos: PurchaseOrderDto[];
      presets: LoopPresetDto[];
      inspectors: UserDto[];
    };

/** Pure fetch — setState only ever happens in .then. */
async function fetchFormData(): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    const [pos, presets, users] = await Promise.all([
      client.get<PurchaseOrderDto[]>('/purchase-orders'),
      client.get<LoopPresetDto[]>('/loop-presets'),
      client.get<UserDto[]>('/users'),
    ]);
    return {
      kind: 'ready',
      pos,
      presets,
      inspectors: users.filter((u) => u.role === 'INSPECTOR' && u.status === 'ACTIVE'),
    };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Load failed',
    };
  }
}

// OptionPicker moved to '@/components/option-picker' when the company edit
// screen needed the same control.

export default function NewInspection() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [po, setPo] = useState<PurchaseOrderDto | null>(null);
  const [preset, setPreset] = useState<LoopPresetDto | null>(null);
  const [inspector, setInspector] = useState<UserDto | null>(null);
  const [lotSizeText, setLotSizeText] = useState('1000');
  const [aql, setAql] = useState<Record<(typeof AQL_CLASSES)[number], number>>(DEFAULT_AQL);
  const [preview, setPreview] = useState<AqlPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** Minted once per mount — the create's idempotency key. */
  const [clientRequestId] = useState(
    () => `mob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );

  // The initial state is already 'loading', so the mount effect only fetches;
  // the retry handler (an event, where sync setState is fine) resets it first.
  const fetchAndApply = useCallback(() => {
    fetchFormData().then((result) => {
      setLoad(result);
      if (result.kind === 'ready') {
        setPreset((p) => p ?? result.presets[0] ?? null);
      }
    });
  }, []);
  useEffect(fetchAndApply, [fetchAndApply]);
  const reload = useCallback(() => {
    setLoad({ kind: 'loading' });
    fetchAndApply();
  }, [fetchAndApply]);

  const lotSize = Number(lotSizeText);
  const lotValid = Number.isFinite(lotSize) && lotSize >= 2;

  // Live AQL preview, 300ms debounce, stale responses dropped — the preview
  // and the create send the SAME inputs so the preview can never show a plan
  // the create would reject.
  useEffect(() => {
    let live = true;
    // Everything, including the invalid-lot branch, runs after the debounce —
    // no synchronous setState inside the effect body.
    const t = setTimeout(() => {
      if (!live) return;
      if (!lotValid) {
        setPreview(null);
        setPreviewError('Enter a lot size of 2 or more');
        return;
      }
      const qs = `lotSize=${lotSize}&critical=${aql.critical}&major=${aql.major}&minor=${aql.minor}`;
      client
        .get<AqlPreviewDto>(`/inspections/aql-preview?${qs}`)
        .then((p) => {
          if (!live) return;
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e) => {
          if (!live) return;
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : 'Preview failed');
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [lotSize, lotValid, aql]);

  const canCreate = Boolean(po && preset && lotValid && !pending);

  async function create() {
    if (!po || !preset || !lotValid) return;
    setPending(true);
    setCreateError(null);
    try {
      const created = await client.post<InspectionDto>('/inspections', {
        poId: po.id,
        loopPresetId: preset.id,
        lotSize,
        aqlPlan: aql,
        assignedInspectorId: inspector?.id,
        clientRequestId,
      });
      router.replace(`/inspections/${created.id}/review`);
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : 'Could not create the inspection.');
    } finally {
      setPending(false);
    }
  }

  const aqlLabel = (v: number) => (v === 0 ? '0 · any defect rejects' : v.toFixed(1));

  const presetLabel = useMemo(() => (p: LoopPresetDto) => `${p.name} (v${p.version})`, []);

  if (load.kind === 'loading') {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  }
  if (load.kind === 'forbidden') {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.mutedText}>Creating an inspection needs the QA Manager role.</Text>
        <BackButton />
      </SafeAreaView>
    );
  }
  if (load.kind === 'error') {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.mutedText}>{load.message}</Text>
        <Pressable onPress={reload} hitSlop={8}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (load.pos.length === 0) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.mutedText}>
          No purchase orders yet. Create two companies (the client and the factory), a product and a
          PO in the console first, then return here.
        </Text>
        <BackButton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <BackButton label="Cancel" />
        <Text style={styles.headerTitle}>New inspection</Text>
        <Pressable onPress={create} disabled={!canCreate} hitSlop={8}>
          {pending ? (
            <ActivityIndicator color={palette.accent} size="small" />
          ) : (
            <Text style={[styles.link, !canCreate && styles.dim]}>Create</Text>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <OptionPicker
          label="Purchase order *"
          value={po}
          options={load.pos}
          display={(p) => p.poNumber}
          placeholder="Select the PO…"
          onSelect={setPo}
        />
        {po ? (
          <View style={styles.poContext}>
            <Text style={styles.poContextLine}>
              Client: <Text style={styles.poContextValue}>{po.clientCompany?.name ?? '—'}</Text>
            </Text>
            <Text style={styles.poContextLine}>
              Factory: <Text style={styles.poContextValue}>{po.factoryCompany?.name ?? '—'}</Text>
            </Text>
            <Text style={styles.poContextLine}>
              Product: <Text style={styles.poContextValue}>{po.product?.styleNumber ?? '—'}</Text>
            </Text>
          </View>
        ) : null}

        {load.presets.length === 0 ? (
          <Text style={styles.errorText}>
            No loop presets exist yet — create one in the console first.
          </Text>
        ) : (
          <OptionPicker
            label="Loop preset *"
            value={preset}
            options={load.presets}
            display={presetLabel}
            placeholder="Select the preset…"
            onSelect={setPreset}
          />
        )}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Lot size (pcs) *</Text>
          <TextInput
            style={styles.input}
            value={lotSizeText}
            onChangeText={setLotSizeText}
            keyboardType="number-pad"
            placeholder="e.g. 1200"
            placeholderTextColor={palette.faint}
          />
        </View>

        <OptionPicker
          label="Assigned inspector · optional"
          value={inspector}
          options={load.inspectors}
          display={(u) => u.name || u.email}
          placeholder="Unassigned (draft)"
          onSelect={setInspector}
        />

        <Text style={styles.sectionLabel}>Acceptance quality limits</Text>
        <Text style={styles.hint}>
          General inspection Level II, single sampling, normal severity. The level is fixed; the
          per-class AQL is the QA Manager&apos;s call and is frozen onto the inspection at creation.
        </Text>
        {AQL_CLASSES.map((cls) => (
          <OptionPicker
            key={cls}
            label={`${cls.charAt(0).toUpperCase() + cls.slice(1)} AQL`}
            value={aql[cls]}
            options={AQL_VALUES}
            display={aqlLabel}
            placeholder=""
            onSelect={(v) => setAql((a) => ({ ...a, [cls]: v }))}
          />
        ))}

        {/* Computed plan */}
        <Text style={styles.sectionLabel}>Computed AQL plan</Text>
        {previewError ? (
          <Text style={styles.errorText}>{previewError}</Text>
        ) : preview ? (
          <View style={styles.plan}>
            <View style={styles.planRow}>
              <Text style={styles.planStat}>
                Code <Text style={styles.planStatValue}>{preview.sampleSizeCodeLetter}</Text>
              </Text>
              <Text style={styles.planStat}>
                Sample n <Text style={styles.planStatValue}>{preview.sampleSize}</Text>
              </Text>
            </View>
            {AQL_CLASSES.map((cls) => (
              <View key={cls} style={styles.planClassRow}>
                <Text style={styles.planClass}>{cls}</Text>
                <Text style={styles.planCell}>AQL {preview.perClass[cls].aql}</Text>
                <Text style={styles.planCell}>Ac {preview.perClass[cls].ac}</Text>
                <Text style={styles.planCell}>Re {preview.perClass[cls].re}</Text>
              </View>
            ))}
          </View>
        ) : (
          <ActivityIndicator color={palette.faint} size="small" />
        )}

        {createError ? <Text style={styles.errorText}>{createError}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.panel,
  },
  headerTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.4 },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center' },
  errorText: { color: palette.danger, fontSize: 13, marginTop: 4 },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
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
    paddingVertical: 11,
    color: palette.ink,
    fontSize: 14,
  },
  poContext: {
    borderWidth: 1,
    borderColor: palette.lineSoft,
    borderRadius: 8,
    backgroundColor: palette.panel,
    padding: 12,
    gap: 4,
  },
  poContextLine: { color: palette.sub, fontSize: 13 },
  poContextValue: { color: palette.ink, fontWeight: '600' },
  sectionLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  plan: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 10,
    backgroundColor: palette.panel,
    padding: 14,
    gap: 8,
  },
  planRow: { flexDirection: 'row', gap: 24 },
  planStat: { color: palette.sub, fontSize: 13 },
  planStatValue: { color: palette.ink, fontWeight: '700', fontSize: 15 },
  planClassRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: palette.lineSoft,
    paddingTop: 8,
    gap: 12,
  },
  planClass: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    textTransform: 'capitalize',
  },
  planCell: { color: palette.sub, fontSize: 13 },
});
