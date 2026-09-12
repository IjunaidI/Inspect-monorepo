/**
 * Empty, error and loading states (INS-095). `EmptyState` centres an icon
 * tile, a serif title and body copy; `ErrorState` adds Retry + a back control;
 * `Skeleton` pulses a placeholder block for list screens still loading.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { text, theme } from '@/theme';

import { Button, TextButton } from './button';
import { BackButton } from './header';
import { type IconName } from './icon';
import { IconTile } from './icon-tile';

const { colors, radius, space } = theme;

export function EmptyState({
  icon = 'inspections',
  title,
  body,
  action,
  secondary,
  style,
}: {
  icon?: IconName;
  title: string;
  body?: string | null;
  action?: { label: string; onPress: () => void; icon?: IconName };
  secondary?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.center, style]}>
      <IconTile name={icon} tone="neutral" size={56} iconSize={28} round />
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? <Button label={action.label} onPress={action.onPress} icon={action.icon} style={styles.action} /> : null}
      {secondary}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  body,
  onRetry,
  retryLabel = 'Retry',
  back = true,
  fallbackHref,
  style,
}: {
  title?: string;
  body?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  back?: boolean;
  fallbackHref?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.center, style]}>
      <IconTile name="warning" tone="warning" size={56} iconSize={28} round />
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      <View style={styles.actions}>
        {onRetry ? <TextButton label={retryLabel} onPress={onRetry} icon="retry" /> : null}
        {back ? <BackButton label="Go back" fallbackHref={fallbackHref} /> : null}
      </View>
    </View>
  );
}

/** A pulsing placeholder block. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius: r = radius.sm,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  // A lazily created Animated.Value, stable across renders (a ref would be
  // read during render, which the React Compiler forbids).
  const [opacity] = useState(() => new Animated.Value(0.6));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[{ width, height, borderRadius: r, backgroundColor: colors.muted, opacity }, style]}
    />
  );
}

/** `count` card-shaped skeleton rows, for list screens. */
export function SkeletonRows({ count = 4, height = 76 }: { count?: number; height?: number }) {
  return (
    <View style={styles.rows}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} radius={radius.xl} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[8], gap: space[3] },
  title: { ...text('heading'), textAlign: 'center', marginTop: space[1] },
  body: { ...text('body', colors.mutedForeground), textAlign: 'center' },
  action: { marginTop: space[2] },
  actions: { flexDirection: 'row', gap: space[6], alignItems: 'center', marginTop: space[2] },
  rows: { gap: space[2] },
});
