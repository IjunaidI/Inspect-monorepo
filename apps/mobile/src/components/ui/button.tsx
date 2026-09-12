/**
 * Buttons (INS-095). `primary` = forest green fill; `secondary` (and the legacy
 * alias `ghost`) = bordered card; `destructive` (legacy alias `danger`) = soft
 * red tint. Every variant meets the 44pt floor and shows a spinner while
 * loading. `TextButton` is the inline text action ("Retry", "View all").
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { MIN_TARGET, font, text, theme } from '@/theme';

import { Icon, type IconName } from './icon';

const { colors, radius } = theme;

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const SIZE = {
  sm: { height: 40, paddingHorizontal: 14, fontSize: 13, icon: 18 as const },
  md: { height: 48, paddingHorizontal: 20, fontSize: 14, icon: 20 as const },
  lg: { height: 52, paddingHorizontal: 24, fontSize: 15, icon: 22 as const },
};

function paint(variant: ButtonVariant): { bg: string; fg: string; border?: string } {
  switch (variant) {
    case 'primary':
      return { bg: colors.primary, fg: colors.primaryForeground };
    case 'destructive':
    case 'danger':
      return { bg: colors.destructiveSoft, fg: colors.destructiveStrong, border: colors.destructiveSoft };
    case 'secondary':
    case 'ghost':
    default:
      return { bg: colors.card, fg: colors.foreground, border: colors.border };
  }
}

export function Button({
  label,
  loadingLabel,
  loading = false,
  disabled = false,
  variant = 'primary',
  size = 'md',
  icon,
  fullWidth = false,
  onPress,
  style,
  labelStyle,
  hitSlop,
  accessibilityLabel,
}: {
  label: string;
  /** Shown while `loading` (e.g. "Saving…"); defaults to `label`. */
  loadingLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon; replaced by the spinner while loading. */
  icon?: IconName;
  fullWidth?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  hitSlop?: PressableProps['hitSlop'];
  accessibilityLabel?: string;
}) {
  const inert = disabled || loading;
  const p = paint(variant);
  const s = SIZE[size];
  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: p.bg,
          minHeight: Math.max(s.height, MIN_TARGET),
          paddingHorizontal: s.paddingHorizontal,
          borderWidth: p.border ? 1 : 0,
          borderColor: p.border,
        },
        fullWidth && styles.fullWidth,
        inert && styles.disabled,
        pressed && !inert && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={p.fg} />
      ) : icon ? (
        <Icon name={icon} size={s.icon} color={p.fg} />
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color: p.fg, fontSize: s.fontSize, fontFamily: font('sans', 700) },
          labelStyle,
        ]}
      >
        {loading ? (loadingLabel ?? label) : label}
      </Text>
    </Pressable>
  );
}

export type TextButtonTone = 'primary' | 'destructive' | 'muted' | 'accent' | 'danger';

function textTone(t: TextButtonTone): string {
  switch (t) {
    case 'destructive':
    case 'danger':
      return colors.destructiveStrong;
    case 'muted':
      return colors.mutedForeground;
    case 'primary':
    case 'accent':
    default:
      return colors.primary;
  }
}

/**
 * An inline text action. The Text alone is ~18pt tall; this wraps it in a 44pt
 * hit area without changing how the row lays out.
 */
export function TextButton({
  label,
  onPress,
  tone = 'primary',
  icon,
  trailingIcon,
  disabled = false,
  size = 'md',
  style,
  labelStyle,
}: {
  label: string;
  onPress: () => void;
  tone?: TextButtonTone;
  icon?: IconName;
  trailingIcon?: IconName;
  disabled?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}) {
  const color = textTone(tone);
  const fontSize = size === 'sm' ? 12 : 14;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.textButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={color} /> : null}
      <Text style={[text('button', color), { fontSize }, labelStyle]}>{label}</Text>
      {trailingIcon ? <Icon name={trailingIcon} size={size === 'sm' ? 16 : 18} color={color} /> : null}
    </Pressable>
  );
}

/** A horizontal row of buttons with the standard gap. */
export function ButtonRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.lg,
  },
  fullWidth: { alignSelf: 'stretch' },
  label: { lineHeight: 18 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  textButton: {
    minHeight: MIN_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
});
