/**
 * Company detail/edit (INS-086 Phase 4) — port of the web `/companies/[id]`
 * behaviour contract. Role floor QA_MANAGER (API class-level; this screen
 * gates client-side too, and tells 403 and 404 apart where the web collapses
 * both into notFound()).
 *
 * Deliberate differences from the web screen, from the contract's gap list:
 * - An ARCHIVED company shows a banner + Restore action (the web form gives
 *   no indication at all and silently allows edits; restore was only
 *   reachable from the dashboard table).
 * - A failed archive surfaces its error (the web discarded the server
 *   action's {error} — fixed on web in the same change).
 * - Logo v1 is display + remove only; PICKING a new logo needs
 *   expo-image-picker and is deferred (recorded in the ledger). The tri-state
 *   logoUrl write semantics are honoured: untouched → field omitted,
 *   removed → explicit null.
 *
 * INS-092: pull-to-refresh reloads the record without discarding typed edits;
 * a failed preset list has its own Retry (only the presets are re-fetched);
 * saves confirm with a toast.
 */
import { ApiError } from '@inspect/api-client';
import { brandFallbacks, palette, severity as severityTint } from '@inspect/design-tokens';
import { hashIndex, initialsFrom, roleAtLeast } from '@inspect/domain';
import type {
  CompanyDto,
  CompanyKind,
  LoopPresetDto,
  UpdateCompanyInput,
} from '@inspect/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { OptionPicker } from '@/components/option-picker';
import { useToast } from '@/components/toast';
import { Button, Chip, Field, Input, TextButton, ui } from '@/components/ui';
import { client, loadIdentity } from '@/lib/session';

/** The one shape the API accepts for primaryColor (INS-077) — a live hint only. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type PresetOption = { id: string | null; label: string };

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; company: CompanyDto; presets: LoopPresetDto[] | null };

const fetchPresets = () => client.get<LoopPresetDto[]>('/loop-presets');

/** Pure fetch — setState only ever happens in .then. */
async function fetchCompany(id: string): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    const [company, presets] = await Promise.all([
      client.get<CompanyDto>(`/companies/${id}`),
      // Presets failing must not sink the whole screen — null means "the
      // default-preset select is unavailable", shown as such with its own Retry.
      fetchPresets().catch(() => null),
    ]);
    return { kind: 'ready', company, presets };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Load failed',
    };
  }
}

