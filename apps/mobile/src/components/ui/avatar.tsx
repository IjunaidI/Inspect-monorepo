/**
 * Initials avatar (INS-095). Colour from the shared `brandFallbacks` by a
 * stable hash of the id (never by row index), initials from `initialsFrom`.
 */
import { brandFallbacks } from '@inspect/design-tokens';
import { hashIndex, initialsFrom } from '@inspect/domain';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { font, theme } from '@/theme';

const { colors, radius } = theme;

export function Avatar({
  name,
  id,
  color,
  size = 40,
  style,
}: {
  /** Display name or email; initials derive from it. */
  name: string;
  /** Stable id for the fallback colour; defaults to `name`. */
  id?: string;
  /** Explicit colour (a company's `primaryColor`) wins over the fallback. */
  color?: string | null;
  size?: 28 | 32 | 40 | 56 | 112;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = color ?? brandFallbacks[hashIndex(id ?? name, brandFallbacks.length)];
  return (
    <View
      accessibilityLabel={name}
      style={[styles.avatar, { width: size, height: size, backgroundColor: bg }, style]}
    >
      <Text style={[styles.initials, { fontSize: Math.round(size / 2.8), lineHeight: Math.round(size / 2.2) }]}>
        {initialsFrom(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.primaryForeground, fontFamily: font('sans', 700) },
});
