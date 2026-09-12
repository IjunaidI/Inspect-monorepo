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
 *
 * INS-091: no dead-end empty state — the PO picker creates a PO (and its
 * companies / product) in place via nested sheets; the client company's
 * default preset is honoured until the user picks one by hand.
 *
 * INS-092: the five lists load independently (`fetchMissing`) — Retry asks
 * only for the ones that failed; the AQL preview keeps the last plan on
 * screen while the next one computes ("Updating…" instead of a spinner);
 * pull-to-refresh re-fetches the lists without touching the form; create
 * confirms with a toast.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type {
  AqlPreviewDto,
  CompanyDto,
  InspectionDto,
  LoopPresetDto,
  ProductDto,
  PurchaseOrderDto,
  UserDto,
} from '@inspect/shared-types';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { OptionPicker } from '@/components/option-picker';
import { describeCreateError } from '@/components/quick-create-sheet';
import { QuickCreatePurchaseOrderSheet } from '@/components/quick-create/purchase-order';
import { useToast } from '@/components/toast';
import { Field, Input, TextButton, ui } from '@/components/ui';
import { fetchMissing, isComplete } from '@/lib/fetch-missing';
import { client, loadIdentity } from '@/lib/session';

/** Mirrors the API's ALLOWED_AQL_VALUES; 0 = "any defect rejects". */
const AQL_VALUES = [0, 1.0, 1.5, 2.5, 4.0, 6.5];
const DEFAULT_AQL = { critical: 0, major: 2.5, minor: 4.0 };
const AQL_CLASSES = ['critical', 'major', 'minor'] as const;

type Lists = {
  pos: PurchaseOrderDto[];
  presets: LoopPresetDto[];
  users: UserDto[];
  /** INS-091: seed lists for the PO quick-create sheet. */
  companies: CompanyDto[];
  products: ProductDto[];
};
const LIST_KEYS: (keyof Lists)[] = ['pos', 'presets', 'users', 'companies', 'products'];
const LIST_LABEL: Record<keyof Lists, string> = {
  pos: 'purchase orders',
  presets: 'loop presets',
  users: 'inspectors',
  companies: 'companies',
  products: 'products',
};

const fetchers = {
  pos: () => client.get<PurchaseOrderDto[]>('/purchase-orders'),
  presets: () => client.get<LoopPresetDto[]>('/loop-presets'),
  users: () => client.get<UserDto[]>('/users'),
  companies: () => client.get<CompanyDto[]>('/companies'),
  products: () => client.get<ProductDto[]>('/products'),
};

type Load =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string; missing: (keyof Lists)[] }
  | { kind: 'ready' };

/**
 * Pure fetch — fetches only the lists `have` lacks and reports which are
 * still missing; setState only ever happens in .then.
 */
async function fetchFormData(
  have: Partial<Lists>,
): Promise<{ values: Partial<Lists>; load: Load }> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { values: have, load: { kind: 'forbidden' } };
  const { values, failures } = await fetchMissing<Lists>(have, fetchers);
  if (failures.length === 0) return { values, load: { kind: 'ready' } };
  if (failures.some((f) => f.error instanceof ApiError && f.error.status === 403)) {
    return { values, load: { kind: 'forbidden' } };
  }
  return {
    values,
    load: {
      kind: 'error',
      message: describeCreateError(failures[0].error, 'Load failed'),
      missing: failures.map((f) => f.key),
    },
  };
}

