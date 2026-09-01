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
 *   uses alert()); mutations are non-optimistic — write, then reload.
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
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { OptionPicker } from '@/components/option-picker';
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
    return { kind: 'error', message: e instanceof Error ? e.message : 'Load failed' };
  }
}

type InviteSuccess = { token: string; email: string; emailSent: boolean };

export default function Users() {
  const router = useRouter();
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

  async function changeRole(user: UserDto, role: UserRole) {
    if (role === user.role) return;
    setRowPending(user.id);
    setActionError(null);
    try {
      await client.patch(`/users/${user.id}/role`, { role });
      reload();
    } catch (e) {
      // The API's ceiling, INS-058 last-owner guard and self-check all land
      // here — surfaced inline, never an alert(), never optimistic.
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
      setInvited({ token: res.token, email, emailSent: res.emailSent ?? false });
      setInviteEmail('');
      reload();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setInvitePending(false);
    }
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
            {load.kind === 'forbidden' ? 'Org Owner access required' : 'Could not load users'}
          </Text>
          <Text style={styles.mutedText}>
            {load.kind === 'forbidden'
              ? 'User management is visible to Org Owners.'
              : load.kind === 'error'
                ? load.message
                : ''}
          </Text>
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

  const { users, me } = load;
  const q = filter.trim().toLowerCase();
  const visible = q
    ? users.filter(
        (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      )
    : users;
  const inviteLink = invited && WEB_URL ? `${WEB_URL}/invite?token=${invited.token}` : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent} />
        }
      >
        <Text style={styles.title}>Team</Text>
        <Text style={styles.subtitle}>
          {users.length} member{users.length === 1 ? '' : 's'}
        </Text>

        {/* Invite */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Invite a team member</Text>
          <TextInput
            style={styles.input}
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="teammate@org.example"
            placeholderTextColor={palette.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <View style={styles.chipRow}>
            {INVITABLE.map(({ role, label }) => (
              <Pressable
                key={role}
                onPress={() => setInviteRole(role)}
                style={[styles.roleChip, inviteRole === role && styles.roleChipActive]}
              >
                <Text
                  style={[styles.roleChipLabel, inviteRole === role && styles.roleChipLabelActive]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          {inviteError ? <Text style={styles.errorText}>{inviteError}</Text> : null}
          <Pressable
            style={[styles.button, invitePending && styles.buttonDisabled]}
            onPress={invite}
            disabled={invitePending}
          >
            <Text style={styles.buttonLabel}>{invitePending ? 'Sending…' : 'Invite'}</Text>
          </Pressable>

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
                <Text style={styles.hint}>
                  No console origin configured (EXPO_PUBLIC_INSPECT_WEB_URL) — copy the token and
                  append it to {'<console origin>/invite?token=…'}
                </Text>
              )}
              <Pressable
                onPress={() => {
                  void Clipboard.setStringAsync(inviteLink ?? invited.token).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
                hitSlop={8}
              >
                <Text style={styles.copyLink}>
                  {copied ? 'Copied ✓' : inviteLink ? 'Copy link' : 'Copy token'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* Roster */}
        <TextInput
          style={styles.input}
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter by name or email…"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
        {visible.length === 0 ? (
          <Text style={styles.empty}>
            {q ? 'No users match your search.' : 'No users yet.'}
          </Text>
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
                    {you ? <Text style={styles.youTag}>  (you)</Text> : null}
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
                    <View style={styles.rowActions}>
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
                      <Pressable
                        onPress={() => confirmToggleActive(u)}
                        disabled={pendingHere}
                        hitSlop={8}
                      >
                        <Text
                          style={
                            u.status === 'DEACTIVATED' ? styles.reactivateLink : styles.deactivateLink
                          }
                        >
                          {pendingHere
                            ? '…'
                            : u.status === 'DEACTIVATED'
                              ? 'Reactivate'
                              : 'Deactivate'}
                        </Text>
                      </Pressable>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  centerActions: { flexDirection: 'row', gap: 24, marginTop: 8 },
  errorTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  subtitle: { color: palette.sub, fontSize: 13 },
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
    backgroundColor: palette.panel,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: palette.ink,
    fontSize: 14,
  },
  chipRow: { flexDirection: 'row', gap: 8 },
  roleChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: palette.bg,
  },
  roleChipActive: { backgroundColor: palette.accentSoft, borderColor: palette.accent },
  roleChipLabel: { color: palette.sub, fontSize: 12.5, fontWeight: '600' },
  roleChipLabelActive: { color: palette.accent },
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
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  empty: { color: palette.faint, fontSize: 14, textAlign: 'center', paddingVertical: 24 },
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
  rowActions: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 6 },
  deactivateLink: { color: palette.danger, fontSize: 13, fontWeight: '600', paddingBottom: 12 },
  reactivateLink: { color: palette.accent, fontSize: 13, fontWeight: '600', paddingBottom: 12 },
  selfBadgeRow: { flexDirection: 'row', marginTop: 6 },
  roleBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  roleBadgeLabel: { fontSize: 11.5, fontWeight: '600' },
});
