/**
 * Surfaces (INS-095). `Card` = white, 1px hairline, radius xl, whisper shadow;
 * `tone="emphasis"` is the primary-tinted callout row; `tone="muted"` the
 * flat section fill. `ListCard` stacks rows with soft dividers (the settings
 * list of the reference). Android elevation only paints on an opaque card, so
 * only the `card` tone carries the shadow.
 */
import { Children, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { elevation, theme } from '@/theme';

const { colors, radius } = theme;

export type CardTone = 'card' | 'emphasis' | 'muted';

export function Card({
  children,
  padded = true,
  radius: r = 'xl',
  tone = 'card',
  onPress,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  /** `true` = 16, a number = that padding, `false` = none. */
  padded?: boolean | number;
  radius?: 'lg' | 'xl' | '2xl';
  tone?: CardTone;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const padding = padded === true ? 16 : padded === false ? 0 : padded;
  const surface: ViewStyle =
    tone === 'emphasis'
      ? { backgroundColor: colors.primaryFaint, borderColor: colors.primarySoft }
      : tone === 'muted'
        ? { backgroundColor: colors.muted, borderColor: colors.muted }
        : { backgroundColor: colors.card, borderColor: colors.border, ...elevation('sm') };
  const base = [styles.card, surface, { borderRadius: radius[r], padding }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

/** Rows separated by soft hairlines inside one rounded card. Children render in order. */
export function ListCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.listCard, style]}>
      {rows.map((row, i) => (
        <View key={i} style={i > 0 ? styles.divided : undefined}>
          {row}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  pressed: { opacity: 0.85 },
  listCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius['2xl'],
    overflow: 'hidden',
  },
  divided: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
});
