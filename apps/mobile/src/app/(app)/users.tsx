/**
 * Org users (INS-086 Phase 4) — port of the web `/users` behaviour contract.
 * UI floor ORG_OWNER (the web redirects below it; here an honest forbidden
 * card) — the API's own floors stay the authority: list is QA_MANAGER
 * (INS-065), every mutation ORG_OWNER, with the additive ceiling, the
 * INS-058 last-active-owner guard and the self-protection rules all
 * server-side.
 *
 * Deliberate differences from the web screen, from the contract's gap list:
 * - Role-change / deactivate / reactivate errors render inline (the web
 *   uses alert()). INS-092: a role change is OPTIMISTIC — the row shows the
 *   new role at once and rolls back (with the error inline) if the API
 *   refuses; deactivate/reactivate stay write-then-reload.
 * - Avatar colours key on hashIndex(user.id), not the row index that made
 *   web colours change when filtering reordered rows.
 * - The invite link is composed from EXPO_PUBLIC_INSPECT_WEB_URL (no
 *   window.location on a device), with the raw-token fallback when unset.
 * - Direct add-member (email+password, no invite) stays web-only for now;
 *   invite is the mobile path. Recorded in the ledger.
 * - One client-side roster filter replaces the web's typing-vs-Enter split.
 */
import { ApiError } from '@inspect/api-client';
import { brandFallbacks, palette, roles as roleTokens } from '@inspect/design-tokens';
import { hashIndex, initialsFrom, roleAtLeast } from '@inspect/domain';
import type { InvitationDto, InviteUserInput, UserDto, UserRole } from '@inspect/shared-types';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back-button';
import { OptionPicker } from '@/components/option-picker';
import { useToast } from '@/components/toast';
import { Button, Chip, Input, TextButton, ui } from '@/components/ui';
import { WEB_URL } from '@/lib/config';
import { client, loadIdentity, signOut, type Identity } from '@/lib/session';

/** Same accept-green the other screens use; not a severity token. */
const PASS_GREEN = '#1F8A4C';

const INVITABLE: { role: UserRole; label: string }[] = [
  { role: 'INSPECTOR', label: 'Inspector' },
  { role: 'QA_MANAGER', label: 'QA Manager' },
  { role: 'ORG_OWNER', label: 'Org Owner' },
];

const ROLE_BADGE: Record<string, { label: string; fg: string; bg: string }> = {
  INSPECTOR: roleTokens.inspector,
  QA_MANAGER: roleTokens.qa,
  ORG_OWNER: roleTokens.owner,
  PLATFORM_ADMIN: roleTokens.platform,
};

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Active', color: PASS_GREEN },
  INVITED: { label: 'Invited', color: palette.accent },
  SUSPENDED: { label: 'Suspended', color: palette.danger },
  DEACTIVATED: { label: 'Deactivated', color: palette.faint },
};

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type Load =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; users: UserDto[]; me: Identity | null };

/** Pure fetch — setState only ever happens in .then. */
async function fetchUsers(): Promise<Load> {
  const me = await loadIdentity();
  if (!roleAtLeast(me?.role, 'ORG_OWNER')) return { kind: 'forbidden' };
  try {
    return { kind: 'ready', users: await client.get<UserDto[]>('/users'), me };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { kind: 'unauthorized' };
    if (e instanceof ApiError && e.status === 403) return { kind: 'forbidden' };
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Load failed',
    };
  }
}

type InviteSuccess = { token: string; email: string; emailSent: boolean };

