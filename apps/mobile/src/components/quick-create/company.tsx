/**
 * INS-091 — the phone's FIRST company create (the directory was read-only).
 * Only `name` is required by the API; branding + location are finished on
 * /companies/[id]. Same pending/error/append/auto-select pattern as the preset
 * builder's custom-defect row.
 */
import type { CompanyDto, CompanyKind, CreateCompanyInput } from '@inspect/shared-types';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useToast } from '@/components/toast';
import { Button, Chip, Field, Input, ui } from '@/components/ui';
import { client } from '@/lib/session';
import { QuickCreateSheet, describeCreateError } from '../quick-create-sheet';

export function QuickCreateCompanySheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (company: CompanyDto) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CompanyKind>('THIRD_PARTY');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body: CreateCompanyInput = { name: trimmed, kind };
      const created = await client.post<CompanyDto>('/companies', body);
      setName('');
      onCreated(created);
      toast(`Company “${created.name}” created`);
    } catch (e) {
      setError(describeCreateError(e, 'Could not create the company.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <QuickCreateSheet visible={visible} title="New company" onClose={onClose}>
      <Field label="Name *">
        <Input
          value={name}
          onChangeText={setName}
          placeholder="e.g. Northwind Apparel"
          autoFocus
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={create}
        />
      </Field>
      <Field label="Kind">
        <View style={ui.chipRow}>
          {(['THIRD_PARTY', 'INTERNAL'] as const).map((k) => (
            <Chip
              key={k}
              label={k === 'THIRD_PARTY' ? 'Third-party' : 'Internal'}
              active={kind === k}
              onPress={() => setKind(k)}
            />
          ))}
        </View>
      </Field>
      <Text style={ui.hint}>Branding and location can be added later from the company screen.</Text>
      {error ? <Text style={ui.errorText}>{error}</Text> : null}
      <Button
        label="Create company"
        loadingLabel="Creating…"
        loading={pending}
        disabled={!name.trim()}
        onPress={create}
      />
    </QuickCreateSheet>
  );
}
