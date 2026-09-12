/**
 * Profile tab (INS-096 M2): who is signed in, their role and workspace, the
 * team (Org Owner), the web console link, the API origin the build talks to,
 * and Sign out — the only place sign-out lives now.
 */
import { roles as roleBadges, type RoleKey } from '@inspect/design-tokens';
import { roleAtLeast } from '@inspect/domain';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Avatar, Icon, ListCard, ListRow, Screen } from '@/components/ui';
import { API_URL, WEB_URL } from '@/lib/config';
import { signOut } from '@/lib/session';
import { useSession } from '@/lib/session-context';
import { text, theme } from '@/theme';

const { colors, radius, space } = theme;

const ROLE_KEY: Record<string, RoleKey> = {
  INSPECTOR: 'inspector',
  QA_MANAGER: 'qa',
  ORG_OWNER: 'owner',
  PLATFORM_ADMIN: 'platform',
};

export default function Profile() {
  const router = useRouter();
  const { identity } = useSession();
  const roleKey = ROLE_KEY[identity?.role ?? ''] ?? 'inspector';
  const role = roleBadges[roleKey];
  const owner = roleAtLeast(identity?.role, 'ORG_OWNER');
  const apiHost = API_URL.replace(/^https?:\/\//, '');
  const webUrl = WEB_URL;

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.hero}>
        <Avatar name={identity?.name ?? identity?.email ?? 'Inspect'} id={identity?.userId ?? identity?.email} size={112} />
        <Text style={styles.name} numberOfLines={1}>
          {identity?.name ?? identity?.email ?? role.label}
        </Text>
        {identity?.name && identity.email ? (
          <Text style={styles.email} numberOfLines={1}>
            {identity.email}
          </Text>
        ) : null}
        <View style={styles.roleRow}>
          <View style={[styles.roleBadge, { backgroundColor: role.bg }]}>
            <Text style={[styles.roleLabel, { color: role.fg }]}>{role.label}</Text>
          </View>
          {identity?.orgName ? <Text style={styles.org}>· {identity.orgName}</Text> : null}
        </View>
      </View>

      <ListCard>
        {owner ? (
          <ListRow
            inset
            leading={<Icon name="team" size={20} color={colors.mutedForeground} />}
            title="Team"
            subtitle="Members, roles and invitations"
            chevron
            onPress={() => router.push('/users')}
          />
        ) : null}
        {webUrl ? (
          <ListRow
            inset
            leading={<Icon name="link" size={20} color={colors.mutedForeground} />}
            title="Open the web console"
            subtitle={webUrl.replace(/^https?:\/\//, '')}
            chevron
            onPress={() => void Linking.openURL(webUrl)}
          />
        ) : null}
        <ListRow
          inset
          leading={<Icon name="signOut" size={20} color={colors.destructiveStrong} />}
          title="Sign out"
          onPress={() => void signOut()}
        />
      </ListCard>

      <Text style={styles.footer}>
        API · <Text style={styles.mono}>{apiHost}</Text>
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space[3], paddingTop: space[6], paddingBottom: space[2] },
  name: { ...text('title'), textAlign: 'center' },
  email: { ...text('body', colors.mutedForeground), textAlign: 'center', marginTop: -8 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  roleBadge: { height: 22, paddingHorizontal: 8, borderRadius: radius.sm - 2, justifyContent: 'center' },
  roleLabel: { ...text('label'), fontSize: 10, lineHeight: 14 },
  org: { ...text('body', colors.mutedForeground) },
  footer: { ...text('caption', colors.faint), textAlign: 'center' },
  mono: { ...text('monoSmall', colors.mutedForeground) },
});
