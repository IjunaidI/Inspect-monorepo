/**
 * The page header (INS-095): card surface, hairline bottom, serif title, an
 * optional round bordered back control and one text action on the right.
 * Owns the top safe-area inset, so a `Screen` that renders a header does not
 * pad the top again.
 *
 * `BackButton` is the one back affordance for every screen. It always does
 * something: pops the stack when it can, otherwise replaces with
 * `fallbackHref`, so a user is never stranded behind a dead control.
 */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveBack } from '@/lib/navigation';
import { MIN_TARGET, text, theme } from '@/theme';

import { TextButton, type TextButtonTone } from './button';
import { Icon } from './icon';

const { colors, radius, space } = theme;

export interface BackProps {
  /** Visible label for the text variant. Defaults to "Back". */
  label?: string;
  /** Where to go when there is no history to pop (cold start on a deep link). */
  fallbackHref?: string;
  /** Override the default press handler entirely (e.g. a confirm-before-leave). */
  onPress?: () => void;
}

export function BackButton({
  label = 'Back',
  fallbackHref,
  onPress,
  variant = 'text',
  style,
}: BackProps & { variant?: 'text' | 'circle'; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();

  function go() {
    if (onPress) return onPress();
    const target = resolveBack(router.canGoBack(), fallbackHref);
    if (target.kind === 'back') router.back();
    else router.replace(target.href as never);
  }

  if (variant === 'circle') {
    return (
      <Pressable
        onPress={go}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.circle, pressed && styles.pressed, style]}
      >
        <Icon name="back" size={22} color={colors.foreground} />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={go}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.textBack, pressed && styles.pressed, style]}
    >
      <Icon name="back" size={20} color={colors.primary} />
      <Text style={text('button', colors.primary)}>{label}</Text>
    </Pressable>
  );
}

export interface HeaderAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: TextButtonTone;
}

export function Header({
  title,
  subtitle,
  overline,
  back,
  action,
  right,
  children,
  compact = false,
  style,
}: {
  title: string;
  subtitle?: string | null;
  /** Small uppercase line above the title (the org name on Home). */
  overline?: string | null;
  /** `true` for the default back control, or its props. */
  back?: boolean | BackProps;
  /** One text action on the right ("New", "Save"). */
  action?: HeaderAction;
  /** Arbitrary right-side content (an avatar); wins over `action`. */
  right?: ReactNode;
  /** A slot under the title row — a search field, filter chips. */
  children?: ReactNode;
  /** Tighter vertical padding for pushed, dense screens (capture). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const backProps = back === true ? {} : back || null;
  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: insets.top + (compact ? space[2] : space[3]),
          paddingBottom: children ? space[3] : compact ? space[3] : space[5],
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {backProps ? <BackButton {...backProps} variant="circle" /> : null}
        <View style={styles.titles}>
          {overline ? (
            <Text style={styles.overline} numberOfLines={1}>
              {overline}
            </Text>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? (
          <View style={styles.right}>{right}</View>
        ) : action ? (
          <TextButton
            label={action.label}
            onPress={action.onPress}
            disabled={action.disabled}
            tone={action.tone}
            style={styles.action}
          />
        ) : null}
      </View>
      {children ? <View style={styles.slot}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space[6],
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: space[3],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  titles: { flex: 1, minWidth: 0 },
  overline: { ...text('overline', colors.mutedForeground), marginBottom: 4 },
  title: { ...text('title') },
  subtitle: { ...text('caption', colors.mutedForeground), marginTop: 2 },
  right: { flexShrink: 0 },
  action: { alignSelf: 'center' },
  slot: { gap: space[3] },
  circle: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  textBack: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: MIN_TARGET - 8,
    paddingRight: 8,
    gap: 4,
  },
  pressed: { opacity: 0.6 },
});
