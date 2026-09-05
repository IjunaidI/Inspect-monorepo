/**
 * Company guests (INS-086 Phase 4) — port of the web `/companies/[id]/guests`
 * behaviour contract. Guests attach to a company acting in its CLIENT role
 * only (spec §0 P7): report visibility keys on clientCompanyId AND orgId —
 * a security boundary enforced server-side, echoed in this screen's copy.
 *
 * Deliberately better than the web screen, per the contract's gap list:
 * - A role below QA_MANAGER gets an honest forbidden card (the web has no
 *   gate at all; its swallowed 403s render as "not found"/"no guests yet").
 * - A failed guest-list fetch is an error + retry, not a fake-empty list.
 * - A failed revoke surfaces its error (fixed on web in the same change).
 * - Revoke sits behind a native confirm.
 *
 * The magic link is `<console origin>/portal?token=…`. The web derives the
 * origin from window.location; a device has no such thing, so it comes from
 * EXPO_PUBLIC_INSPECT_WEB_URL — unset, the screen says so and offers the raw
 * token instead of composing a wrong link. The token is readable ONLY in the
 * invite response (write-once by design); re-inviting the same email rotates
 * it rather than erroring.
 *
 * INS-092: the guest-list Retry re-fetches only the guests; pull-to-refresh
 * on the whole screen; a sent invite confirms with a toast.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import type {
  CompanyDto,
  CompanyGuestDto,
  CompanyGuestInviteDto,
  InviteGuestInput,
} from '@inspect/shared-types';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
import { useToast } from '@/components/toast';
import { Button, Chip, Input, TextButton, ui } from '@/components/ui';
import { WEB_URL } from '@/lib/config';
import { client, loadIdentity } from '@/lib/session';

/** Same accept-green the review/report screens use; not a severity token. */
const PASS_GREEN = '#1F8A4C';
const TTL_OPTIONS = [7, 30, 90] as const;

// Pinned locale (the console's DATE_FMT convention) so both platforms print
// identical dates regardless of device locale.
const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Active', color: PASS_GREEN },
  SUSPENDED: { label: 'Revoked', color: palette.danger },
};

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; company: CompanyDto; guests: CompanyGuestDto[] | null };

type InviteSuccess = { token: string; emailSent: boolean; email: string };

const fetchGuestList = (companyId: string) =>
  client.get<CompanyGuestDto[]>(`/companies/${companyId}/guests`);

