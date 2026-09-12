/**
 * The four tabs (INS-095): Home · Inspections · Library · Profile. Library is
 * hidden (`href: null`) below QA_MANAGER — an inspector cannot read presets,
 * companies or reports, so the tab would only show forbidden cards.
 */
import { roleAtLeast } from '@inspect/domain';
import { Tabs } from 'expo-router';

import { TabBar } from '@/components/ui';
import { useSession } from '@/lib/session-context';
import { theme } from '@/theme';

export default function TabsLayout() {
  const { identity } = useSession();
  const qa = roleAtLeast(identity?.role, 'QA_MANAGER');
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="inspections" options={{ title: 'Inspections' }} />
      <Tabs.Screen name="library" options={{ title: 'Library', href: qa ? undefined : null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
