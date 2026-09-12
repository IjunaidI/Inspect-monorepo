/**
 * The signed-in stack (INS-095). `(tabs)` is the anchor, so a cold deep link
 * to `/inspections/:id/capture` mounts the tabs beneath it and native back
 * lands on Home rather than exiting; every other route here pushes
 * full-screen ABOVE the tab bar (capture, review, report, the builder, CRUD).
 */
import { Stack } from 'expo-router';

import { theme } from '@/theme';

export const unstable_settings = {
  anchor: '(tabs)',
  initialRouteName: '(tabs)',
};

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