export default function NewInspection() {
  const router = useRouter();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // Seeded from the load, then grown by the PO quick-create sheet.
  const [lists, setLists] = useState<Partial<Lists>>({});
  const [po, setPo] = useState<PurchaseOrderDto | null>(null);
  const [creatingPo, setCreatingPo] = useState(false);
  const [presetTouched, setPresetTouched] = useState(false);
  const [preset, setPreset] = useState<LoopPresetDto | null>(null);
  const [inspector, setInspector] = useState<UserDto | null>(null);
  const [lotSizeText, setLotSizeText] = useState('1000');
  const [aql, setAql] = useState<Record<(typeof AQL_CLASSES)[number], number>>(DEFAULT_AQL);
  const [preview, setPreview] = useState<AqlPreviewDto | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** Minted once per mount — the create's idempotency key. */
  const [clientRequestId] = useState(
    () => `mob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );

  // The initial state is already 'loading', so the mount effect only fetches;
  // the retry handler (an event, where sync setState is fine) resets it first.
  const fetchAndApply = useCallback((have: Partial<Lists>) => {
    return fetchFormData(have).then((result) => {
      setLists(result.values);
      setLoad(result.load);
      if (result.values.presets) {
        const first = result.values.presets[0] ?? null;
        setPreset((p) => p ?? first);
      }
      return result;
    });
  }, []);
  useEffect(() => {
    void fetchAndApply({});
  }, [fetchAndApply]);

  /** Retry: only what is missing. */
  function reload() {
    setLoad({ kind: 'loading' });
    void fetchAndApply(lists);
  }

  /** Pull-to-refresh: everything, but never flip a working form to an error. */
  async function refresh() {
    const result = await fetchFormData({});
    if (result.load.kind === 'ready') setLists(result.values);
    else toast('Could not refresh the lists', { tone: 'danger' });
  }

  const presets = lists.presets ?? [];
  const inspectors = useMemo(
    () => (lists.users ?? []).filter((u) => u.role === 'INSPECTOR' && u.status === 'ACTIVE'),
    [lists.users],
  );

  const lotSize = Number(lotSizeText);
  const lotValid = Number.isFinite(lotSize) && lotSize >= 2;

  // INS-091 — honour the client company's default preset on PO change, until
  // the user picks a preset by hand. Skipped when the id is not in the list.
  function selectPo(next: PurchaseOrderDto) {
    setPo(next);
    if (presetTouched) return;
    const preferred = next.clientCompany?.defaultLoopPresetId;
    const match = preferred ? presets.find((p) => p.id === preferred) : undefined;
    if (match) setPreset(match);
  }

  // Live AQL preview, 300ms debounce, stale responses dropped — the preview
  // and the create send the SAME inputs so the preview can never show a plan
  // the create would reject. The previous plan stays on screen (dimmed, with
  // an "Updating…" note) until the next one lands; only an error clears it.
  useEffect(() => {
    let live = true;
    // Everything, including the invalid-lot branch, runs after the debounce —
    // no synchronous setState inside the effect body.
    const t = setTimeout(() => {
      if (!live) return;
      if (!lotValid) {
        setPreview(null);
        setPreviewBusy(false);
        setPreviewError('Enter a lot size of 2 or more');
        return;
      }
      setPreviewBusy(true);
      const qs = `lotSize=${lotSize}&critical=${aql.critical}&major=${aql.major}&minor=${aql.minor}`;
      client
        .get<AqlPreviewDto>(`/inspections/aql-preview?${qs}`)
        .then((p) => {
          if (!live) return;
          setPreview(p);
          setPreviewError(null);
          setPreviewBusy(false);
        })
        .catch((e) => {
          if (!live) return;
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : 'Preview failed');
          setPreviewBusy(false);
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
      toast(`Inspection created for ${po.poNumber}`);
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
      <SafeAreaView style={[ui.screen, styles.center]}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  }
  if (load.kind === 'forbidden') {
    return (
      <SafeAreaView style={[ui.screen, styles.center]}>
        <Text style={ui.mutedText}>Creating an inspection needs the QA Manager role.</Text>
        <BackButton />
      </SafeAreaView>
    );
  }
  if (load.kind === 'error' || !isComplete(lists, LIST_KEYS)) {
    const missing = load.kind === 'error' ? load.missing : LIST_KEYS;
    const loaded = LIST_KEYS.filter((k) => !missing.includes(k));
    return (
      <SafeAreaView style={[ui.screen, styles.center]}>
        <Text style={ui.errorTitle}>
          Could not load {missing.map((k) => LIST_LABEL[k]).join(', ')}
        </Text>
        {load.kind === 'error' ? <Text style={ui.mutedText}>{load.message}</Text> : null}
        {loaded.length ? (
          <Text style={[ui.hint, { textAlign: 'center' }]}>
            {loaded.map((k) => LIST_LABEL[k]).join(', ')} loaded fine — Retry asks only for what
            is missing.
          </Text>
        ) : null}
        <View style={ui.centerActions}>
          <TextButton label="Retry" onPress={reload} />
          <BackButton />
        </View>
      </SafeAreaView>
    );
  }

  const header = (
    <View style={styles.header}>
      <BackButton label="Cancel" />
      <Text style={styles.headerTitle}>New inspection</Text>
      <Pressable
        onPress={create}
        disabled={!canCreate}
        hitSlop={8}
        style={styles.headerAction}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canCreate, busy: pending }}
      >
        {pending ? (
          <ActivityIndicator color={palette.accent} size="small" />
        ) : (
          <Text style={[ui.link, !canCreate && styles.dim]}>Create</Text>
        )}
      </Pressable>
    </View>
  );

  return (
    <FormScreen header={header} onRefresh={refresh}>
      <OptionPicker
        label="Purchase order *"
        value={po}
        options={lists.pos}
        display={(p) => p.poNumber}
        placeholder="Select the PO…"
        emptyText="No purchase orders yet — add one below."
        createLabel="+ Add new purchase order…"
        onCreate={() => setCreatingPo(true)}
        onSelect={selectPo}
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

      {presets.length === 0 ? (
        <Text style={ui.hint}>
          No loop presets yet.{' '}
          <Link href="/presets/new" style={ui.link}>
            Create one in the preset builder
          </Link>
          , then return here.
        </Text>
      ) : (
        <OptionPicker
          label="Loop preset *"
          value={preset}
          options={presets}
          display={presetLabel}
          placeholder="Select the preset…"
          onSelect={(p) => {
            setPreset(p);
            setPresetTouched(true);
          }}
        />
      )}

      <Field label="Lot size (pcs) *">
        <Input
          value={lotSizeText}
          onChangeText={setLotSizeText}
          keyboardType="number-pad"
          placeholder="e.g. 1200"
        />
      </Field>

      <OptionPicker
        label="Assigned inspector · optional"
        value={inspector}
        options={inspectors}
        display={(u) => u.name || u.email}
        placeholder="Unassigned (draft)"
        onSelect={setInspector}
      />

      <Text style={styles.sectionLabel}>Acceptance quality limits</Text>
      <Text style={ui.hint}>
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
      <View style={styles.planHead}>
        <Text style={styles.sectionLabel}>Computed AQL plan</Text>
        {previewBusy ? <Text style={styles.updating}>Updating…</Text> : null}
      </View>
      {previewError ? (
        <Text style={ui.errorText}>{previewError}</Text>
      ) : preview ? (
        <View style={[styles.plan, previewBusy && styles.planStale]}>
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
        // Only before the FIRST plan arrives — never between updates.
        <ActivityIndicator color={palette.faint} size="small" />
      )}

      {createError ? <Text style={ui.errorText}>{createError}</Text> : null}

      <QuickCreatePurchaseOrderSheet
        visible={creatingPo}
        onClose={() => setCreatingPo(false)}
        companies={lists.companies}
        products={lists.products}
        onCreated={(created) => {
          setLists((prev) => ({ ...prev, pos: [created, ...(prev.pos ?? [])] }));
          setCreatingPo(false);
          selectPo(created);
        }}
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
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
  headerAction: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  dim: { opacity: 0.4 },
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
  planHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  updating: { color: palette.faint, fontSize: 11, fontStyle: 'italic', marginTop: 8 },
  plan: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 10,
    backgroundColor: palette.panel,
    padding: 14,
    gap: 8,
  },
  planStale: { opacity: 0.6 },
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
