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
 *
 * INS-092: pull-to-refresh reloads the record without discarding typed edits;
 * saves confirm with a toast.
 */
import { ApiError } from '@inspect/api-client';
import { palette, severity as severityTint } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { ProductDto, UpdateProductInput } from '@inspect/shared-types';
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
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [styleNumber, setStyleNumber] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  /** Pull-to-refresh: update the record, keep whatever is being typed. */
  async function refresh() {
    const result = await fetchProduct(productId);
    if (result.kind === 'ready') setLoad(result);
    else toast('Could not refresh the product', { tone: 'danger' });
  }

  async function save(product: ProductDto) {
    const trimmed = (styleNumber ?? '').trim();
    if (!trimmed) {
      setFormError('Style number is required.');
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      // INS-074: the description field is always present on this form, so it
      // is always supplied — trimmed text, or explicit null to clear.
      const body: UpdateProductInput = {
        styleNumber: trimmed,
        description: description.trim() || null,
      };
      await client.patch(`/products/${product.id}`, body);
      toast('Product saved');
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
                toast(`${product.styleNumber} archived`, { tone: 'neutral' });
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
      toast('Product restored');
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setPending(false);
    }
  }

  if (load.kind === 'loading' || (load.kind === 'ready' && styleNumber === null)) {
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
              ? 'Product not found'
              : load.kind === 'forbidden'
                ? 'QA Manager access required'
                : 'Could not load the product'}
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

  const { product } = load;

  return (
    <FormScreen onRefresh={refresh}>
      <Text style={ui.title}>{product.styleNumber}</Text>
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
          <TextButton
            label={pending ? 'Restoring…' : 'Restore'}
            onPress={() => restore(product)}
            disabled={pending}
          />
        </View>
      ) : null}

      {formError ? <Text style={ui.errorText}>{formError}</Text> : null}

      <Field label="Style number *">
        <Input
          value={styleNumber ?? ''}
          onChangeText={setStyleNumber}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </Field>
      <Field label="Description">
        <Input
          style={{ minHeight: 110 }}
          value={description}
          onChangeText={setDescription}
          placeholder="Fabric, construction, colourway…"
          multiline
        />
      </Field>

      <Button
        label="Save changes"
        loadingLabel="Saving…"
        loading={pending}
        onPress={() => save(product)}
      />

      {!product.archivedAt ? (
        <View style={ui.dangerCard}>
          <Text style={ui.dangerTitle}>Archive product</Text>
          <Text style={ui.hint}>
            Removes it from the active list. Historical POs and inspections are preserved.
          </Text>
          <Button
            variant="danger"
            label="Archive"
            disabled={pending}
            onPress={() => confirmArchive(product)}
          />
        </View>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
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
});
