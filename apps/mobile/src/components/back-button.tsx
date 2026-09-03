import { palette } from '@inspect/design-tokens';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { resolveBack } from '@/lib/navigation';

type Props = {
  /** Visible label. Defaults to "Back". */
  label?: string;
  /**
   * Where to go when there is no history to pop — a cold start on a deep link,
   * or a screen entered via `router.replace`. Defaults to the home screen.
   */
  fallbackHref?: string;
  /** Override the default press handler entirely (e.g. a confirm-before-leave). */
  onPress?: () => void;
};

/**
 * The one back affordance for every mobile screen. Always does something:
 * pops the stack when it can, otherwise replaces with `fallbackHref`, so a
 * user is never stranded on a screen with a dead button.
 */
export function BackButton({ label = 'Back', fallbackHref, onPress }: Props) {
  const router = useRouter();

  function go() {
    if (onPress) return onPress();
    const target = resolveBack(router.canGoBack(), fallbackHref);
    if (target.kind === 'back') router.back();
    else router.replace(target.href as never);
  }

  return (
    <Pressable
      onPress={go}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.chevron}>‹</Text>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingRight: 8,
    gap: 2,
  },
  pressed: { opacity: 0.55 },
  chevron: {
    color: palette.accent,
    fontSize: 26,
    lineHeight: 28,
    fontWeight: '600',
    marginTop: -2,
  },
  label: { color: palette.accent, fontSize: 15, fontWeight: '600' },
});
