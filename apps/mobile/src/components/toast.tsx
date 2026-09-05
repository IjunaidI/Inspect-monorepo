/**
 * INS-092 — success feedback. Before this, a create either navigated away
 * (and the new row was the only sign anything happened) or set a "Saved."
 * line that stayed until the next action. One provider at the root, one
 * `useToast()` hook, one transient pill at the bottom of the screen.
 *
 * Modals live in their own native window and cover the root viewport, so a
 * sheet that wants its toasts visible while it is open mounts its own
 * `<ToastViewport />` inside the Modal — the same state renders in both places
 * and only the topmost one is ever visible.
 */
import { palette } from '@inspect/design-tokens';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ToastTone = 'neutral' | 'success' | 'danger';

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds on screen. Default 2600. */
  duration?: number;
}

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
  /** Internal: the currently visible toast, read by `ToastViewport`. */
  current: ToastState | null;
}

const noop = () => {};
const ToastContext = createContext<ToastApi>({ show: noop, dismiss: noop, current: null });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setCurrent(null);
  }, []);

  const show = useCallback((message: string, options?: ToastOptions) => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent({ id: Date.now(), message, tone: options?.tone ?? 'success' });
    timer.current = setTimeout(() => {
      timer.current = null;
      setCurrent(null);
    }, options?.duration ?? 2600);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ show, dismiss, current }}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

/** `show(message)` — call after a create/save lands. */
export function useToast(): ToastApi['show'] {
  return useContext(ToastContext).show;
}

/**
 * Renders the current toast. Mounted once by the provider; a Modal that wants
 * toasts visible while open mounts a second one inside itself.
 */
export function ToastViewport() {
  const { current, dismiss } = useContext(ToastContext);
  const insets = useSafeAreaInsets();
  if (!current) return null;
  return (
    <ToastPill
      key={current.id}
      toast={current}
      bottom={insets.bottom + 24}
      onPress={dismiss}
    />
  );
}

function ToastPill({
  toast,
  bottom,
  onPress,
}: {
  toast: ToastState;
  bottom: number;
  onPress: () => void;
}) {
  // State, not a ref: the value is read during render (react-hooks/refs).
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [opacity]);
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.host, { bottom, opacity }]}
      accessibilityLiveRegion="polite"
    >
      <Pressable
        onPress={onPress}
        style={[styles.pill, toast.tone === 'danger' && styles.pillDanger]}
        accessibilityRole="alert"
      >
        {toast.tone === 'success' ? <Text style={styles.tick}>✓</Text> : null}
        <Text style={styles.text} numberOfLines={2}>
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    backgroundColor: palette.ink,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 40,
  },
  pillDanger: { backgroundColor: palette.danger },
  tick: { color: palette.panel, fontSize: 13, fontWeight: '800' },
  text: { color: palette.panel, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
});
