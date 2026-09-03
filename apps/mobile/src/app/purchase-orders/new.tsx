/**
 * Create purchase order (INS-086 Phase 4) — port of the web
 * `/purchase-orders/new`. Role floor QA_MANAGER.
 *
 * INS-055: both party pickers are fed by the SAME company list — trade role
 * is a property of this PO, not of the company. Ranking comes from the shared
 * `rankCompaniesByActivity` (INS-087: per-role ranking waits on per-role
 * counts). Self-dealing (client === factory) is pre-checked here as UX and
 * enforced by the API's 400. Unlike the web form, a failed picker load is a
 * real error with retry — never silently empty selects.
 *
 * INS-091: every picker is searchable and ends in "+ Add new…" — a company or
 * product is created in a sheet, appended and selected; nothing typed here is
 * lost. The lists live in state so they can grow.
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
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OptionPicker } from '@/components/option-picker';
import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { describeCreateError } from '@/components/quick-create-sheet';
import { QuickCreateCompanySheet } from '@/components/quick-create/company';
import { QuickCreateProductSheet } from '@/components/quick-create/product';
import { client, loadIdentity } from '@/lib/session';

type Load =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; companies: CompanyDto[]; products: ProductDto[] };

/** Pure fetch — setState only ever happens in .then. */
async function fetchFormData(): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    const [companies, products] = await Promise.all([
      client.get<CompanyDto[]>('/companies'),
      client.get<ProductDto[]>('/products'),
    ]);
    return {
      kind: 'ready',
      companies: rankCompaniesByActivity(companies),
      products,
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Load failed',
    };
  }
}

export default function NewPurchaseOrder() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // Seeded from the load, then grown by the quick-create sheets.
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [creating, setCreating] = useState<'client' | 'factory' | 'product' | null>(null);
  const [poNumber, setPoNumber] = useState('');
  const [clientCo, setClientCo] = useState<CompanyDto | null>(null);
  const [factoryCo, setFactoryCo] = useState<CompanyDto | null>(null);
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAndApply = useCallback(() => {
    fetchFormData().then((result) => {
      setLoad(result);
      if (result.kind === 'ready') {
        setCompanies(result.companies);
        setProducts(result.products);
      }
    });
  }, []);
  useEffect(fetchAndApply, [fetchAndApply]);
  const reload = useCallback(() => {
    setLoad({ kind: 'loading' });
    fetchAndApply();
  }, [fetchAndApply]);

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
      router.replace(`/purchase-orders/${created.id}`);
    } catch (e) {
      setError(describeCreateError(e, 'Create failed'));
      setPending(false);
    }
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
              : 'Could not load companies and products'}
          </Text>
          {load.kind === 'error' ? <Text style={styles.mutedText}>{load.message}</Text> : null}
          <View style={styles.centerActions}>
            {load.kind === 'error' ? (
              <Pressable onPress={reload} hitSlop={8}>
                <Text style={styles.link}>Retry</Text>
              </Pressable>
            ) : null}
            <BackButton label="Go back" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <FormScreen>
      <Text style={styles.title}>New purchase order</Text>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>PO number *</Text>
        <TextInput
          style={styles.input}
          value={poNumber}
          onChangeText={setPoNumber}
          placeholder="PO-2026-0001"
          placeholderTextColor={palette.faint}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>

      <OptionPicker
        label="Client (receives the branded report) *"
        value={clientCo}
        options={companies}
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
        options={companies}
        display={(c) => c.name}
        placeholder="Select the factory…"
        emptyText="No companies yet."
        createLabel="+ Add new company…"
        onCreate={() => setCreating('factory')}
        onSelect={setFactoryCo}
      />
      {selfDealing ? (
        <Text style={styles.errorText}>
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

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Total quantity (pcs)</Text>
        <TextInput
          style={[styles.input, !quantityValid && styles.inputInvalid]}
          value={quantityText}
          onChangeText={setQuantityText}
          placeholder="Optional"
          placeholderTextColor={palette.faint}
          keyboardType="number-pad"
        />
        {!quantityValid ? (
          <Text style={styles.errorText}>Quantity must be a number of 1 or more.</Text>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        style={[styles.button, (!ready || pending) && styles.buttonDisabled]}
        onPress={create}
        disabled={!ready || pending}
      >
        <Text style={styles.buttonLabel}>{pending ? 'Creating…' : 'Create purchase order'}</Text>
      </Pressable>

      <QuickCreateCompanySheet
        visible={creating === 'client' || creating === 'factory'}
        onClose={() => setCreating(null)}
        onCreated={(c) => {
          setCompanies((prev) => rankCompaniesByActivity([...prev, c]));
          if (creating === 'client') setClientCo(c);
          if (creating === 'factory') setFactoryCo(c);
          setCreating(null);
        }}
      />
      <QuickCreateProductSheet
        visible={creating === 'product'}
        onClose={() => setCreating(null)}
        onCreated={(p) => {
          setProducts((prev) => [...prev, p]);
          setProduct(p);
          setCreating(null);
        }}
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  centerActions: { flexDirection: 'row', gap: 24, marginTop: 8 },
  errorTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center' },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
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
  inputInvalid: { borderColor: palette.danger },
  errorText: { color: palette.danger, fontSize: 13 },
  button: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
