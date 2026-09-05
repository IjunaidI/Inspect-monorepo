/** INS-091 — create a product from the picker that needs it. */
import type { CreateProductInput, ProductDto } from '@inspect/shared-types';
import { useState } from 'react';
import { Text } from 'react-native';

import { useToast } from '@/components/toast';
import { Button, Field, Input, ui } from '@/components/ui';
import { client } from '@/lib/session';
import { QuickCreateSheet, describeCreateError } from '../quick-create-sheet';

export function QuickCreateProductSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (product: ProductDto) => void;
}) {
  const toast = useToast();
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
      toast(`Product ${created.styleNumber} created`);
    } catch (e) {
      setError(describeCreateError(e, 'Could not create the product.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <QuickCreateSheet visible={visible} title="New product" onClose={onClose}>
      <Field label="Style number *">
        <Input
          value={styleNumber}
          onChangeText={setStyleNumber}
          placeholder="ST-2026-001"
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </Field>
      <Field label="Description">
        <Input
          style={{ minHeight: 72 }}
          value={description}
          onChangeText={setDescription}
          placeholder="Optional"
          multiline
        />
      </Field>
      {error ? <Text style={ui.errorText}>{error}</Text> : null}
      <Button
        label="Create product"
        loadingLabel="Creating…"
        loading={pending}
        disabled={!styleNumber.trim()}
        onPress={create}
      />
    </QuickCreateSheet>
  );
}
