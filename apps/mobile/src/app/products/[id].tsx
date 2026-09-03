/**
 * Product detail/edit (INS-086 Phase 4) — port of the web `/products/[id]`.
 * Role floor QA_MANAGER. Differences from the web page, each deliberate:
 * - 403 / 404 / network error are three states (the web collapses ALL
 *   failures into notFound()).
 * - An archived product shows a banner + Restore (the API's restore route
 *   is dead code on the console — no entry point calls it).
 * - Archive sits behind a native confirm (the web archives on a bare click
 *   with no undo affordance).
 * The INS-074 description contract is honoured: this form always supplies
 * the field, sending trimmed text or an explicit null — never undefined.
 */
import { ApiError } from '@inspect/api-client';
import { palette, severity as severityTint } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { ProductDto, UpdateProductInput } from '@inspect/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { client, loadIdentity } from '@/lib/session';

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; product: ProductDto };

/** Pure fetch — setState only ever happens in .then. */
async function fetchProduct(id: string): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    return {
      kind: 'ready',
      product: await client.get<ProductDto>(`/products/${id}`),
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

export default function ProductDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [styleNumber, setStyleNumber] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  const apply = useCallback((result: Load) => {
    setLoad(result);
    if (result.kind === 'ready') {
      setStyleNumber(result.product.styleNumber);
      setDescription(result.product.description ?? '');
    }
  }, []);

  useEffect(() => {
    fetchProduct(productId).then(apply);
  }, [productId, apply]);

  const reload = useCallback(() => {
    fetchProduct(productId).then(apply);
  }, [productId, apply]);

  async function save(product: ProductDto) {
    const trimmed = (styleNumber ?? '').trim();
    if (!trimmed) {
      setFormError('Style number is required.');
      return;
    }
    setPending(true);
    setFormError(null);
    setSavedNote(false);
    try {
      // INS-074: the description field is always present on this form, so it
      // is always supplied — trimmed text, or explicit null to clear.
      const body: UpdateProductInput = {
        styleNumber: trimmed,
        description: description.trim() || null,
      };
      await client.patch(`/products/${product.id}`, body);
      setSavedNote(true);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setPending(false);
    }
  }

  function confirmArchive(product: ProductDto) {
    Alert.alert(
      'Archive product?',
      `${product.styleNumber} will disappear from the active list. Historical POs and inspections are preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setPending(true);
              setFormError(null);
              try {
                await client.del(`/products/${product.id}`);
                router.back();
              } catch (e) {
                setFormError(e instanceof Error ? e.message : 'Archive failed');
              } finally {
                setPending(false);
              }
            })();
          },
        },
      ],
    );
  }

  async function restore(product: ProductDto) {
    setPending(true);
    setFormError(null);
    try {
      await client.post(`/products/${product.id}/restore`, {});
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setPending(false);
    }
  }

  if (load.kind === 'loading' || (load.kind === 'ready' && styleNumber === null)) {
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
              ? 'Product not found'
              : load.kind === 'forbidden'
                ? 'QA Manager access required'
                : 'Could not load the product'}
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

  const { product } = load;

  return (
    <FormScreen>
      <Text style={styles.title}>{product.styleNumber}</Text>
      {product._count ? (
        <Text style={styles.subtitle}>
          {product._count.purchaseOrders ?? 0} POs · {product._count.inspections ?? 0} inspections
        </Text>
      ) : null}

      {product.archivedAt ? (
        <View style={styles.archivedBanner}>
          <Text style={styles.archivedText}>
            This product is archived and hidden from the active list.
          </Text>
          <Pressable onPress={() => restore(product)} disabled={pending} hitSlop={8}>
            <Text style={styles.link}>{pending ? 'Restoring…' : 'Restore'}</Text>
          </Pressable>
        </View>
      ) : null}

      {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
      {savedNote ? <Text style={styles.savedText}>Saved.</Text> : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Style number *</Text>
        <TextInput
          style={styles.input}
          value={styleNumber ?? ''}
          onChangeText={setStyleNumber}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Fabric, construction, colourway…"
          placeholderTextColor={palette.faint}
          multiline
        />
      </View>

      <Pressable
        style={[styles.button, pending && styles.buttonDisabled]}
        onPress={() => save(product)}
        disabled={pending}
      >
        <Text style={styles.buttonLabel}>{pending ? 'Saving…' : 'Save changes'}</Text>
      </Pressable>

      {!product.archivedAt ? (
        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Archive product</Text>
          <Text style={styles.hint}>
            Removes it from the active list. Historical POs and inspections are preserved.
          </Text>
          <Pressable
            onPress={() => confirmArchive(product)}
            disabled={pending}
            hitSlop={8}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonLabel}>Archive</Text>
          </Pressable>
        </View>
      ) : null}
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
  subtitle: { color: palette.sub, fontSize: 13 },
  archivedBanner: {
    borderWidth: 1,
    borderColor: severityTint.major.fg,
    backgroundColor: severityTint.major.bg,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  archivedText: { color: severityTint.major.fg, fontSize: 13, lineHeight: 18 },
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
  multiline: { minHeight: 110, textAlignVertical: 'top' },
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