/** Pure fetch — setState only ever happens in .then. */
async function fetchGuests(companyId: string): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    const [company, guests] = await Promise.all([
      client.get<CompanyDto>(`/companies/${companyId}`),
      // A guest-list failure must not masquerade as "no guests yet" — null
      // renders as an inline error with its own retry.
      fetchGuestList(companyId).catch(() => null),
    ]);
    return { kind: 'ready', company, guests };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'missing' };
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Load failed',
    };
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <TextButton
      label={copied ? 'Copied ✓' : label}
      labelStyle={styles.copyLink}
      onPress={() => {
        void Clipboard.setStringAsync(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    />
  );
}

export default function CompanyGuests() {
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const companyId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [ttl, setTtl] = useState<number>(30);
  const [pending, setPending] = useState(false);
  const [guestsPending, setGuestsPending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<InviteSuccess | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchGuests(companyId).then(setLoad);
  }, [companyId]);
  useEffect(reload, [reload]);

  /** Pull-to-refresh: swap in fresh data, never flip a loaded screen to error. */
  async function refresh() {
    const result = await fetchGuests(companyId);
    if (result.kind === 'ready') setLoad(result);
    else toast('Could not refresh guests', { tone: 'danger' });
  }

  /** INS-092: re-fetch ONLY the guest list. */
  async function reloadGuests() {
    setGuestsPending(true);
    try {
      const guests = await fetchGuestList(companyId);
      setLoad((l) => (l.kind === 'ready' ? { ...l, guests } : l));
    } catch {
      toast('Guest list still unavailable', { tone: 'danger' });
    } finally {
      setGuestsPending(false);
    }
  }

  async function invite() {
    const trimmed = email.trim();
    if (!trimmed) {
      setInviteError('Email is required.');
      return;
    }
    setPending(true);
    setInviteError(null);
    try {
      const body: InviteGuestInput = { email: trimmed, ttlDays: ttl };
      const res = await client.post<CompanyGuestInviteDto>(`/companies/${companyId}/guests`, body);
      setInvited({
        token: res.token,
        emailSent: res.emailSent,
        email: trimmed,
      });
      setEmail('');
      toast(res.emailSent ? `Invitation emailed to ${trimmed}` : `${trimmed} invited — share the link`);
      void reloadGuests();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setPending(false);
    }
  }

  function confirmRevoke(guest: CompanyGuestDto) {
    Alert.alert(
      'Revoke guest access?',
      `${guest.email} will lose portal access immediately; their magic link stops working.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setRevokeError(null);
              try {
                await client.del(`/company-guests/${guest.id}`);
                toast(`${guest.email} revoked`, { tone: 'neutral' });
                void reloadGuests();
              } catch (e) {
                setRevokeError(e instanceof Error ? e.message : 'Revoke failed');
              }
            })();
          },
        },
      ],
    );
  }

  if (load.kind === 'loading') {
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
                : 'Could not load guests'}
          </Text>
          {load.kind === 'error' ? <Text style={ui.mutedText}>{load.message}</Text> : null}
          {load.kind === 'forbidden' ? (
            <Text style={ui.mutedText}>Guest management is visible to QA Managers and above.</Text>
          ) : null}
          <View style={ui.centerActions}>
            {load.kind === 'error' ? <TextButton label="Retry" onPress={reload} /> : null}
            <BackButton label="Go back" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const { company, guests } = load;
  const magicLink = invited && WEB_URL ? `${WEB_URL}/portal?token=${invited.token}` : null;

  return (
    <FormScreen onRefresh={refresh}>
      <Text style={ui.title}>Guests</Text>
      <Text style={styles.subtitle}>{company.name}</Text>
      <Text style={ui.hint}>
        Guests see signed reports where this company is the CLIENT. Reports naming it as the factory
        are never shown.
      </Text>

      {/* Invite */}
      <View style={ui.card}>
        <Text style={styles.sectionLabel}>Invite a guest</Text>
        <Input
          style={styles.inputOnPanel}
          value={email}
          onChangeText={setEmail}
          placeholder="guest@client.example"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <View style={ui.chipRow}>
          {TTL_OPTIONS.map((d) => (
            <Chip
              key={d}
              tone="bg"
              label={`${d} days`}
              active={ttl === d}
              onPress={() => setTtl(d)}
            />
          ))}
        </View>
        {inviteError ? <Text style={ui.errorText}>{inviteError}</Text> : null}
        <Button label="Invite" loadingLabel="Sending…" loading={pending} onPress={invite} />

        {invited ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>
              {invited.emailSent
                ? `Invitation emailed to ${invited.email}. The link below is a backup — it is shown only once.`
                : `The email to ${invited.email} could not be sent — share this link manually. It is shown only once.`}
            </Text>
            {magicLink ? (
              <>
                <Text style={styles.linkValue} numberOfLines={2}>
                  {magicLink}
                </Text>
                <CopyButton value={magicLink} label="Copy link" />
              </>
            ) : (
              <>
                <Text style={ui.hint}>
                  No console origin configured (EXPO_PUBLIC_INSPECT_WEB_URL), so the full portal
                  link cannot be composed here. Copy the token and append it to
                  {' <console origin>/portal?token=…'}
                </Text>
                <CopyButton value={invited.token} label="Copy token" />
              </>
            )}
          </View>
        ) : null}
      </View>

      {/* Guest list */}
      <View style={ui.card}>
        <Text style={styles.sectionLabel}>
          {guests ? `${guests.length} guest${guests.length === 1 ? '' : 's'}` : 'Guests'}
        </Text>
        {revokeError ? <Text style={ui.errorText}>{revokeError}</Text> : null}
        {guests === null ? (
          <View style={styles.inlineError}>
            <Text style={ui.errorText}>The guest list could not be loaded.</Text>
            <TextButton
              label={guestsPending ? 'Retrying…' : 'Retry'}
              onPress={reloadGuests}
              disabled={guestsPending}
            />
          </View>
        ) : guests.length === 0 ? (
          <Text style={ui.hint}>No guests yet. Invite someone above.</Text>
        ) : (
          guests.map((g) => {
            const ss = STATUS_STYLE[g.status] ?? {
              label: g.status,
              color: palette.sub,
            };
            const expired = new Date(g.tokenExpiresAt) < new Date();
            return (
              <View key={g.id} style={styles.guestRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.guestEmail} numberOfLines={1}>
                    {g.email}
                  </Text>
                  <Text style={styles.guestMeta}>
                    <Text style={{ color: ss.color, fontWeight: '600' }}>{ss.label}</Text>
                    {expired && g.status === 'ACTIVE' ? (
                      <Text style={{ color: palette.danger }}> · Expired</Text>
                    ) : null}
                    {'  ·  expires '}
                    {DATE_FMT.format(new Date(g.tokenExpiresAt))}
                  </Text>
                  <Text style={styles.guestMeta}>
                    last access {g.lastAccessAt ? DATE_FMT.format(new Date(g.lastAccessAt)) : '—'}
                    {'  ·  invited '}
                    {DATE_FMT.format(new Date(g.createdAt))}
                  </Text>
                </View>
                {g.status === 'ACTIVE' ? (
                  <TextButton label="Revoke" tone="danger" onPress={() => confirmRevoke(g)} />
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  subtitle: { color: palette.sub, fontSize: 14 },
  sectionLabel: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  /** Inputs inside a panel card sit on the canvas colour for contrast. */
  inputOnPanel: { backgroundColor: palette.bg },
  successBox: {
    borderWidth: 1,
    borderColor: PASS_GREEN,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  successText: { color: palette.ink, fontSize: 13, lineHeight: 18 },
  linkValue: { color: palette.sub, fontSize: 12 },
  copyLink: { fontSize: 13 },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  guestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: palette.lineSoft,
    paddingTop: 10,
  },
  guestEmail: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  guestMeta: { color: palette.faint, fontSize: 12 },
});
