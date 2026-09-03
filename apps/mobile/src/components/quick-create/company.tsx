/**
 * INS-091 — the phone's FIRST company create (the directory was read-only).
 * Only `name` is required by the API; branding + location are finished on
 * /companies/[id]. Same pending/error/append/auto-select pattern as the preset
 * builder's custom-defect row.
 */
import { palette } from '@inspect/design-tokens';
import type { CompanyDto, CompanyKind, CreateCompanyInput } from '@inspect/shared-types';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { client } from '@/lib/session';
import { QuickCreateSheet, describeCreateError, sheetStyles as s } from '../quick-create-sheet';

export function QuickCreateCompanySheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (company: CompanyDto) => void;
}) {
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
    } catch (e) {
      setError(describeCreateError(e, 'Could not create the company.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <QuickCreateSheet visible={visible} title="New company" onClose={onClose}>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Name *</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Northwind Apparel"
          placeholderTextColor={palette.faint}
          autoFocus
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={create}
        />
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Kind</Text>
        <View style={s.chipRow}>
          {(['THIRD_PARTY', 'INTERNAL'] as const).map((k) => (
            <Pressable
              key={k}
              style={[s.chip, kind === k && s.chipActive]}
              onPress={() => setKind(k)}
            >
              <Text style={[s.chipText, kind === k && s.chipTextActive]}>
                {k === 'THIRD_PARTY' ? 'Third-party' : 'Internal'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={s.hint}>Branding and location can be added later from the company screen.</Text>
      {error ? <Text style={s.errorText}>{error}</Text> : null}
      <Pressable
        style={[s.button, (pending || !name.trim()) && s.buttonDisabled]}
        onPress={create}
        disabled={pending || !name.trim()}
      >
        <Text style={s.buttonLabel}>{pending ? 'Creating…' : 'Create company'}</Text>
      </Pressable>
    </QuickCreateSheet>
  );
}
