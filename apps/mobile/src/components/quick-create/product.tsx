/** INS-091 — create a product from the picker that needs it. */
import { palette } from '@inspect/design-tokens';
import type { CreateProductInput, ProductDto } from '@inspect/shared-types';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { client } from '@/lib/session';
import { QuickCreateSheet, describeCreateError, sheetStyles as s } from '../quick-create-sheet';

export function QuickCreateProductSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (product: ProductDto) => void;
}) {
  const [styleNumber, setStyleNumber] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setStyleNumber('');
      setDescription('');
      onCreated(created);
    } catch (e) {
      setError(describeCreateError(e, 'Could not create the product.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <QuickCreateSheet visible={visible} title="New product" onClose={onClose}>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Style number *</Text>
        <TextInput
          style={s.input}
          value={styleNumber}
          onChangeText={setStyleNumber}
          placeholder="ST-2026-001"
          placeholderTextColor={palette.faint}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Description</Text>
        <TextInput
          style={[s.input, { minHeight: 72 }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Optional"
          placeholderTextColor={palette.faint}
          multiline
        />
      </View>
      {error ? <Text style={s.errorText}>{error}</Text> : null}
      <Pressable
        style={[s.button, (pending || !styleNumber.trim()) && s.buttonDisabled]}
        onPress={create}
        disabled={pending || !styleNumber.trim()}
      >
        <Text style={s.buttonLabel}>{pending ? 'Creating…' : 'Create product'}</Text>
      </Pressable>
    </QuickCreateSheet>
  );
}
