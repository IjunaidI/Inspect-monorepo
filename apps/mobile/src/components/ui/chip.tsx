/**
 * A filter / segmented-choice pill (INS-095). Visually 36pt; the touch area is
 * padded to the 44pt floor with `hitSlop`, so tightly packed rows still hit.
 * Inactive = muted fill; active = primary tint + primary hairline.
 */
import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { font, theme } from '@/theme';

import { Icon, type IconName } from './icon';

const { colors, radius } = theme;

export function Chip({
  label,
  active,
  onPress,
  disabled = false,
  icon,
  tone = 'panel',
  style,
  labelStyle,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
  icon?: IconName;
  /** Kept for the pre-kit call sites; both render the muted fill now. */
  tone?: 'panel' | 'bg';
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}) {
  void tone;
  const color = active ? colors.primaryStrong : colors.mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.chip,
        active && styles.active,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={color} /> : null}
      <Text style={[styles.label, { color }, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.full,
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
    backgroundColor: colors.muted,
  },
  active: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  label: { fontFamily: font('sans', 600), fontSize: 13, lineHeight: 18 },
});
