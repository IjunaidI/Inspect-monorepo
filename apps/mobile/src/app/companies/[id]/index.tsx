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
 */
import { ApiError } from '@inspect/api-client';
import { brandFallbacks, palette, severity as severityTint } from '@inspect/design-tokens';
import { hashIndex, initialsFrom, roleAtLeast } from '@inspect/domain';
import type { CompanyDto, CompanyKind, LoopPresetDto, UpdateCompanyInput } from '@inspect/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { OptionPicker } from '@/components/option-picker';
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

/** Pure fetch — setState only ever happens in .then. */
async function fetchCompany(id: string): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    const [company, presets] = await Promise.all([
      client.get<CompanyDto>(`/companies/${id}`),
      // Presets failing must not sink the whole screen — null means "the
      // default-preset select is unavailable", shown as such, never silently.
      client.get<LoopPresetDto[]>('/loop-presets').catch(() => null),
    ]);
    return { kind: 'ready', company, presets };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return { kind: 'error', message: e instanceof Error ? e.message : 'Load failed' };
  }
}

export default function CompanyDetail() {
  const router = useRouter();
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
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

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

  const reload = useCallback(() => {
    fetchCompany(companyId).then(apply);
  }, [companyId, apply]);

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
    setSavedNote(false);
    try {
      await client.patch(`/companies/${company.id}`, body);
      setSavedNote(true);
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
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setPending(false);
    }
  }

  if (load.kind === 'loading' || (load.kind === 'ready' && name === null)) {
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
              ? 'Company not found'
              : load.kind === 'forbidden'
                ? 'QA Manager access required'
                : 'Could not load the company'}
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

  const { company, presets } = load;
  const fallbackColor = brandFallbacks[hashIndex(company.id, brandFallbacks.length)];
  const colorValid = color.trim() === '' || HEX_RE.test(color.trim());
  const presetOptions: PresetOption[] = [
    { id: null, label: 'None' },
    ...(presets ?? []).map((p) => ({ id: p.id, label: `${p.name} · v${p.version}` })),
  ];
  const selectedPreset =
    presetOptions.find((o) => o.id === presetId) ??
    (presetId ? { id: presetId, label: 'Current preset (not in list)' } : presetOptions[0]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        {/* Identity */}
        <View style={styles.headRow}>
          {!logoRemoved && company.logoViewUrl ? (
            <Image source={{ uri: company.logoViewUrl }} style={styles.avatar} />
          ) : (
            <View
              style={[styles.avatar, { backgroundColor: company.primaryColor || fallbackColor }]}
            >
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
              This company is archived. It is hidden from the active directory; history is
              preserved.
            </Text>
            <Pressable onPress={() => restore(company)} disabled={pending} hitSlop={8}>
              <Text style={styles.link}>{pending ? 'Restoring…' : 'Restore'}</Text>
            </Pressable>
          </View>
        ) : null}

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
        {savedNote ? <Text style={styles.savedText}>Saved.</Text> : null}

        {/* Identity fields */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name *</Text>
          <TextInput
            style={styles.input}
            value={name ?? ''}
            onChangeText={setName}
            placeholder="Company name"
            placeholderTextColor={palette.faint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Kind</Text>
          <View style={styles.chipRow}>
            {(['THIRD_PARTY', 'INTERNAL'] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => setKindV(k)}
                style={[styles.kindChip, kindV === k && styles.kindChipActive]}
              >
                <Text style={[styles.kindChipLabel, kindV === k && styles.kindChipLabelActive]}>
                  {k === 'INTERNAL' ? 'Internal' : 'Third-party'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Branding — used when this company is the CLIENT on an inspection. */}
        <Text style={styles.sectionLabel}>Branding (client role)</Text>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Brand colour (hex)</Text>
          <View style={styles.colorRow}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: colorValid && color.trim() ? color.trim() : palette.lineSoft },
              ]}
            />
            <TextInput
              style={[styles.input, { flex: 1 }, !colorValid && styles.inputInvalid]}
              value={color}
              onChangeText={setColor}
              placeholder="#1457A3"
              placeholderTextColor={palette.faint}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {!colorValid ? (
            <Text style={styles.hintDanger}>Use #RRGGBB — the API rejects other shapes.</Text>
          ) : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Logo</Text>
          {!logoRemoved && company.logoUrl ? (
            <View style={styles.logoRow}>
              <Text style={styles.hint} numberOfLines={1}>
                {company.logoUrl.split('/').pop()}
              </Text>
              <Pressable onPress={() => setLogoRemoved(true)} hitSlop={8}>
                <Text style={styles.removeLink}>Remove</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.hint}>
              {logoRemoved
                ? 'Logo will be removed on save.'
                : 'No logo. Uploading a new one is web-only for now.'}
            </Text>
          )}
        </View>
        <OptionPicker
          label="Default preset"
          value={selectedPreset}
          options={presetOptions}
          display={(o) => o.label}
          placeholder="None"
          onSelect={(o) => setPresetId(o.id)}
        />
        {presets === null ? (
          <Text style={styles.hintDanger}>
            Presets could not be loaded — the default-preset list may be incomplete.
          </Text>
        ) : null}

        {/* Location — used when this company is the FACTORY on an inspection. */}
        <Text style={styles.sectionLabel}>Location (factory role)</Text>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Address</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="Street, city, country"
            placeholderTextColor={palette.faint}
          />
        </View>
        <View style={styles.gpsRow}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Latitude</Text>
            <TextInput
              style={styles.input}
              value={lat}
              onChangeText={setLat}
              placeholder="23.81"
              placeholderTextColor={palette.faint}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Longitude</Text>
            <TextInput
              style={styles.input}
              value={lng}
              onChangeText={setLng}
              placeholder="90.41"
              placeholderTextColor={palette.faint}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        <Pressable
          style={[styles.button, pending && styles.buttonDisabled]}
          onPress={() => save(company)}
          disabled={pending}
        >
          <Text style={styles.buttonLabel}>{pending ? 'Saving…' : 'Save changes'}</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push(`/companies/${company.id}/guests`)}
          hitSlop={4}
        >
          <Text style={styles.link}>Manage guests →</Text>
        </Pressable>

        {!company.archivedAt ? (
          <View style={styles.dangerCard}>
            <Text style={styles.dangerTitle}>Archive company</Text>
            <Text style={styles.hint}>
              Removes this company from the active list. Historical purchase orders, inspections
              and reports are preserved.
            </Text>
            <Pressable
              onPress={() => confirmArchive(company)}
              disabled={pending}
              hitSlop={8}
              style={styles.dangerButton}
            >
              <Text style={styles.dangerButtonLabel}>Archive</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
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
  inputInvalid: { borderColor: palette.danger },
  chipRow: { flexDirection: 'row', gap: 8 },
  kindChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: palette.panel,
  },
  kindChipActive: { backgroundColor: palette.accentSoft, borderColor: palette.accent },
  kindChipLabel: { color: palette.sub, fontSize: 13, fontWeight: '600' },
  kindChipLabelActive: { color: palette.accent },
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
  hintDanger: { color: palette.danger, fontSize: 12 },
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  removeLink: { color: palette.danger, fontSize: 13, fontWeight: '600' },
  gpsRow: { flexDirection: 'row', gap: 10 },
  button: {
    marginTop: 4,
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
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
