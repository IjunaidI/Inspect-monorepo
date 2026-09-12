/**
 * The bottom sheet (INS-095): scrim, card surface with a grabber and rounded
 * top corners, a serif title row with one text action, a scrolling body that
 * survives the keyboard, and its own `ToastViewport` so a toast raised inside
 * the Modal shows above it. `variant="dialog"` centres a small card;
 * `variant="full"` fills the screen. Modal-based on purpose — it keeps the
 * INS-093 flows exactly as verified; a gesture sheet is a later polish.
 */
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
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { elevation, text, theme } from '@/theme';

import { TextButton, type TextButtonTone } from './button';
import { ToastViewport } from '../toast';

const { colors, radius, space } = theme;

export type SheetVariant = 'sheet' | 'dialog' | 'full';

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  closeLabel = 'Cancel',
  action,
  children,
  footer,
  variant = 'sheet',
  keyboard = true,
  scroll = true,
  toastViewport = true,
  contentStyle,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string | null;
  onClose: () => void;
  closeLabel?: string;
  /** Right-hand text action; replaces the close control when set. */
  action?: { label: string; onPress: () => void; disabled?: boolean; tone?: TextButtonTone };
  children: ReactNode;
  footer?: ReactNode;
  variant?: SheetVariant;
  keyboard?: boolean;
  scroll?: boolean;
  toastViewport?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const bodyStyle: ViewStyle =
    variant === 'dialog'
      ? styles.dialog
      : variant === 'full'
        ? { ...styles.full, paddingTop: insets.top }
        : { ...styles.sheet, maxHeight: '88%' };

  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingBottom: footer ? space[4] : insets.bottom + space[6] }, contentStyle]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.contentStatic, contentStyle]}>{children}</View>
  );

  const inner = (
    <>
      <Pressable style={styles.backdropTouch} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.body, bodyStyle]}>
        {variant === 'sheet' ? (
          <View style={styles.grabberRow}>
            <View style={styles.grabber} />
          </View>
        ) : null}
        {title || action ? (
          <View style={styles.titleRow}>
            <View style={styles.titles}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            {action ? (
              <TextButton label={action.label} onPress={action.onPress} disabled={action.disabled} tone={action.tone} />
            ) : (
              <TextButton label={closeLabel} onPress={onClose} tone="muted" />
            )}
          </View>
        ) : null}
        {content}
        {footer ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + space[4] }]}>{footer}</View>
        ) : null}
      </View>
    </>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={variant === 'dialog' ? 'fade' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {keyboard ? (
        <KeyboardAvoidingView
          style={[styles.backdrop, variant === 'dialog' && styles.backdropCenter]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {inner}
        </KeyboardAvoidingView>
      ) : (
        <View style={[styles.backdrop, variant === 'dialog' && styles.backdropCenter]}>{inner}</View>
      )}
      {toastViewport ? <ToastViewport /> : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  backdropCenter: { justifyContent: 'center', padding: space[6] },
  backdropTouch: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  body: { backgroundColor: colors.card, ...elevation('lg') },
  sheet: { borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'] },
  dialog: { borderRadius: radius.xl, alignSelf: 'stretch', maxHeight: '85%' },
  full: { flex: 1 },
  grabberRow: { alignItems: 'center', paddingTop: space[2], paddingBottom: space[1] },
  grabber: { width: 40, height: 4, borderRadius: radius.full, backgroundColor: colors.border },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    paddingHorizontal: space[6],
    paddingTop: space[2],
    paddingBottom: space[2],
  },
  titles: { flex: 1, minWidth: 0 },
  title: { ...text('heading') },
  subtitle: { ...text('caption', colors.mutedForeground), marginTop: 2 },
  content: { paddingHorizontal: space[6], paddingTop: space[2], gap: space[4] },
  contentStatic: { flex: 1, paddingHorizontal: space[6], paddingTop: space[2], gap: space[4] },
  footer: {
    paddingHorizontal: space[6],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.card,
  },
});
