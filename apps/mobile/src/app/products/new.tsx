/**
 * Create product (INS-086 Phase 4) — port of the web `/products/new`. Role
 * floor QA_MANAGER. A duplicate style number now reads as the API's 409
 * ("already exists") rather than the raw 500 it leaked before this sweep.
 *
 * INS-092: the form is held behind a spinner until the role probe resolves
 * (it used to flash for a frame before the forbidden card replaced it), and a
 * successful create confirms with a toast.
 */
import { palette } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { CreateProductInput, ProductDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { useToast } from '@/components/toast';
import { Button, Field, Input, ui } from '@/components/ui';
import { describeCreateError } from '@/components/quick-create-sheet';
import { client, loadIdentity } from '@/lib/session';

export default function NewProduct() {
  const router = useRouter();
  const toast = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [styleNumber, setStyleNumber] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIdentity().then((identity) => setAllowed(roleAtLeast(identity?.role, 'QA_MANAGER')));
  }, []);

  async function create() {
    const trimmed = styleNumber.trim();
    if (!trimmed) {
      setError('Style number is required.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body: CreateProductInput = {
        styleNumber: trimmed,
        description: description.trim() || null,
      };
      const created = await client.post<ProductDto>('/products', body);
      toast(`Product ${created.styleNumber} created`);
      router.replace(`/products/${created.id}`);
    } catch (e) {
      setError(describeCreateError(e, 'Create failed'));
      setPending(false);
    }
  }

  // Hold the form until the probe answers — no flash of a form the API would refuse.
  if (allowed === null) {
    return (
      <SafeAreaView style={ui.screen}>
        <View style={ui.centered}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={ui.screen}>
        <View style={ui.centered}>
          <Text style={ui.errorTitle}>QA Manager access required</Text>
          <Text style={ui.mutedText}>Creating products needs QA Manager or above.</Text>
          <BackButton label="Go back" fallbackHref="/products" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <FormScreen>
      <BackButton label="Cancel" fallbackHref="/products" />
      <Text style={ui.title}>New product</Text>

      <Field label="Style number *">
        <Input
          value={styleNumber}
          onChangeText={setStyleNumber}
          placeholder="ST-2026-001"
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

      {error ? <Text style={ui.errorText}>{error}</Text> : null}

      <Button
        label="Create product"
        loadingLabel="Creating…"
        loading={pending}
        onPress={create}
      />
    </FormScreen>
  );
}
