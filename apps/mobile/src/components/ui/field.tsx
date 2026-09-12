/**
 * Form vocabulary (INS-095): `Field` (overline label + hint/error), `Input`
 * (44pt, input-tinted, focus ring), `Textarea`. One definition for every form
 * screen; the same props the pre-kit versions took.
 */
import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { MIN_TARGET, font, text, theme } from '@/theme';

import { Icon, type IconName } from './icon';

const { colors, radius } = theme;

export function Field({
  label,
  hint,
  error,
  children,
  style,
}: {
  label?: string;
  /** Guidance under the control. Hidden while `error` is set. */
  hint?: string | null;
  error?: string | null;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Input({
  invalid = false,
  leading,
  style,
  multiline,
  placeholderTextColor = colors.faint,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & { invalid?: boolean; leading?: IconName }) {
  const [focused, setFocused] = useState(false);
  const input = (
    <TextInput
      {...rest}
      multiline={multiline}
      placeholderTextColor={placeholderTextColor}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        styles.input,
        multiline && styles.multiline,
        leading ? styles.inputWithLeading : null,
        focused && styles.focused,
        invalid && styles.invalid,
        style,
      ]}
    />
  );
  if (!leading) return input;
  return (
    <View style={styles.leadingWrap}>
      <View style={styles.leadingIcon} pointerEvents="none">
        <Icon name={leading} size={20} color={colors.faint} />
      </View>
      {input}
    </View>
  );
}

export function Textarea(props: TextInputProps & { invalid?: boolean }) {
  return <Input {...props} multiline style={[styles.textarea, props.style]} />;
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { ...text('overline', colors.mutedForeground) },
  hint: { ...text('caption', colors.faint) },
  error: { ...text('caption', colors.destructiveStrong) },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.input,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.foreground,
    fontFamily: font('sans', 400),
    fontSize: 14,
    minHeight: MIN_TARGET,
  },
  inputWithLeading: { paddingLeft: 42 },
  multiline: { textAlignVertical: 'top' },
  textarea: { minHeight: 96 },
  focused: { borderColor: colors.ring, backgroundColor: colors.card },
  invalid: { borderColor: colors.destructive },
  leadingWrap: { position: 'relative' },
  leadingIcon: {
    position: 'absolute',
    left: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 1,
  },
});
