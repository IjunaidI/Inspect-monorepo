/**
 * INS-091 — the bottom sheet that hosts a quick-create form. Same chrome as
 * the capture unit sheet (handle row, title, Cancel), plus keyboard avoidance
 * and persistent taps so the form is usable with the keyboard up.
 */
import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export function QuickCreateSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View style={styles.body}>
          <View style={styles.handleRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Network failures are not ApiErrors; say so in words, not a TypeError. */
export function describeCreateError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return 'No connection. Check the network and try again.';
  return e instanceof Error ? e.message : fallback;
}

/** Shared field styles for the three sheet forms. */
export const sheetStyles = StyleSheet.create({
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
    minHeight: 44,
  },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
    backgroundColor: palette.panel,
  },
  chipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  chipText: { color: palette.sub, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: palette.accent },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  errorText: { color: palette.danger, fontSize: 13 },
  button: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,18,32,0.45)',
    justifyContent: 'flex-end',
  },
  backdropTouch: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  body: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
    paddingTop: 16,
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
});
