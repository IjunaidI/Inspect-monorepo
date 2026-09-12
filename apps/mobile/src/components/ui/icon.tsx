/**
 * The one icon component (INS-095). Renders a name from the curated map in
 * `@inspect/design-tokens` (Solar Bold for navigation/actions, linear for
 * content, custom garment glyphs) through react-native-svg. Screens import
 * THIS, never the token map or react-native-svg directly.
 */
import { iconSvg, type IconName } from '@inspect/design-tokens';
import { memo, useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useTheme } from '@/theme';

export type { IconName };
export type IconSize = 14 | 16 | 18 | 20 | 22 | 24 | 28 | 32;

export const Icon = memo(function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: IconName;
  size?: IconSize;
  /** Defaults to the theme foreground. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const fill = color ?? colors.foreground;
  const xml = useMemo(() => iconSvg(name, size, fill), [name, size, fill]);
  return (
    <SvgXml
      xml={xml}
      width={size}
      height={size}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
});
