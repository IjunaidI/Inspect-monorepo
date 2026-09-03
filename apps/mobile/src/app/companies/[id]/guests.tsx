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
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { FormScreen } from '@/components/form-screen';
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

/** Pure fetch — setState only ever happens in .then. */
async function fetchGuests(companyId: string): Promise<Load> {
  const identity = await loadIdentity();
  if (!roleAtLeast(identity?.role, 'QA_MANAGER')) return { kind: 'forbidden' };
  try {
    const [company, guests] = await Promise.all([
      client.get<CompanyDto>(`/companies/${companyId}`),
      // A guest-list failure must not masquerade as "no guests yet" — null
      // renders as an inline error with its own retry.
      client.get<CompanyGuestDto[]>(`/companies/${companyId}/guests`).catch(() => null),
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
    <Pressable
      onPress={() => {
        void Clipboard.setStringAsync(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      hitSlop={8}
    >
      <Text style={styles.copyLink}>{copied ? 'Copied ✓' : label}</Text>
    </Pressable>
  );
}

export default function CompanyGuests() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const companyId = String(id);

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [ttl, setTtl] = useState<number>(30);
  const [pending, setPending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<InviteSuccess | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchGuests(companyId).then(setLoad);
  }, [companyId]);
  useEffect(reload, [reload]);

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
      reload();
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
                reload();
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
                : 'Could not load guests'}
          </Text>
          {load.kind === 'error' ? <Text style={styles.mutedText}>{load.message}</Text> : null}
          {load.kind === 'forbidden' ? (
            <Text style={styles.mutedText}>
              Guest management is visible to QA Managers and above.
            </Text>
          ) : null}
          <View style={styles.centerActions}>
            {load.kind === 'error' ? (
              <Pressable onPress={reload} hitSlop={8}>
                <Text style={styles.link}>Retry</Text>
              </Pressable>
            ) : null}
            <BackButton label="Go back" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const { company, guests } = load;
  const magicLink = invited && WEB_URL ? `${WEB_URL}/portal?token=${invited.token}` : null;

  return (
    <FormScreen>
      <Text style={styles.title}>Guests</Text>
      <Text style={styles.subtitle}>{company.name}</Text>
      <Text style={styles.hint}>
        Guests see signed reports where this company is the CLIENT. Reports naming it as the factory
        are never shown.
      </Text>

      {/* Invite */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Invite a guest</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="guest@client.example"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <View style={styles.chipRow}>
          {TTL_OPTIONS.map((d) => (
            <Pressable
              key={d}
              onPress={() => setTtl(d)}
              style={[styles.ttlChip, ttl === d && styles.ttlChipActive]}
            >
              <Text style={[styles.ttlChipLabel, ttl === d && styles.ttlChipLabelActive]}>
                {d} days
              </Text>
            </Pressable>
          ))}
        </View>
        {inviteError ? <Text style={styles.errorText}>{inviteError}</Text> : null}
        <Pressable
          style={[styles.button, pending && styles.buttonDisabled]}
          onPress={invite}
          disabled={pending}
        >
          <Text style={styles.buttonLabel}>{pending ? 'Sending…' : 'Invite'}</Text>
        </Pressable>

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
                <Text style={styles.hint}>
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
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>
          {guests ? `${guests.length} guest${guests.length === 1 ? '' : 's'}` : 'Guests'}
        </Text>
        {revokeError ? <Text style={styles.errorText}>{revokeError}</Text> : null}
        {guests === null ? (
          <View style={styles.inlineError}>
            <Text style={styles.errorText}>The guest list could not be loaded.</Text>
            <Pressable onPress={reload} hitSlop={8}>
              <Text style={styles.link}>Retry</Text>
            </Pressable>
          </View>
        ) : guests.length === 0 ? (
          <Text style={styles.hint}>No guests yet. Invite someone above.</Text>
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
                  <Pressable onPress={() => confirmRevoke(g)} hitSlop={8}>
                    <Text style={styles.revokeLink}>Revoke</Text>
                  </Pressable>
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
  screen: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  centerActions: { flexDirection: 'row', gap: 24, marginTop: 8 },
  errorTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  mutedText: {
    color: palette.sub,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  subtitle: { color: palette.sub, fontSize: 14 },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  card: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  sectionLabel: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    backgroundColor: palette.bg,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: palette.ink,
    fontSize: 14,
  },
  chipRow: { flexDirection: 'row', gap: 8 },
  ttlChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: palette.bg,
  },
  ttlChipActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent,
  },
  ttlChipLabel: { color: palette.sub, fontSize: 12.5, fontWeight: '600' },
  ttlChipLabelActive: { color: palette.accent },
  errorText: { color: palette.danger, fontSize: 13 },
  button: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 11,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  successBox: {
    borderWidth: 1,
    borderColor: PASS_GREEN,
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  successText: { color: palette.ink, fontSize: 13, lineHeight: 18 },
  linkValue: { color: palette.sub, fontSize: 12 },
  copyLink: { color: palette.accent, fontSize: 13, fontWeight: '600' },
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
  revokeLink: { color: palette.danger, fontSize: 13, fontWeight: '600' },
});
