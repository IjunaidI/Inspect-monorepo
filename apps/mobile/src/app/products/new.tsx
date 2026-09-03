/**
 * Create product (INS-086 Phase 4) — port of the web `/products/new`. Role
 * floor QA_MANAGER. A duplicate style number now reads as the API's 409
 * ("already exists") rather than the raw 500 it leaked before this sweep.
 */
import { palette } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type { CreateProductInput, ProductDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { client, loadIdentity } from '@/lib/session';

export default function NewProduct() {
  const router = useRouter();
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
      router.replace(`/products/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
      setPending(false);
    }
  }

  if (allowed === false) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.forbiddenTitle}>QA Manager access required</Text>
          <Text style={styles.mutedText}>Creating products needs QA Manager or above.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <FormScreen>
      <BackButton label="Cancel" fallbackHref="/products" />
      <Text style={styles.title}>New product</Text>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Style number *</Text>
        <TextInput
          style={styles.input}
          value={styleNumber}
          onChangeText={setStyleNumber}
          placeholder="ST-2026-001"
          placeholderTextColor={palette.faint}
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

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        style={[styles.button, pending && styles.buttonDisabled]}
        onPress={create}
        disabled={pending}
      >
        <Text style={styles.buttonLabel}>{pending ? 'Creating…' : 'Create product'}</Text>
      </Pressable>
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
  forbiddenTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center' },
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
  multiline: { minHeight: 110, textAlignVertical: 'top' },
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
