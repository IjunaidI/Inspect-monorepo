/**
 * Upload status sheet (INS-093): every photo still on its way to the server,
 * with live progress, the failure reason, and the two human decisions the
 * queue can need — resolve a conflict, or give up on a shot. It doubles as the
 * "finishing" view when the inspector ends the loop with uploads outstanding:
 * the parent re-arms failures, this sheet shows them landing, and the parent
 * carries on to submit once nothing is left.
 */
import { palette } from '@inspect/design-tokens';
import type { InspectionLoopItemDto } from '@inspect/shared-types';
import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { QueuedPhoto } from '@/lib/capture-core';

import { SlotImage } from './slot-image';
import { stateLabel, ui } from './ui';

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Active entries for this inspection (never cache records). */
  entries: QueuedPhoto[];
  progress: Record<string, number>;
  items: InspectionLoopItemDto[];
  busy?: boolean;
  /** Last known connectivity; null = unknown. */
  online?: boolean | null;
  onRetryAll: () => void;
  onKeepMine: (entry: QueuedPhoto) => void;
  onDiscard: (entry: QueuedPhoto) => void;
  /** Jump to the entry's slot with the camera open — for rejected uploads. */
  onRetake: (entry: QueuedPhoto) => void;
  onClose: () => void;
  /** Rendered under the list — the parent decides what "done" means. */
  footer?: ReactNode;
};

export function UploadSheet(props: Props) {
  const { entries, progress, items } = props;
  const failed = entries.filter((e) => e.state === 'failed');
  const rejected = failed.filter((e) => e.failureKind === 'permanent');
  const conflicts = entries.filter((e) => e.state === 'conflict');
  const moving = entries.filter((e) => e.state === 'pending' || e.state === 'uploading');
  const offline = props.online === false;

  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={ui.sheetBackdrop}>
        <View style={ui.sheetBody}>
          <View style={ui.sheetHandleRow}>
            <View style={{ flex: 1 }}>
              <Text style={ui.sheetTitle}>{props.title}</Text>
              {props.subtitle ? <Text style={ui.hint}>{props.subtitle}</Text> : null}
            </View>
            <Pressable onPress={props.onClose} hitSlop={8} accessibilityRole="button">
              <Text style={ui.link}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            {offline && entries.length > 0 ? (
              <View style={styles.offline}>
                <Text style={styles.offlineText}>
                  You are offline. Photos are safe on this device and upload on their own the
                  moment the connection returns.
                </Text>
              </View>
            ) : null}
            {entries.length === 0 ? (
              <Text style={ui.muted}>Every photo is on the server.</Text>
            ) : null}
            {entries.map((e) => {
              const item = items.find((i) => i.id === e.inspectionLoopItemId);
              const badge = stateLabel(e.state, progress[e.id], e.failureKind, props.online);
              const isRejected = e.state === 'failed' && e.failureKind === 'permanent';
              const pct = e.state === 'uploading' ? (progress[e.id] ?? 0) : 0;
              return (
                <View key={e.id} style={styles.row}>
                  <SlotImage localUri={e.localUri} style={styles.thumb} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      Unit {e.cycleIndex + 1} · {item?.itemName ?? 'item'}
                      {e.intent === 'replace' ? '  (retake)' : ''}
                    </Text>
                    <View style={styles.rowMeta}>
                      {e.state === 'uploading' || e.state === 'pending' ? (
                        <ActivityIndicator size="small" color={palette.accent} />
                      ) : null}
                      <View style={[ui.badge, { backgroundColor: badge.bg }]}>
                        <Text style={[ui.badgeText, { color: badge.color }]}>{badge.text}</Text>
                      </View>
                      {e.attempts > 0 && e.state !== 'conflict' ? (
                        <Text style={ui.hint}>
                          {e.attempts} attempt{e.attempts === 1 ? '' : 's'}
                        </Text>
                      ) : null}
                    </View>
                    {e.state === 'uploading' ? (
                      <View style={ui.progressTrack}>
                        <View style={[ui.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
                      </View>
                    ) : null}
                    {e.state === 'failed' && e.error ? (
                      <Text
                        style={[styles.error, e.failureKind === 'offline' && ui.hint]}
                        numberOfLines={2}
                      >
                        {e.error}
                      </Text>
                    ) : null}
                    {isRejected ? (
                      <Text style={ui.hint}>
                        The server refused this photo, so retrying the same bytes cannot help.
                        Retake the shot, or discard it to reopen the slot.
                      </Text>
                    ) : null}
                    {e.state === 'conflict' ? (
                      <Text style={ui.hint}>
                        Someone else filled this slot while your photo waited. Keep yours to
                        replace theirs, or discard yours.
                      </Text>
                    ) : null}
                    {e.state === 'conflict' || e.state === 'failed' ? (
                      <View style={[ui.rowButtons, { marginTop: 4 }]}>
                        {e.state === 'conflict' ? (
                          <Pressable
                            style={[styles.smallBtn, { backgroundColor: palette.accent }]}
                            disabled={props.busy}
                            onPress={() => props.onKeepMine(e)}
                          >
                            <Text style={[styles.smallBtnLabel, { color: '#fff' }]}>Keep mine</Text>
                          </Pressable>
                        ) : null}
                        {isRejected ? (
                          <Pressable
                            style={[styles.smallBtn, { backgroundColor: palette.accent }]}
                            disabled={props.busy}
                            onPress={() => props.onRetake(e)}
                          >
                            <Text style={[styles.smallBtnLabel, { color: '#fff' }]}>Retake</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          style={[styles.smallBtn, styles.smallBtnGhost]}
                          disabled={props.busy}
                          onPress={() => props.onDiscard(e)}
                        >
                          <Text style={[styles.smallBtnLabel, { color: palette.danger }]}>
                            Discard {e.state === 'conflict' ? 'mine' : 'photo'}
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={ui.hint}>
              {offline
                ? `Offline · ${entries.length} waiting`
                : `${moving.length} uploading · ${failed.length - rejected.length} retrying`}
              {rejected.length ? ` · ${rejected.length} rejected` : ''}
              {conflicts.length
                ? ` · ${conflicts.length} need${conflicts.length === 1 ? 's' : ''} a decision`
                : ''}
            </Text>
            {failed.length > 0 && !offline ? (
              <Pressable style={ui.btnGhost} onPress={props.onRetryAll} disabled={props.busy}>
                <Text style={ui.btnGhostLabel}>Retry failed now</Text>
              </Pressable>
            ) : null}
            {props.footer}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
  },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#000' },
  rowTitle: { color: palette.ink, fontSize: 13.5, fontWeight: '700' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  error: { color: palette.danger, fontSize: 12 },
  smallBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  smallBtnGhost: { borderWidth: 1, borderColor: palette.line },
  smallBtnLabel: { fontSize: 12.5, fontWeight: '600' },
  footer: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.lineSoft },
  offline: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.5)',
  },
  offlineText: { color: '#7c4a03', fontSize: 12.5 },
});
