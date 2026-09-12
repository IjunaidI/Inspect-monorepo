/**
 * Root layout (INS-095). Holds the splash until the nine font faces AND the
 * SecureStore session have resolved — one gate, so there is neither a font
 * flash nor a login flash — then mounts the Stack with `Protected` groups:
 * `(app)` (the tabs and every pushed flow) when signed in, `login` when not,
 * `invite` always (the token IS the credential). `signIn()` / `signOut()`
 * anywhere flip the guard through the session context.
 */
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ToastProvider } from '@/components/toast';
import { SessionProvider, useSessionBoot } from '@/lib/session-context';
import { theme } from '@/theme';
import { FONT_SOURCES } from '@/theme/fonts';

// `setOptions` (fade duration) is a development-build feature; Expo Go warns
// on it, so the splash simply hides when `ready` flips.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_SOURCES);
  const session = useSessionBoot();
  const ready = (fontsLoaded || fontError !== null) && session.state !== 'loading';

  useEffect(() => {
    if (fontError) console.warn('[fonts] falling back to system fonts:', fontError.message);
  }, [fontError]);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  const signedIn = session.state === 'in';
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider value={session}>
        <ToastProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background },
            }}
          >
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="login" />
            </Stack.Protected>
            <Stack.Screen name="invite" />
          </Stack>
        </ToastProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
