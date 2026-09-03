/**
 * INS-091 — every form screen's shell. Before this, only /login avoided the
 * keyboard and no screen persisted taps, so the first tap on a button with the
 * keyboard up only dismissed the keyboard. One wrapper, one behaviour.
 */
import { palette } from '@inspect/design-tokens';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function FormScreen({
  children,
  header,
  contentStyle,
}: {
  children: ReactNode;
  /** Rendered above the scrolling body, outside the keyboard-avoiding area. */
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
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
