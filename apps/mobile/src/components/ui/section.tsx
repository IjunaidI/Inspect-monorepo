/**
 * Section furniture (INS-095): the 10pt uppercase `SectionLabel` ("PIPELINE")
 * and the serif `SectionHeading` ("Recent inspections"), each with an optional
 * right-hand text action.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { text, theme } from '@/theme';

import { TextButton } from './button';

const { colors, space } = theme;

export interface SectionAction {
  label: string;
  onPress: () => void;
}

export function SectionLabel({
  children,
  action,
  style,
}: {
  children: string;
  action?: SectionAction;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      <Text style={styles.label}>{children}</Text>
      {action ? <TextButton label={action.label} onPress={action.onPress} size="sm" style={styles.compactAction} /> : null}
    </View>
  );
}

export function SectionHeading({
  title,
  action,
  style,
}: {
  title: string;
  action?: SectionAction;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, styles.headingRow, style]}>
      <Text style={styles.heading} numberOfLines={1}>
        {title}
      </Text>
      {action ? <TextButton label={action.label} onPress={action.onPress} style={styles.compactAction} /> : null}
    </View>
  );
}

/** A titled block: label/heading + content with the standard inner gap. */
export function Section({
  label,
  heading,
  action,
  children,
  style,
}: {
  label?: string;
  heading?: string;
  action?: SectionAction;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, style]}>
      {heading ? <SectionHeading title={heading} action={action} /> : null}
      {label ? <SectionLabel action={heading ? undefined : action}>{label}</SectionLabel> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  headingRow: { alignItems: 'flex-end' },
  label: { ...text('overline', colors.mutedForeground) },
  heading: { ...text('heading'), flex: 1 },
  compactAction: { minHeight: 28, alignSelf: 'center' },
  section: { gap: space[3] },
});
