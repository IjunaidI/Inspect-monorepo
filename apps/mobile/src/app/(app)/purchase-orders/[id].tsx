/**
 * Purchase order detail/edit (INS-086 Phase 4) — port of the web
 * `/purchase-orders/[id]`. Role floor QA_MANAGER.
 *
 * The parties and product are IMMUTABLE after create (the API's
 * UpdatePurchaseOrderInput accepts only poNumber/totalQuantity) — rendered
 * read-only here. Differences from the web page, each deliberate: 403/404
 * told apart (the web maps both to notFound()), and delete sits behind a
 * native confirm (the web's danger button fires immediately). A PO
 * referenced by inspections comes back as the API's friendly 400.
 *
 * INS-092: pull-to-refresh reloads the record without discarding typed edits;
 * saves confirm with a toast.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { PurchaseOrderDto, UpdatePurchaseOrderInput } from '@inspect/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { useToast } from '@/components/toast';
import { Button, Field, Input, TextButton, ui } from '@/components/ui';
import { client, loadIdentity } from '@/lib/session';

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; po: PurchaseOrderDto };

/** Pure fetch — setState only ever happens in .then. */
async function fetchPo(id: string): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    return {
      kind: 'ready',
      po: await client.get<PurchaseOrderDto>(`/purchase-orders/${id}`),
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Load failed',
    };
  }
}

export default function PurchaseOrderDetail() {
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const poId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [poNumber, setPoNumber] = useState<string | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const apply = useCallback((result: Load) => {
    setLoad(result);
    if (result.kind === 'ready') {
      setPoNumber(result.po.poNumber);
      setQuantityText(result.po.totalQuantity != null ? String(result.po.totalQuantity) : '');
    }
  }, []);

  useEffect(() => {
    fetchPo(poId).then(apply);
  }, [poId, apply]);

  const reload = useCallback(() => {
    fetchPo(poId).then(apply);
  }, [poId, apply]);

  /** Pull-to-refresh: update the record, keep whatever is being typed. */
  async function refresh() {
    const result = await fetchPo(poId);
    if (result.kind === 'ready') setLoad(result);
    else toast('Could not refresh the purchase order', { tone: 'danger' });
  }

  async function save(po: PurchaseOrderDto) {
    const trimmed = (poNumber ?? '').trim();
    if (!trimmed) {
      setFormError('PO number is required.');
      return;
    }
    const quantity = quantityText.trim() === '' ? undefined : Number(quantityText);
    if (quantity !== undefined && (!Number.isFinite(quantity) || quantity < 1)) {
      setFormError('Quantity must be a number of 1 or more.');
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      const body: UpdatePurchaseOrderInput = {
        poNumber: trimmed,
        ...(quantity !== undefined ? { totalQuantity: quantity } : {}),
      };
      await client.patch(`/purchase-orders/${po.id}`, body);
      toast('Purchase order saved');
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setPending(false);
    }
  }

  function confirmDelete(po: PurchaseOrderDto) {
    Alert.alert(
      'Delete purchase order?',
      `${po.poNumber} will be permanently removed. A PO referenced by inspections cannot be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setPending(true);
              setFormError(null);
              try {
                await client.del(`/purchase-orders/${po.id}`);
                toast(`${po.poNumber} deleted`, { tone: 'neutral' });
                router.back();
              } catch (e) {
                setFormError(e instanceof Error ? e.message : 'Delete failed');
              } finally {
                setPending(false);
              }
            })();
          },
        },
      ],
    );
  }

  if (load.kind === 'loading' || (load.kind === 'ready' && poNumber === null)) {
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
            {load.kind === 'missing'
              ? 'Purchase order not found'
              : load.kind === 'forbidden'
                ? 'QA Manager access required'
                : 'Could not load the purchase order'}
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

  const { po } = load;

  return (
    <FormScreen onRefresh={refresh}>
      <Text style={ui.title}>{po.poNumber}</Text>

      {/* INS-055: the two-party edge, frozen at create. */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Parties (immutable after create)</Text>
        <MetaRow label="Client" value={po.clientCompany?.name ?? '—'} />
        <MetaRow label="Factory" value={po.factoryCompany?.name ?? '—'} />
        <MetaRow label="Product" value={po.product?.styleNumber ?? '—'} />
      </View>

      {formError ? <Text style={ui.errorText}>{formError}</Text> : null}

      <Field label="PO number *">
        <Input
          value={poNumber ?? ''}
          onChangeText={setPoNumber}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </Field>
      <Field label="Total quantity (pcs)">
        <Input
          value={quantityText}
          onChangeText={setQuantityText}
          placeholder="Optional"
          keyboardType="number-pad"
        />
      </Field>

      <Button
        label="Save changes"
        loadingLabel="Saving…"
        loading={pending}
        onPress={() => save(po)}
      />

      <View style={ui.dangerCard}>
        <Text style={ui.dangerTitle}>Delete purchase order</Text>
        <Text style={ui.hint}>
          Permanent. Refused with a clear message when inspections reference this PO.
        </Text>
        <Button
          variant="danger"
          label="Delete"
          disabled={pending}
          onPress={() => confirmDelete(po)}
        />
      </View>
    </FormScreen>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  metaLabel: { color: palette.sub, fontSize: 13 },
  metaValue: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
});
