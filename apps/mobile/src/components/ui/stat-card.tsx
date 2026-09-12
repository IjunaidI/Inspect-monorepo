/**
 * Stat cards (INS-095): a coloured dot + bold muted label, a serif value, an
 * optional delta and hint. `Grid` lays them out two-up with the standard gap.
 */
import type { Tone } from '@inspect/design-tokens';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { text, theme, tone as toneOf } from '@/theme';

import { Card } from './card';

const { colors, radius } = theme;

export function StatCard({
  label,
  value,
  tone = 'primary',
  delta,
  deltaTone = 'success',
  hint,
  onPress,
  style,
}: {
  label: string;
  /** Pre-formatted — "92%", "1.8", "—". */
  value: string;
  tone?: Tone;
  delta?: string | null;
  deltaTone?: Tone;
  hint?: string | null;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card padded={false} onPress={onPress} style={[styles.card, style]}>
      <View style={styles.labelRow}>
        <View style={[styles.dot, { backgroundColor: toneOf(tone).dot }]} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.valueRow}>
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
        {delta ? <Text style={[styles.delta, { color: toneOf(deltaTone).fg }]}>{delta}</Text> : null}
      </View>
      {hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

/** Two-up grid with the standard 12pt gap; children wrap in rows. */
export function Grid({
  children,
  columns = 2,
  gap = 12,
  style,
}: {
  children: ReactNode;
  columns?: 2 | 3;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  // A `<>…</>` wrapper is one child to React; unwrap it so each card gets a cell.
  const items = Children.toArray(children)
    .flatMap((node) =>
      isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment
        ? Children.toArray(node.props.children)
        : [node],
    )
    .filter(Boolean);
  const basis = `${Math.floor((100 - (columns - 1) * 3) / columns)}%` as `${number}%`;
  return (
    <View style={[styles.grid, { gap }, style]}>
      {items.map((child, i) => (
        <View key={i} style={{ flexBasis: basis, flexGrow: 1, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 16, paddingVertical: 14, gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  label: { ...text('label', colors.mutedForeground), flex: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  value: { ...text('title') },
  delta: { ...text('caption'), fontFamily: text('label').fontFamily },
  hint: { ...text('caption', colors.faint) },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
