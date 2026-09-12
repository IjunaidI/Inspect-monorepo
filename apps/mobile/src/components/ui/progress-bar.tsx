/** An 8pt progress bar (INS-095): input-tinted track, tone-coloured fill. */
import type { Tone } from '@inspect/design-tokens';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme, tone as toneOf } from '@/theme';

const { colors, radius } = theme;

export function ProgressBar({
  value,
  tone = 'primary',
  height = 8,
  trackColor,
  style,
}: {
  /** 0..1, clamped. */
  value: number;
  tone?: Tone;
  height?: number;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={[styles.track, { height, backgroundColor: trackColor ?? colors.input }, style]}
    >
      <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: toneOf(tone).dot }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.full },
});
