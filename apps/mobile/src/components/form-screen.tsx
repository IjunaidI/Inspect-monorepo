/**
 * @deprecated INS-095 — the form shell is `Screen` in the kit (`scroll` +
 * `keyboard`). This wrapper keeps the INS-091 call sites compiling with their
 * original props until INS-096 re-points them.
 */
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { Screen } from './ui/screen';

export function FormScreen({
  children,
  header,
  contentStyle,
  onRefresh,
}: {
  children: ReactNode;
  /** Rendered above the scrolling body, outside the keyboard-avoiding area. */
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pull-to-refresh handler. Resolve when the re-fetch has landed. */
  onRefresh?: () => Promise<void>;
}) {
  return (
    <Screen
      keyboard
      header={header}
      edges={header ? ['top', 'left', 'right'] : undefined}
      contentStyle={[{ gap: 12 }, contentStyle]}
      onRefresh={onRefresh}
    >
      {children}
    </Screen>
  );
}
