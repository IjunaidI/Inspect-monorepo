/**
 * A tinted square (or circle) holding one icon (INS-095) — the 48px tile of
 * the reference's quick actions and notification rows, the 40px one of list
 * rows. The icon is painted in the tone's pure hue.
 */
import type { Tone } from '@inspect/design-tokens';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme, tone as toneOf } from '@/theme';

import { Icon, type IconName, type IconSize } from './icon';

const { radius } = theme;

export function IconTile({
  name,
  tone = 'primary',
  size = 48,
  iconSize,
  round = false,
  style,
}: {
  name: IconName;
  tone?: Tone;
  size?: 32 | 40 | 48 | 56;
  iconSize?: IconSize;
  round?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = toneOf(tone);
  const icon: IconSize = iconSize ?? (size >= 48 ? 24 : size >= 40 ? 22 : 18);
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: round ? radius.full : radius.lg,
          backgroundColor: t.bg,
        },
        style,
      ]}
    >
      <Icon name={name} size={icon} color={t.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