export default function Users() {
  const router = useRouter();
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [filter, setFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rowPending, setRowPending] = useState<string | null>(null);
  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('INSPECTOR');
  const [invitePending, setInvitePending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<InviteSuccess | null>(null);
  const [copied, setCopied] = useState(false);

  const apply = useCallback(
    async (result: Load) => {
      if (result.kind === 'unauthorized') {
        await signOut();
        router.replace('/login');
        return;
      }
      setLoad(result);
    },
    [router],
  );

  useEffect(() => {
    fetchUsers().then(apply);
  }, [apply]);

  const reload = useCallback(() => {
    fetchUsers().then(apply);
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await apply(await fetchUsers());
    setRefreshing(false);
  }, [apply]);

  /** Patch one roster row in place (optimistic update + its rollback). */
  function patchUser(id: string, patch: Partial<UserDto>) {
    setLoad((l) =>
      l.kind === 'ready'
        ? { ...l, users: l.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) }
        : l,
    );
  }

  async function changeRole(user: UserDto, role: UserRole) {
    if (role === user.role) return;
    const previous = user.role;
    // Optimistic: the row shows the new role immediately.
    patchUser(user.id, { role });
    setRowPending(user.id);
    setActionError(null);
    try {
      await client.patch(`/users/${user.id}/role`, { role });
      toast(`${user.name || user.email} is now ${ROLE_BADGE[role]?.label ?? role}`);
      reload();
    } catch (e) {
      // The API's ceiling, INS-058 last-owner guard and self-check all land
      // here — roll the row back and surface the reason inline, never alert().
      patchUser(user.id, { role: previous });
      setActionError(e instanceof Error ? e.message : 'Role change failed');
    } finally {
      setRowPending(null);
    }
  }

  function confirmToggleActive(user: UserDto) {
    const deactivating = user.status !== 'DEACTIVATED';
    Alert.alert(
      deactivating ? 'Deactivate user?' : 'Reactivate user?',
      deactivating
        ? `${user.email} will no longer be able to sign in. Reversible.`
        : `${user.email} will be able to sign in again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: deactivating ? 'Deactivate' : 'Reactivate',
          style: deactivating ? 'destructive' : 'default',
          onPress: () => {
            void (async () => {
              setRowPending(user.id);
              setActionError(null);
              try {
                if (deactivating) await client.del(`/users/${user.id}`);
                else await client.patch(`/users/${user.id}/reactivate`, {});
                toast(`${user.email} ${deactivating ? 'deactivated' : 'reactivated'}`, {
                  tone: 'neutral',
                });
                reload();
              } catch (e) {
                setActionError(e instanceof Error ? e.message : 'Update failed');
              } finally {
                setRowPending(null);
              }
            })();
          },
        },
      ],
    );
  }

  async function invite() {
    const email = inviteEmail.trim();
    if (!email) {
      setInviteError('Email is required.');
      return;
    }
    setInvitePending(true);
    setInviteError(null);
    try {
      const body: InviteUserInput = { email, role: inviteRole };
      const res = await client.post<InvitationDto>('/users/invite', body);
      setInvited({
        token: res.token,
        email,
        emailSent: res.emailSent ?? false,
      });
      setInviteEmail('');
      toast(res.emailSent ? `Invitation emailed to ${email}` : `${email} invited — share the link`);
      reload();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setInvitePending(false);
    }
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
            {load.kind === 'forbidden' ? 'Org Owner access required' : 'Could not load users'}
          </Text>
          <Text style={ui.mutedText}>
            {load.kind === 'forbidden'
              ? 'User management is visible to Org Owners.'
              : load.kind === 'error'
                ? load.message
                : ''}
          </Text>
          <View style={ui.centerActions}>
            {load.kind === 'error' ? <TextButton label="Retry" onPress={reload} /> : null}
            <BackButton label="Go back" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const { users, me } = load;
  const q = filter.trim().toLowerCase();
  const visible = q
    ? users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    : users;
  const inviteLink = invited && WEB_URL ? `${WEB_URL}/invite?token=${invited.token}` : null;

  return (
    <SafeAreaView style={ui.screen}>
      {/* INS-091: keyboard-safe like FormScreen; kept inline for the RefreshControl. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={palette.accent}
            />
          }
        >
          <BackButton fallbackHref="/library" />
          <Text style={ui.title}>Team</Text>
          <Text style={styles.subtitle}>
            {users.length} member{users.length === 1 ? '' : 's'}
          </Text>

          {/* Invite */}
          <View style={ui.card}>
            <Text style={styles.sectionLabel}>Invite a team member</Text>
            <Input
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="teammate@org.example"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <View style={ui.chipRow}>
              {INVITABLE.map(({ role, label }) => (
                <Chip
                  key={role}
                  tone="bg"
                  label={label}
                  active={inviteRole === role}
                  onPress={() => setInviteRole(role)}
                />
              ))}
            </View>
            {inviteError ? <Text style={ui.errorText}>{inviteError}</Text> : null}
            <Button
              label="Invite"
              loadingLabel="Sending…"
              loading={invitePending}
              onPress={invite}
            />

            {invited ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>
                  {invited.emailSent
                    ? `Invitation emailed to ${invited.email}. The link below is a backup.`
                    : `The email to ${invited.email} could not be sent — share this link manually.`}
                </Text>
                {inviteLink ? (
                  <Text style={styles.linkValue} numberOfLines={2}>
                    {inviteLink}
                  </Text>
                ) : (
                  <Text style={ui.hint}>
                    No console origin configured (EXPO_PUBLIC_INSPECT_WEB_URL) — copy the token and
                    append it to {'<console origin>/invite?token=…'}
                  </Text>
                )}
                <TextButton
                  label={copied ? 'Copied ✓' : inviteLink ? 'Copy link' : 'Copy token'}
                  labelStyle={styles.copyLink}
                  onPress={() => {
                    void Clipboard.setStringAsync(inviteLink ?? invited.token).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                />
              </View>
            ) : null}
          </View>

          {/* Roster */}
          <Input
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter by name or email…"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {actionError ? <Text style={ui.errorText}>{actionError}</Text> : null}
          {visible.length === 0 ? (
            <Text style={styles.empty}>{q ? 'No users match your search.' : 'No users yet.'}</Text>
          ) : (
            visible.map((u) => {
              const you = u.id === me?.userId;
              const badge = ROLE_BADGE[u.role] ?? roleTokens.inspector;
              const status = STATUS_STYLE[u.status] ?? STATUS_STYLE.DEACTIVATED;
              const color = brandFallbacks[hashIndex(u.id, brandFallbacks.length)];
              const pendingHere = rowPending === u.id;
              return (
                <View key={u.id} style={styles.userRow}>
                  <View style={[styles.avatar, { backgroundColor: color }]}>
                    <Text style={styles.avatarInitials}>{initialsFrom(u.name || u.email)}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.userName} numberOfLines={1}>
                      {u.name || u.email}
                      {you ? <Text style={styles.youTag}> (you)</Text> : null}
                    </Text>
                    <Text style={styles.userMeta} numberOfLines={1}>
                      {u.email}
                    </Text>
                    <Text style={styles.userMeta}>
                      <Text style={{ color: status.color, fontWeight: '600' }}>{status.label}</Text>
                      {'  ·  last active '}
                      {u.lastLoginAt ? DATE_FMT.format(new Date(u.lastLoginAt)) : '—'}
                    </Text>
                    {/* Self-protection mirrors the API: no role change, no
                      deactivate on your own row. */}
                    {!you ? (
                      <View style={[styles.rowActions, pendingHere && styles.rowBusy]}>
                        <View style={{ flex: 1 }}>
                          <OptionPicker
                            label=""
                            value={INVITABLE.find((r) => r.role === u.role) ?? null}
                            options={INVITABLE}
                            display={(r) => r.label}
                            placeholder={ROLE_BADGE[u.role]?.label ?? u.role}
                            onSelect={(r) => void changeRole(u, r.role)}
                          />
                        </View>
                        {/* INS-092: a 44pt-tall target, centred on the 44pt picker. */}
                        <TextButton
                          label={
                            pendingHere ? '…' : u.status === 'DEACTIVATED' ? 'Reactivate' : 'Deactivate'
                          }
                          tone={u.status === 'DEACTIVATED' ? 'accent' : 'danger'}
                          labelStyle={styles.rowActionLabel}
                          disabled={pendingHere}
                          onPress={() => confirmToggleActive(u)}
                        />
                      </View>
                    ) : (
                      <View style={styles.selfBadgeRow}>
                        <View style={[styles.roleBadge, { backgroundColor: badge.bg }]}>
                          <Text style={[styles.roleBadgeLabel, { color: badge.fg }]}>
                            {badge.label}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  subtitle: { color: palette.sub, fontSize: 13 },
  sectionLabel: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
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
  empty: {
    color: palette.faint,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  userRow: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { color: palette.panel, fontSize: 14, fontWeight: '700' },
  userName: { color: palette.ink, fontSize: 15, fontWeight: '600' },
  youTag: { color: palette.faint, fontSize: 12, fontWeight: '400' },
  userMeta: { color: palette.faint, fontSize: 12 },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginTop: 6,
  },
  rowBusy: { opacity: 0.6 },
  rowActionLabel: { fontSize: 13 },
  selfBadgeRow: { flexDirection: 'row', marginTop: 6 },
  roleBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  roleBadgeLabel: { fontSize: 11.5, fontWeight: '600' },
});
