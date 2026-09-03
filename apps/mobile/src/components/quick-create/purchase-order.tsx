/**
 * INS-091 — a PO created from the new-inspection picker. Carries the same
 * three pickers as /purchase-orders/new, each with its own "+ Add new…"
 * (one nested sheet). Lists are seeded by the host and grow locally.
 */
import { palette } from '@inspect/design-tokens';
import { rankCompaniesByActivity } from '@inspect/domain';
import type {
  CompanyDto,
  CreatePurchaseOrderInput,
  ProductDto,
  PurchaseOrderDto,
} from '@inspect/shared-types';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { OptionPicker } from '@/components/option-picker';
import { client } from '@/lib/session';
import { QuickCreateSheet, describeCreateError, sheetStyles as s } from '../quick-create-sheet';
import { QuickCreateCompanySheet } from './company';
import { QuickCreateProductSheet } from './product';

type Creating = 'client' | 'factory' | 'product' | null;

const companyLabel = (c: CompanyDto) => c.name;
const productLabel = (p: ProductDto) =>
  p.description ? `${p.styleNumber} — ${p.description}` : p.styleNumber;

export function QuickCreatePurchaseOrderSheet({
  visible,
  onClose,
  onCreated,
  companies: initialCompanies,
  products: initialProducts,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (po: PurchaseOrderDto) => void;
  companies: CompanyDto[];
  products: ProductDto[];
}) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [products, setProducts] = useState(initialProducts);
  const [poNumber, setPoNumber] = useState('');
  const [clientCo, setClientCo] = useState<CompanyDto | null>(null);
  const [factoryCo, setFactoryCo] = useState<CompanyDto | null>(null);
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [creating, setCreating] = useState<Creating>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranked = useMemo(() => rankCompaniesByActivity(companies), [companies]);
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
      onCreated(created);
    } catch (e) {
      setError(describeCreateError(e, 'Could not create the purchase order.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <QuickCreateSheet visible={visible} title="New purchase order" onClose={onClose}>
      <View style={s.field}>
        <Text style={s.fieldLabel}>PO number *</Text>
        <TextInput
          style={s.input}
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
        options={ranked}
        display={companyLabel}
        placeholder="Select the client…"
        emptyText="No companies yet."
        createLabel="+ Add new company…"
        onCreate={() => setCreating('client')}
        onSelect={setClientCo}
      />
      <OptionPicker
        label="Factory (produces the goods) *"
        value={factoryCo}
        options={ranked}
        display={companyLabel}
        placeholder="Select the factory…"
        emptyText="No companies yet."
        createLabel="+ Add new company…"
        onCreate={() => setCreating('factory')}
        onSelect={setFactoryCo}
      />
      {selfDealing ? <Text style={s.errorText}>Client and factory must differ.</Text> : null}
      <OptionPicker
        label="Product *"
        value={product}
        options={products}
        display={productLabel}
        placeholder="Select the product…"
        emptyText="No products yet."
        createLabel="+ Add new product…"
        onCreate={() => setCreating('product')}
        onSelect={setProduct}
      />
      <View style={s.field}>
        <Text style={s.fieldLabel}>Total quantity (pcs)</Text>
        <TextInput
          style={s.input}
          value={quantityText}
          onChangeText={setQuantityText}
          placeholder="Optional"
          placeholderTextColor={palette.faint}
          keyboardType="number-pad"
        />
        {!quantityValid ? (
          <Text style={s.errorText}>Quantity must be a number of 1 or more.</Text>
        ) : null}
      </View>
      {error ? <Text style={s.errorText}>{error}</Text> : null}
      <Pressable
        style={[s.button, (!ready || pending) && s.buttonDisabled]}
        onPress={create}
        disabled={!ready || pending}
      >
        <Text style={s.buttonLabel}>{pending ? 'Creating…' : 'Create purchase order'}</Text>
      </Pressable>

      <QuickCreateCompanySheet
        visible={creating === 'client' || creating === 'factory'}
        onClose={() => setCreating(null)}
        onCreated={(c) => {
          setCompanies((prev) => [...prev, c]);
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
    </QuickCreateSheet>
  );
}
