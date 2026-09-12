/**
 * The screen shell (INS-095): canvas background, safe area, an optional
 * `Header`, a scrolling body with the standard 24pt gutters, keyboard
 * avoidance and pull-to-refresh. Replaces the hand-rolled SafeAreaView +
 * ScrollView every screen carried, and absorbs `FormScreen` (INS-091/092).
 *
 * `scrollRef` hands the body ScrollView to a caller that needs it — the
 * drag-and-drop loop list auto-scrolls the same container the keyboard
 * avoider owns (INS-098).
 */
import { useState, type ReactNode, type Ref } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { theme } from '@/theme';

const { colors, space } = theme;

export function Screen({
  children,
  header,
  scroll = true,
  padded = true,
  keyboard = false,
  onRefresh,
  refreshing: refreshingProp,
  contentStyle,
  footer,
  edges,
  scrollRef,
  style,
}: {
  children: ReactNode;
  /** Rendered above the body, outside the scroll and the keyboard avoider. Owns the top inset. */
  header?: ReactNode;
  scroll?: boolean;
  /** 24pt side gutters + 20pt gap between children. */
  padded?: boolean;
  /** Wrap the body in a KeyboardAvoidingView (form screens). */
  keyboard?: boolean;
  /** Pull-to-refresh handler. Resolve when the re-fetch has landed. */
  onRefresh?: () => Promise<void>;
  /** Externally controlled refreshing state (optional). */
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pinned under the body (a primary action). Gets the bottom inset. */
  footer?: ReactNode;
  edges?: Edge[];
  scrollRef?: Ref<ScrollView>;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const [refreshingLocal, setRefreshing] = useState(false);
  const refreshing = refreshingProp ?? refreshingLocal;

  async function refresh() {
    if (!onRefresh || refreshingLocal) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  const bodyStyle = [
    padded && styles.padded,
    { paddingBottom: (footer ? space[4] : insets.bottom + space[8]) },
    contentStyle,
  ];

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={bodyStyle}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, bodyStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges ?? (header ? ['left', 'right'] : ['top', 'left', 'right'])}>
      {header}
      {keyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + space[4] }]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  padded: { paddingHorizontal: space[6], paddingTop: space[5], gap: space[5] },
  footer: {
    paddingHorizontal: space[6],
    paddingTop: space[3],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
});
