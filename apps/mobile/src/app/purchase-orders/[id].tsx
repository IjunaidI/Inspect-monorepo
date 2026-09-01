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
 */
import { ApiError } from '@inspect/api-client';
import { palette, severity as severityTint } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { PurchaseOrderDto, UpdatePurchaseOrderInput } from '@inspect/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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
    return { kind: 'ready', po: await client.get<PurchaseOrderDto>(`/purchase-orders/${id}`) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return { kind: 'error', message: e instanceof Error ? e.message : 'Load failed' };
  }
}

export default function PurchaseOrderDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const poId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [poNumber, setPoNumber] = useState<string | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

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
    setSavedNote(false);
    try {
      const body: UpdatePurchaseOrderInput = {
        poNumber: trimmed,
        ...(quantity !== undefined ? { totalQuantity: quantity } : {}),
      };
      await client.patch(`/purchase-orders/${po.id}`, body);
      setSavedNote(true);
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
              ? 'Purchase order not found'
              : load.kind === 'forbidden'
                ? 'QA Manager access required'
                : 'Could not load the purchase order'}
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

  const { po } = load;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{po.poNumber}</Text>

        {/* INS-055: the two-party edge, frozen at create. */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Parties (immutable after create)</Text>
          <MetaRow label="Client" value={po.clientCompany?.name ?? '—'} />
          <MetaRow label="Factory" value={po.factoryCompany?.name ?? '—'} />
          <MetaRow label="Product" value={po.product?.styleNumber ?? '—'} />
        </View>

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
        {savedNote ? <Text style={styles.savedText}>Saved.</Text> : null}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>PO number *</Text>
          <TextInput
            style={styles.input}
            value={poNumber ?? ''}
            onChangeText={setPoNumber}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Total quantity (pcs)</Text>
          <TextInput
            style={styles.input}
            value={quantityText}
            onChangeText={setQuantityText}
            placeholder="Optional"
            placeholderTextColor={palette.faint}
            keyboardType="number-pad"
          />
        </View>

        <Pressable
          style={[styles.button, pending && styles.buttonDisabled]}
          onPress={() => save(po)}
          disabled={pending}
        >
          <Text style={styles.buttonLabel}>{pending ? 'Saving…' : 'Save changes'}</Text>
        </Pressable>

        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Delete purchase order</Text>
          <Text style={styles.hint}>
            Permanent. Refused with a clear message when inspections reference this PO.
          </Text>
          <Pressable
            onPress={() => confirmDelete(po)}
            disabled={pending}
            hitSlop={8}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonLabel}>Delete</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  screen: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  centerActions: { flexDirection: 'row', gap: 24, marginTop: 8 },
  errorTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center' },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
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
  metaValue: { color: palette.ink, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  errorText: { color: palette.danger, fontSize: 13 },
  savedText: { color: palette.accent, fontSize: 13, fontWeight: '600' },
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
  button: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
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