export default function CompanyDetail() {
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const companyId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // Form state, seeded from the fetched row (null until seeded).
  const [name, setName] = useState<string | null>(null);
  const [kindV, setKindV] = useState<CompanyKind>('THIRD_PARTY');
  const [color, setColor] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [presetId, setPresetId] = useState<string | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [pending, setPending] = useState(false);
  const [presetsPending, setPresetsPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const seed = useCallback((c: CompanyDto) => {
    setName(c.name);
    setKindV(c.kind);
    setColor(c.primaryColor ?? '');
    setAddress(c.address ?? '');
    setLat(c.gps?.lat != null ? String(c.gps.lat) : '');
    setLng(c.gps?.lng != null ? String(c.gps.lng) : '');
    setPresetId(c.defaultLoopPresetId ?? null);
    setLogoRemoved(false);
  }, []);

  const apply = useCallback(
    async (result: Load) => {
      setLoad(result);
      if (result.kind === 'ready') seed(result.company);
    },
    [seed],
  );

  useEffect(() => {
    fetchCompany(companyId).then(apply);
  }, [companyId, apply]);

  /** Full reload: re-fetch and re-seed the form (after a save or restore). */
  const reload = useCallback(() => {
    fetchCompany(companyId).then(apply);
  }, [companyId, apply]);

  /** Pull-to-refresh: update the record, keep whatever is being typed. */
  async function refresh() {
    const result = await fetchCompany(companyId);
    if (result.kind === 'ready') setLoad(result);
    else toast('Could not refresh the company', { tone: 'danger' });
  }

  /** INS-092: retry ONLY the preset list, never the whole screen. */
  async function retryPresets() {
    setPresetsPending(true);
    try {
      const presets = await fetchPresets();
      setLoad((l) => (l.kind === 'ready' ? { ...l, presets } : l));
    } catch {
      toast('Presets still unavailable', { tone: 'danger' });
    } finally {
      setPresetsPending(false);
    }
  }

  async function save(company: CompanyDto) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
      setFormError('Name is required.');
      return;
    }
    // The half-a-pair case is the ONE GPS shape the API cannot tell from a
    // deliberate clear, so it is caught client-side (mirrors the web rule).
    const latBlank = lat.trim() === '';
    const lngBlank = lng.trim() === '';
    if (latBlank !== lngBlank) {
      setFormError('GPS needs both latitude and longitude, or neither.');
      return;
    }
    const body: UpdateCompanyInput = {
      name: trimmed,
      kind: kindV,
      primaryColor: color.trim() || null,
      address: address.trim() || null,
      gps: latBlank ? null : { lat: Number(lat), lng: Number(lng) },
      defaultLoopPresetId: presetId,
      // Tri-state: omit = leave unchanged; explicit null = remove.
      ...(logoRemoved ? { logoUrl: null } : {}),
    };
    setPending(true);
    setFormError(null);
    try {
      await client.patch(`/companies/${company.id}`, body);
      toast('Company saved');
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setPending(false);
    }
  }

  function confirmArchive(company: CompanyDto) {
    Alert.alert(
      'Archive company?',
      'Archiving removes this company from the active list. Historical purchase orders, inspections and reports are preserved.',
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
                await client.del(`/companies/${company.id}`);
                toast(`${company.name} archived`, { tone: 'neutral' });
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

  async function restore(company: CompanyDto) {
    setPending(true);
    setFormError(null);
    try {
      await client.post(`/companies/${company.id}/restore`, {});
      toast('Company restored');
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setPending(false);
    }
  }

  if (load.kind === 'loading' || (load.kind === 'ready' && name === null)) {
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
              ? 'Company not found'
              : load.kind === 'forbidden'
                ? 'QA Manager access required'
                : 'Could not load the company'}
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

  const { company, presets } = load;
  const fallbackColor = brandFallbacks[hashIndex(company.id, brandFallbacks.length)];
  const colorValid = color.trim() === '' || HEX_RE.test(color.trim());
  const presetOptions: PresetOption[] = [
    { id: null, label: 'None' },
    ...(presets ?? []).map((p) => ({
      id: p.id,
      label: `${p.name} · v${p.version}`,
    })),
  ];
  const selectedPreset =
    presetOptions.find((o) => o.id === presetId) ??
    (presetId ? { id: presetId, label: 'Current preset (not in list)' } : presetOptions[0]);

  return (
    <FormScreen onRefresh={refresh}>
      {/* Identity */}
      <View style={styles.headRow}>
        {!logoRemoved && company.logoViewUrl ? (
          <Image source={{ uri: company.logoViewUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: company.primaryColor || fallbackColor }]}>
            <Text style={styles.avatarInitials}>{initialsFrom(company.name)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {company.name}
          </Text>
          <Text style={styles.subtitle}>
            {company.kind === 'INTERNAL' ? 'Internal' : 'Third-party'}
          </Text>
        </View>
      </View>

      {company.archivedAt ? (
        <View style={styles.archivedBanner}>
          <Text style={styles.archivedText}>
            This company is archived. It is hidden from the active directory; history is preserved.
          </Text>
          <TextButton
            label={pending ? 'Restoring…' : 'Restore'}
            onPress={() => restore(company)}
            disabled={pending}
          />
        </View>
      ) : null}

      {formError ? <Text style={ui.errorText}>{formError}</Text> : null}

      {/* Identity fields */}
      <Field label="Name *">
        <Input value={name ?? ''} onChangeText={setName} placeholder="Company name" />
      </Field>
      <Field label="Kind">
        <View style={ui.chipRow}>
          {(['THIRD_PARTY', 'INTERNAL'] as const).map((k) => (
            <Chip
              key={k}
              label={k === 'INTERNAL' ? 'Internal' : 'Third-party'}
              active={kindV === k}
              onPress={() => setKindV(k)}
            />
          ))}
        </View>
      </Field>

      {/* Branding — used when this company is the CLIENT on an inspection. */}
      <Text style={styles.sectionLabel}>Branding (client role)</Text>
      <Field
        label="Brand colour (hex)"
        error={colorValid ? null : 'Use #RRGGBB — the API rejects other shapes.'}
      >
        <View style={styles.colorRow}>
          <View
            style={[
              styles.swatch,
              {
                backgroundColor: colorValid && color.trim() ? color.trim() : palette.lineSoft,
              },
            ]}
          />
          <Input
            style={{ flex: 1 }}
            invalid={!colorValid}
            value={color}
            onChangeText={setColor}
            placeholder="#1457A3"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </Field>
      <Field label="Logo">
        {!logoRemoved && company.logoUrl ? (
          <View style={styles.logoRow}>
            <Text style={styles.hint} numberOfLines={1}>
              {company.logoUrl.split('/').pop()}
            </Text>
            <TextButton label="Remove" tone="danger" onPress={() => setLogoRemoved(true)} />
          </View>
        ) : (
          <Text style={ui.hint}>
            {logoRemoved
              ? 'Logo will be removed on save.'
              : 'No logo. Uploading a new one is web-only for now.'}
          </Text>
        )}
      </Field>
      <OptionPicker
        label="Default preset"
        value={selectedPreset}
        options={presetOptions}
        display={(o) => o.label}
        placeholder="None"
        onSelect={(o) => setPresetId(o.id)}
      />
      {presets === null ? (
        <View style={styles.inlineError}>
          <Text style={[ui.errorText, { flexShrink: 1 }]}>
            Presets could not be loaded — the default-preset list may be incomplete.
          </Text>
          <TextButton
            label={presetsPending ? 'Retrying…' : 'Retry'}
            onPress={retryPresets}
            disabled={presetsPending}
          />
        </View>
      ) : null}

      {/* Location — used when this company is the FACTORY on an inspection. */}
      <Text style={styles.sectionLabel}>Location (factory role)</Text>
      <Field label="Address">
        <Input value={address} onChangeText={setAddress} placeholder="Street, city, country" />
      </Field>
      <View style={styles.gpsRow}>
        <Field label="Latitude" style={{ flex: 1 }}>
          <Input
            value={lat}
            onChangeText={setLat}
            placeholder="23.81"
            keyboardType="numbers-and-punctuation"
          />
        </Field>
        <Field label="Longitude" style={{ flex: 1 }}>
          <Input
            value={lng}
            onChangeText={setLng}
            placeholder="90.41"
            keyboardType="numbers-and-punctuation"
          />
        </Field>
      </View>

      <Button
        label="Save changes"
        loadingLabel="Saving…"
        loading={pending}
        onPress={() => save(company)}
        style={{ marginTop: 4 }}
      />

      <TextButton
        label="Manage guests →"
        onPress={() => router.push(`/companies/${company.id}/guests`)}
      />

      {!company.archivedAt ? (
        <View style={ui.dangerCard}>
          <Text style={ui.dangerTitle}>Archive company</Text>
          <Text style={ui.hint}>
            Removes this company from the active list. Historical purchase orders, inspections and
            reports are preserved.
          </Text>
          <Button
            variant="danger"
            label="Archive"
            disabled={pending}
            onPress={() => confirmArchive(company)}
          />
        </View>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.lineSoft,
  },
  avatarInitials: { color: palette.panel, fontSize: 15, fontWeight: '700' },
  title: { color: palette.ink, fontSize: 19, fontWeight: '700' },
  subtitle: { color: palette.sub, fontSize: 13, marginTop: 1 },
  archivedBanner: {
    borderWidth: 1,
    borderColor: severityTint.major.fg,
    backgroundColor: severityTint.major.bg,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  archivedText: { color: severityTint.major.fg, fontSize: 13, lineHeight: 18 },
  sectionLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
  },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  gpsRow: { flexDirection: 'row', gap: 10 },
});
