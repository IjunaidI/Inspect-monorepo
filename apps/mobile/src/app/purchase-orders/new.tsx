/**
 * Create purchase order (INS-086 Phase 4) — port of the web
 * `/purchase-orders/new`. Role floor QA_MANAGER.
 *
 * INS-055: both party pickers are fed by the SAME company list — trade role
 * is a property of this PO, not of the company. Ranking comes from the shared
 * `rankCompaniesByActivity`, ranked per trade role since INS-087 (the Client
 * picker floats recent clients, the Factory picker recent factories). Self-dealing (client === factory) is pre-checked here as UX and
 * enforced by the API's 400. Unlike the web form, a failed picker load is a
 * real error with retry — never silently empty selects.
 *
 * INS-091: every picker is searchable and ends in "+ Add new…" — a company or
 * product is created in a sheet, appended and selected; nothing typed here is
 * lost. The lists live in state so they can grow.
 *
 * INS-092: the two lists load independently (`fetchMissing`) — when one
 * fails, Retry asks only for that one and the other is kept. Pull-to-refresh
 * re-fetches both without touching the form. Create confirms with a toast.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { rankCompaniesByActivity, roleAtLeast } from '@inspect/domain';
import type {
  CompanyDto,
  CreatePurchaseOrderInput,
  ProductDto,
  PurchaseOrderDto,
} from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { OptionPicker } from '@/components/option-picker';
import { describeCreateError } from '@/components/quick-create-sheet';
import { QuickCreateCompanySheet } from '@/components/quick-create/company';
import { QuickCreateProductSheet } from '@/components/quick-create/product';
import { useToast } from '@/components/toast';
import { Button, Field, Input, TextButton, ui } from '@/components/ui';
import { fetchMissing, isComplete } from '@/lib/fetch-missing';
import { client, loadIdentity } from '@/lib/session';

type Lists = { companies: CompanyDto[]; products: ProductDto[] };
const LIST_KEYS: (keyof Lists)[] = ['companies', 'products'];
const LIST_LABEL: Record<keyof Lists, string> = { companies: 'companies', products: 'products' };

const fetchers = {
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

export default function NewPurchaseOrder() {
  const router = useRouter();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // Seeded from the load, then grown by the quick-create sheets.
  const [lists, setLists] = useState<Partial<Lists>>({});
  const [creating, setCreating] = useState<'client' | 'factory' | 'product' | null>(null);
  const [poNumber, setPoNumber] = useState('');
  const [clientCo, setClientCo] = useState<CompanyDto | null>(null);
  const [factoryCo, setFactoryCo] = useState<CompanyDto | null>(null);
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAndApply = useCallback((have: Partial<Lists>) => {
    return fetchFormData(have).then((result) => {
      setLists(result.values);
      setLoad(result.load);
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

  const clientCompanies = useMemo(
    () => rankCompaniesByActivity(lists.companies ?? [], 'client'),
    [lists.companies],
  );
  const factoryCompanies = useMemo(
    () => rankCompaniesByActivity(lists.companies ?? [], 'factory'),
    [lists.companies],
  );
  const products = lists.products ?? [];

  // Mirrors the API's 400 (spec §2.4) — saves a round trip and names the
  // problem next to the field. The server check stays the authority.
  const selfDealing = clientCo !== null && clientCo.id === factoryCo?.id;
  const quantity = quantityText.trim() === '' ? undefined : Number(quantityText);
  const quantityValid = quantity === undefined || (Number.isFinite(quantity) && quantity >= 1);
  const ready =
    poNumber.trim() !== '' &&
    clientCo !== null &&
    factoryCo !== null &&
    product !== null &&
    !selfDealing &&
    quantityValid;

  async function create() {
    if (!ready || !clientCo || !factoryCo || !product) return;
    setPending(true);
    setError(null);
    try {
      const body: CreatePurchaseOrderInput = {
        poNumber: poNumber.trim(),
        clientCompanyId: clientCo.id,
        factoryCompanyId: factoryCo.id,
        productId: product.id,
        ...(quantity !== undefined ? { totalQuantity: quantity } : {}),
      };
      const created = await client.post<PurchaseOrderDto>('/purchase-orders', body);
      toast(`Purchase order ${created.poNumber} created`);
      router.replace(`/purchase-orders/${created.id}`);
    } catch (e) {
      setError(describeCreateError(e, 'Create failed'));
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

  if (load.kind !== 'ready' || !isComplete(lists, LIST_KEYS)) {
    const missing = load.kind === 'error' ? load.missing : LIST_KEYS;
    return (
      <SafeAreaView style={ui.screen}>
        <View style={ui.centered}>
          <Text style={ui.errorTitle}>
            {load.kind === 'forbidden'
              ? 'QA Manager access required'
              : `Could not load ${missing.map((k) => LIST_LABEL[k]).join(' and ')}`}
          </Text>
          {load.kind === 'error' ? <Text style={ui.mutedText}>{load.message}</Text> : null}
          {load.kind === 'error' && missing.length < LIST_KEYS.length ? (
            <Text style={ui.hint}>
              The {LIST_KEYS.filter((k) => !missing.includes(k))
                .map((k) => LIST_LABEL[k])
                .join(', ')}{' '}
              loaded fine — Retry asks only for what is missing.
            </Text>
          ) : null}
          <View style={ui.centerActions}>
            {load.kind === 'error' ? <TextButton label="Retry" onPress={reload} /> : null}
            <BackButton label="Go back" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <FormScreen onRefresh={refresh}>
      <Text style={ui.title}>New purchase order</Text>

      <Field label="PO number *">
        <Input
          value={poNumber}
          onChangeText={setPoNumber}
          placeholder="PO-2026-0001"
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </Field>

      <OptionPicker
        label="Client (receives the branded report) *"
        value={clientCo}
        options={clientCompanies}
        display={(c) => c.name}
        placeholder="Select the client…"
        emptyText="No companies yet."
        createLabel="+ Add new company…"
        onCreate={() => setCreating('client')}
        onSelect={setClientCo}
      />
      <OptionPicker
        label="Factory (produces the goods) *"
        value={factoryCo}
        options={factoryCompanies}
        display={(c) => c.name}
        placeholder="Select the factory…"
        emptyText="No companies yet."
        createLabel="+ Add new company…"
        onCreate={() => setCreating('factory')}
        onSelect={setFactoryCo}
      />
      {selfDealing ? (
        <Text style={ui.errorText}>
          Client and factory must differ — the same company cannot hold both roles on one PO.
        </Text>
      ) : null}

      <OptionPicker
        label="Product *"
        value={product}
        options={products}
        display={(p) => (p.description ? `${p.styleNumber} — ${p.description}` : p.styleNumber)}
        placeholder="Select the product…"
        emptyText="No products yet."
        createLabel="+ Add new product…"
        onCreate={() => setCreating('product')}
        onSelect={setProduct}
      />

      <Field
        label="Total quantity (pcs)"
        error={quantityValid ? null : 'Quantity must be a number of 1 or more.'}
      >
        <Input
          invalid={!quantityValid}
          value={quantityText}
          onChangeText={setQuantityText}
          placeholder="Optional"
          keyboardType="number-pad"
        />
      </Field>

      {error ? <Text style={ui.errorText}>{error}</Text> : null}

      <Button
        label="Create purchase order"
        loadingLabel="Creating…"
        loading={pending}
        disabled={!ready}
        onPress={create}
      />

      <QuickCreateCompanySheet
        visible={creating === 'client' || creating === 'factory'}
        onClose={() => setCreating(null)}
        onCreated={(c) => {
          setLists((prev) => ({ ...prev, companies: [...(prev.companies ?? []), c] }));
          if (creating === 'client') setClientCo(c);
          if (creating === 'factory') setFactoryCo(c);
          setCreating(null);
        }}
      />
      <QuickCreateProductSheet
        visible={creating === 'product'}
        onClose={() => setCreating(null)}
        onCreated={(p) => {
          setLists((prev) => ({ ...prev, products: [...(prev.products ?? []), p] }));
          setProduct(p);
          setCreating(null);
        }}
      />
    </FormScreen>
  );
}
