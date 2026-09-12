/**
 * The pre-INS-095 shared StyleSheet (`ui.hint`, `ui.card`, `ui.screen`, …),
 * re-coloured onto the theme so the ~20 screens that compose from it keep
 * compiling and look right during the batch-by-batch re-skin (INS-096).
 *
 * @deprecated Compose from the kit components instead; this file is deleted in
 * the last INS-096 batch.
 */
import { StyleSheet } from 'react-native';

import { MIN_TARGET, text, theme } from '@/theme';

const { colors, radius } = theme;

export { MIN_TARGET };

export const ui = StyleSheet.create({
  hint: { ...text('caption', colors.faint) },
  errorText: { ...text('body', colors.destructiveStrong), fontSize: 13, lineHeight: 18 },
  savedText: { ...text('label', colors.primaryStrong), fontSize: 13, lineHeight: 18 },
  sectionLabel: { ...text('overline', colors.mutedForeground) },
  link: { ...text('button', colors.primary) },
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  centerActions: { flexDirection: 'row', gap: 24, marginTop: 8, alignItems: 'center' },
  errorTitle: { ...text('subheading') },
  mutedText: { ...text('body', colors.mutedForeground), textAlign: 'center' },
  title: { ...text('title') },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: 16,
    gap: 10,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dangerCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.destructiveSoft,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: 16,
    gap: 8,
  },
  dangerTitle: { ...text('bodyStrong', colors.destructiveStrong) },
});
