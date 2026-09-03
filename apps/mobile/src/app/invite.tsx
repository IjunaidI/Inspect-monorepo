/**
 * Invitation acceptance (INS-086 Phase 4) — port of the web `/invite`. The
 * one deliberately PUBLIC screen: no session, the token is the credential.
 *
 * The token arrives as a deep-link query param (`…/invite?token=…`); until
 * links are wired on-device, a paste field stands in when none is present.
 * Only API-verified lookup data (email/role/org) is ever rendered — nothing
 * from the link but the opaque token itself (INS-054 anti-spoofing rule).
 *
 * Deliberate improvements over the web screen, from the contract's gap list:
 * - Success chains straight into sign-in with the just-set credentials
 *   (the web bounces to a bare login form — extra friction on a phone).
 * - Accept failures get curated copy keyed on status where possible, not
 *   the raw backend string; lookup 404 and 410 stay distinct states.
 * - "Invite expires on X" is surfaced (fetched-but-dropped on web).
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import type { AcceptInvitationInput, InvitationLookupDto } from '@inspect/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormScreen } from '@/components/form-screen';
import { client, signIn } from '@/lib/session';

const ROLE_LABEL: Record<string, string> = {
  INSPECTOR: 'Inspector',
  QA_MANAGER: 'QA Manager',
  ORG_OWNER: 'Org Owner',
};

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type Load =
  | { kind: 'no-token' }
  | { kind: 'loading' }
  | { kind: 'invalid' } // 404 — unknown token
  | { kind: 'gone' } // 410 — consumed or expired
  | { kind: 'error'; message: string }
  | { kind: 'ready'; invite: InvitationLookupDto; token: string };

/** Pure fetch — setState only ever happens in .then. */
async function lookupInvite(token: string): Promise<Load> {
  try {
    const invite = await client.getPublic<InvitationLookupDto>(
      `/invitations/${encodeURIComponent(token)}`,
    );
    return { kind: 'ready', invite, token };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'invalid' };
    if (e instanceof ApiError && e.status === 410) return { kind: 'gone' };
    return {
      kind: 'error',
      message: 'Could not verify the invitation. Check the connection and retry.',
    };
  }
}

export default function Invite() {
  const router = useRouter();
  const { token: linkToken } = useLocalSearchParams<{ token?: string }>();

  const [load, setLoad] = useState<Load>(linkToken ? { kind: 'loading' } : { kind: 'no-token' });
  const [pastedToken, setPastedToken] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    if (linkToken) lookupInvite(String(linkToken)).then(setLoad);
  }, [linkToken]);

  const lookupPasted = useCallback(() => {
    const t = pastedToken.trim();
    if (!t) return;
    setLoad({ kind: 'loading' });
    lookupInvite(t).then(setLoad);
  }, [pastedToken]);

  async function accept(invite: InvitationLookupDto, token: string) {
    if (password.length < 8) {
      setAcceptError('Password must be at least 8 characters.');
      return;
    }
    setPending(true);
    setAcceptError(null);
    try {
      const body: AcceptInvitationInput = {
        token,
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
      };
      await client.postPublic('/invitations/accept', body);
    } catch (e) {
      // Accept-time reuse/expiry comes back as a 400 (the lookup's 410
      // sibling) — curate rather than echoing the backend string.
      setAcceptError(
        e instanceof ApiError && e.status === 400
          ? e.message.toLowerCase().includes('password')
            ? e.message
            : 'This invitation is no longer valid. Ask for a fresh invite.'
          : 'Could not activate the account. Check the connection and retry.',
      );
      setPending(false);
      return;
    }
    // Chain straight into sign-in with the credentials just set. If that
    // fails for any reason, the account still exists — land on login.
    try {
      await signIn(invite.email, password);
      router.replace('/inspections');
    } catch {
      router.replace('/login');
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
        <ScrollView contentContainerStyle={styles.centeredScroll}>
          <Text style={styles.title}>
            {load.kind === 'no-token'
              ? 'Accept an invitation'
              : load.kind === 'invalid'
                ? 'Invitation not found'
                : load.kind === 'gone'
                  ? 'Invitation no longer valid'
                  : 'Could not verify the invitation'}
          </Text>
          <Text style={styles.mutedText}>
            {load.kind === 'no-token'
              ? 'Paste the invitation token from your email.'
              : load.kind === 'invalid'
                ? 'The link may be mistyped. Ask the sender to check it.'
                : load.kind === 'gone'
                  ? 'It was already used or has expired. Ask for a fresh invite.'
                  : load.kind === 'error'
                    ? load.message
                    : ''}
          </Text>
          {load.kind === 'no-token' || load.kind === 'error' ? (
            <View style={styles.tokenBox}>
              <TextInput
                style={styles.input}
                value={pastedToken}
                onChangeText={setPastedToken}
                placeholder="Invitation token"
                placeholderTextColor={palette.faint}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                style={[styles.button, !pastedToken.trim() && styles.buttonDisabled]}
                onPress={lookupPasted}
                disabled={!pastedToken.trim()}
              >
                <Text style={styles.buttonLabel}>Look up invitation</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
            <Text style={styles.link}>Go to sign in</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const { invite, token } = load;
  const roleLabel = ROLE_LABEL[invite.role] ?? invite.role;

  return (
    <FormScreen>
      <Text style={styles.title}>Join {invite.orgName ?? 'an Inspect workspace'}</Text>
      <Text style={styles.mutedText}>
        {invite.email} · {roleLabel}
        {invite.expiresAt ? ` · invite expires ${DATE_FMT.format(new Date(invite.expiresAt))}` : ''}
      </Text>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Your name (optional)</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Full name"
          placeholderTextColor={palette.faint}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Choose a password (min 8 characters)</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={palette.faint}
          secureTextEntry
          autoCapitalize="none"
        />
      </View>

      {acceptError ? <Text style={styles.errorText}>{acceptError}</Text> : null}

      <Pressable
        style={[styles.button, (pending || password.length < 8) && styles.buttonDisabled]}
        onPress={() => accept(invite, token)}
        disabled={pending || password.length < 8}
      >
        <Text style={styles.buttonLabel}>
          {pending ? 'Activating account…' : 'Activate account'}
        </Text>
      </Pressable>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  body: { padding: 20, gap: 14, paddingBottom: 40 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  centeredScroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  title: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  mutedText: {
    color: palette.sub,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  link: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  tokenBox: { alignSelf: 'stretch', gap: 10, marginTop: 8 },
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
  errorText: { color: palette.danger, fontSize: 13 },
  button: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
