/**
 * Shared styles + tiny helpers for the capture surface (INS-093). One
 * vocabulary for the screen, the gallery and the upload sheet so they read as
 * one system — the mobile counterpart of `components/inspect/tokens.ts`.
 */
import { palette, severity as severityTint } from '@inspect/design-tokens';
import type { DefectSeverity } from '@inspect/shared-types';
import { StyleSheet } from 'react-native';

import type { QueuedPhotoState } from '@/lib/capture-core';

export const SEVERITIES: DefectSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR'];
export const TINT: Record<DefectSeverity, { fg: string; bg: string }> = {
  CRITICAL: severityTint.critical,
  MAJOR: severityTint.major,
  MINOR: severityTint.minor,
};

/** Human label + colour for a queue state, as shown on badges everywhere. */
export function stateLabel(
  state: QueuedPhotoState | 'server',
  progress?: number,
): { text: string; color: string; bg: string } {
  switch (state) {
    case 'pending':
      return { text: 'Waiting to upload', color: '#fff', bg: 'rgba(0,0,0,0.6)' };
    case 'uploading':
      return {
        text: progress !== undefined ? `Uploading ${Math.round(progress * 100)}%` : 'Uploading…',
        color: '#fff',
        bg: 'rgba(3,123,244,0.85)',
      };
    case 'failed':
      return { text: 'Upload failed — retrying', color: '#fff', bg: 'rgba(220,38,38,0.9)' };
    case 'conflict':
      return { text: 'Needs your decision', color: '#1f1300', bg: severityTint.major.bg };
    case 'uploaded':
      return { text: 'Saved', color: '#fff', bg: 'rgba(22,163,74,0.9)' };
    case 'server':
      return { text: 'On server', color: '#fff', bg: 'rgba(0,0,0,0.55)' };
  }
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.5 },
  muted: { color: palette.sub, fontSize: 13 },
  hint: { color: palette.faint, fontSize: 12 },
  errorText: { color: palette.sub, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  sectionLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  rowButtons: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btn: {
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnGhost: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.panel,
  },
  btnGhostLabel: { color: palette.sub, fontSize: 14, fontWeight: '600' },
  btnDanger: { borderColor: palette.danger },
  btnDangerLabel: { color: palette.danger },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: palette.ink,
    backgroundColor: palette.panel,
    fontSize: 13.5,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,18,32,0.45)',
    justifyContent: 'flex-end',
  },
  sheetBody: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
    padding: 16,
  },
  sheetHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  sheetTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  gateBody: {
    backgroundColor: palette.bg,
    borderRadius: 14,
    padding: 18,
    marginHorizontal: 24,
    alignSelf: 'stretch',
  },
  gateTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  gateText: { color: palette.sub, fontSize: 13.5, lineHeight: 19 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.lineSoft,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: palette.accent },
});
