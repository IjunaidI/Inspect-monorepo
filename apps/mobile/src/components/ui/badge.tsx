/**
 * Badges (INS-095): a small tinted label. `StatusChip` reads the shared
 * `statusTone` map so an inspection status is coloured the same on every
 * screen; `SeverityBadge` reads `severityByWire`. `onImage` paints over a
 * photo (scrim + white text).
 */
import { severity, severityByWire, statusTone, type Tone } from '@inspect/design-tokens';
import type { DefectSeverity } from '@inspect/shared-types';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { font, theme, tone as toneOf } from '@/theme';

const { colors, radius } = theme;

export function Badge({
  tone = 'neutral',
  children,
  size = 'md',
  dot = false,
  onImage = false,
  style,
}: {
  tone?: Tone;
  children: ReactNode;
  size?: 'sm' | 'md';
  dot?: boolean;
  onImage?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = toneOf(tone);
  const bg = onImage ? colors.scrim : t.bg;
  const fg = onImage ? colors.onImage : t.fg;
  return (
    <View
      style={[
        styles.badge,
        size === 'sm' && styles.badgeSm,
        { backgroundColor: bg },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: onImage ? colors.onImage : t.dot }]} /> : null}
      <Text style={[styles.label, size === 'sm' && styles.labelSm, { color: fg }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/** `IN_PROGRESS` → "In progress". Presentation only; the wire value stays uppercase. */
export function humanizeStatus(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StatusChip({
  status,
  size = 'md',
  style,
}: {
  status: string;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const tone: Tone = (statusTone as Record<string, Tone>)[status] ?? 'neutral';
  return (
    <Badge tone={tone} size={size} style={style}>
      {humanizeStatus(status)}
    </Badge>
  );
}

export function SeverityBadge({
  severity: wire,
  abbr = false,
  style,
}: {
  severity: DefectSeverity;
  abbr?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const s = severity[severityByWire[wire]];
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }, style]}>
      <View style={[styles.dot, { backgroundColor: s.dot }]} />
      <Text style={[styles.label, { color: s.fg }]}>{abbr ? s.abbr : s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: radius.sm - 2,
    alignSelf: 'flex-start',
  },
  badgeSm: { height: 18, paddingHorizontal: 6 },
  dot: { width: 6, height: 6, borderRadius: radius.full },
  label: { fontFamily: font('sans', 700), fontSize: 10, lineHeight: 14, letterSpacing: 0.2 },
  labelSm: { fontSize: 9, lineHeight: 12 },
});
