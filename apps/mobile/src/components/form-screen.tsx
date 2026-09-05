/**
 * INS-091 — every form screen's shell. Before this, only /login avoided the
 * keyboard and no screen persisted taps, so the first tap on a button with the
 * keyboard up only dismissed the keyboard. One wrapper, one behaviour.
 *
 * INS-092 — `onRefresh` adds pull-to-refresh: the shell owns the spinner
 * state, the screen supplies the re-fetch.
 */
import { palette } from '@inspect/design-tokens';
import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function FormScreen({
  children,
  header,
  contentStyle,
  onRefresh,
}: {
  children: ReactNode;
  /** Rendered above the scrolling body, outside the keyboard-avoiding area. */
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pull-to-refresh handler. Resolve when the re-fetch has landed. */
  onRefresh?: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.body, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={palette.accent}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
});
