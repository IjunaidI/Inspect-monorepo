/**
 * INS-092 — the form vocabulary every mobile screen shares. Before this, the
 * label / input / button styles were copy-pasted into ~10 StyleSheets and had
 * already drifted (paddingVertical 10 vs 11, fontSize 14 vs 15, buttons with
 * and without a 44pt floor). One definition, the exact values the screens
 * already used, and a 44pt minimum on every tappable thing.
 *
 * Palette only from @inspect/design-tokens — never a hex at a call site.
 */
import { palette, severity as severityTint } from '@inspect/design-tokens';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

/** The 44pt floor — Apple HIG / Material minimum touch target. */
export const MIN_TARGET = 44;

// ── Field ───────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
  style,
}: {
  label?: string;
  /** Guidance under the control. Hidden while `error` is set. */
  hint?: string | null;
  error?: string | null;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      {children}
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ── Input ───────────────────────────────────────────────────────────────────

export function Input({
  invalid = false,
  style,
  multiline,
  placeholderTextColor = palette.faint,
  ...rest
}: TextInputProps & { invalid?: boolean }) {
  return (
    <TextInput
      {...rest}
      multiline={multiline}
      placeholderTextColor={placeholderTextColor}
      style={[
        styles.input,
        multiline && styles.inputMultiline,
        invalid && styles.inputInvalid,
        style,
      ]}
    />
  );
}

// ── Button ──────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

export function Button({
  label,
  loadingLabel,
  loading = false,
  disabled = false,
  variant = 'primary',
  onPress,
  style,
  labelStyle,
  hitSlop,
  accessibilityLabel,
}: {
  label: string;
  /** Shown while `loading` (e.g. "Saving…"); defaults to `label`. */
  loadingLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  hitSlop?: PressableProps['hitSlop'];
  accessibilityLabel?: string;
}) {
  const inert = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        variant === 'ghost' && styles.buttonGhost,
        variant === 'danger' && styles.buttonDanger,
        inert && styles.buttonDisabled,
        pressed && !inert && styles.buttonPressed,
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          variant === 'ghost' && styles.buttonGhostLabel,
          variant === 'danger' && styles.buttonDangerLabel,
          labelStyle,
        ]}
      >
        {loading ? (loadingLabel ?? label) : label}
      </Text>
    </Pressable>
  );
}

// ── Chip ────────────────────────────────────────────────────────────────────

/**
 * A filter / segmented-choice pill. Visually 36pt; the touch area is padded
 * to the 44pt floor with `hitSlop`, so tightly packed rows still hit.
 */
export function Chip({
  label,
  active,
  onPress,
  disabled = false,
  tone = 'panel',
  style,
  labelStyle,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Inactive fill: `panel` on the page canvas, `bg` when the row sits on a panel. */
  tone?: 'panel' | 'bg';
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      style={[
        styles.chip,
        tone === 'bg' && styles.chipOnPanel,
        active && styles.chipActive,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

// ── Text-only link button ───────────────────────────────────────────────────

/**
 * An inline text action ("Retry", "Remove", "Deactivate"). The Text alone is
 * ~18pt tall; this wraps it in a 44pt-tall centred hit area without changing
 * how the row lays out.
 */
export function TextButton({
  label,
  onPress,
  tone = 'accent',
  disabled = false,
  style,
  labelStyle,
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.textButton,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text
        style={[styles.textButtonLabel, tone === 'danger' && styles.textButtonDanger, labelStyle]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ── Shared styles (exported so a screen can compose, e.g. `ui.hint`) ────────

export const ui = StyleSheet.create({
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  errorText: { color: palette.danger, fontSize: 13 },
  savedText: { color: palette.accent, fontSize: 13, fontWeight: '600' },
  sectionLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: palette.bg },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  centerActions: { flexDirection: 'row', gap: 24, marginTop: 8, alignItems: 'center' },
  errorTitle: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  mutedText: { color: palette.sub, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  title: { color: palette.ink, fontSize: 20, fontWeight: '700' },
  card: {
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dangerCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: severityTint.critical.bg,
    backgroundColor: palette.panel,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  dangerTitle: { color: palette.danger, fontSize: 14, fontWeight: '700' },
});

const styles = StyleSheet.create({
  field: { gap: 6 },
  fieldLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  hint: { color: palette.faint, fontSize: 12, lineHeight: 17 },
  errorText: { color: palette.danger, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    backgroundColor: palette.panel,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: palette.ink,
    fontSize: 14,
    minHeight: MIN_TARGET,
  },
  inputMultiline: { textAlignVertical: 'top' },
  inputInvalid: { borderColor: palette.danger },
  button: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: MIN_TARGET,
  },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: palette.panel, fontSize: 15, fontWeight: '700' },
  buttonGhost: {
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.line,
  },
  buttonGhostLabel: { color: palette.sub, fontSize: 14, fontWeight: '600' },
  buttonDanger: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: severityTint.critical.bg,
    backgroundColor: severityTint.critical.bg,
    paddingVertical: 8,
  },
  buttonDangerLabel: { color: palette.danger, fontSize: 13, fontWeight: '700' },
  chip: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
    backgroundColor: palette.panel,
  },
  chipOnPanel: { backgroundColor: palette.bg },
  chipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  chipLabel: { color: palette.sub, fontSize: 13, fontWeight: '600' },
  chipLabelActive: { color: palette.accent },
  textButton: {
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
  },
  textButtonLabel: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  textButtonDanger: { color: palette.danger, fontSize: 13 },
});
