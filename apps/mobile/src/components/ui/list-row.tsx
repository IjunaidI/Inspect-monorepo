/**
 * The list row (INS-095): bold title, caption subtitle, an optional leading
 * tile and a trailing chip / metric / chevron. Standalone it is its own card;
 * `inset` renders bare for use inside a `ListCard`.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { text, theme } from '@/theme';

import { Card } from './card';
import { Icon } from './icon';

const { colors } = theme;

export function ListRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  chevron = false,
  onPress,
  inset = false,
  style,
}: {
  title: string;
  subtitle?: string | null;
  /** A third, fainter line (dates, ids). */
  meta?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const body = (
    <View style={[styles.row, inset && styles.inset]}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing || chevron ? (
        <View style={styles.trailing}>
          {trailing}
          {chevron ? <Icon name="chevronRight" size={18} color={colors.faint} /> : null}
        </View>
      ) : null}
    </View>
  );
  if (inset) {
    if (!onPress) return <View style={style}>{body}</View>;
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [style, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <Card padded={false} onPress={onPress} style={style}>
      {body}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  inset: { paddingHorizontal: 20 },
  leading: { flexShrink: 0 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...text('bodyStrong') },
  subtitle: { ...text('caption', colors.mutedForeground) },
  meta: { ...text('caption', colors.faint) },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  pressed: { opacity: 0.85 },
});
