/**
 * Quick-look gallery (INS-093): every unit shot so far, one tile per loop item,
 * with the upload state of each tile and the frontier marked. Tapping a tile
 * jumps the capture cursor there — a filled slot can be reviewed or retaken,
 * the frontier is where the next shot goes, and nothing else is reachable.
 */
import { palette } from '@inspect/design-tokens';
import type { InspectionLoopItemDto } from '@inspect/shared-types';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  cachedUriForSlot,
  entryForSlot,
  sameCursor,
  type Cursor,
  type QueuedPhoto,
} from '@/lib/capture-core';

import { SlotImage } from './slot-image';
import { stateLabel, ui } from './ui';

type Props = {
  visible: boolean;
  onClose: () => void;
  inspectionId: string;
  items: InspectionLoopItemDto[];
  queue: QueuedPhoto[];
  progress: Record<string, number>;
  /** Every reachable cursor, in order (filled slots + the frontier). */
  sequence: Cursor[];
  frontier: Cursor;
  cursor: Cursor;
  target?: number | null;
  onJump: (cursor: Cursor) => void;
};

export function Gallery(props: Props) {
  const { items, queue, inspectionId, sequence, frontier, cursor } = props;
  const units = [...new Set(sequence.map((c) => c.cycleIndex))].sort((a, b) => a - b);
  const photoCount = sequence.filter((c) => !sameCursor(c, frontier)).length;

  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={ui.screen}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={ui.sheetTitle}>Gallery</Text>
            <Text style={ui.hint}>
              {photoCount} photo{photoCount === 1 ? '' : 's'} · {units.length} unit
              {units.length === 1 ? '' : 's'}
              {props.target ? ` · target ${props.target}` : ''}
            </Text>
          </View>
          <Pressable onPress={props.onClose} hitSlop={8} accessibilityRole="button">
            <Text style={ui.link}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {units.map((cycleIndex) => {
            const inUnit = sequence.filter((c) => c.cycleIndex === cycleIndex);
            const shot = inUnit.filter((c) => !sameCursor(c, frontier)).length;
            const complete = shot === items.length;
            const defects = items.reduce(
              (n, item) =>
                n + (item.defects ?? []).filter((d) => d.cycleIndex === cycleIndex).length,
              0,
            );
            return (
              <View key={cycleIndex} style={styles.unit}>
                <View style={styles.unitHead}>
                  <Text style={styles.unitTitle}>Unit {cycleIndex + 1}</Text>
                  <Text style={ui.hint}>
                    {shot}/{items.length} photos
                    {defects ? ` · ${defects} defect${defects === 1 ? '' : 's'}` : ''}
                  </Text>
                  <View
                    style={[
                      ui.badge,
                      { backgroundColor: complete ? 'rgba(22,163,74,0.12)' : palette.panel },
                    ]}
                  >
                    <Text
                      style={[
                        ui.badgeText,
                        { color: complete ? '#15803d' : palette.faint },
                      ]}
                    >
                      {complete ? 'Complete' : 'In progress'}
                    </Text>
                  </View>
                </View>
                <View style={styles.tiles}>
                  {items.map((item, itemIndex) => {
                    const c = { cycleIndex, itemIndex };
                    const reachable = inUnit.some((s) => sameCursor(s, c));
                    const isFrontier = sameCursor(c, frontier);
                    const slot = { inspectionLoopItemId: item.id, cycleIndex };
                    const serverPhoto = item.photos?.find((p) => p.cycleIndex === cycleIndex);
                    const entry = entryForSlot(queue, inspectionId, slot);
                    const local = cachedUriForSlot(queue, inspectionId, slot, serverPhoto?.contentHash);
                    // Saved/on-server tiles carry no badge — the image is the state.
                    const badge =
                      entry && entry.state !== 'uploaded'
                        ? stateLabel(entry.state, props.progress[entry.id])
                        : null;
                    const current = sameCursor(c, cursor);
                    return (
                      <Pressable
                        key={item.id}
                        disabled={!reachable}
                        onPress={() => props.onJump(c)}
                        accessibilityRole="button"
                        accessibilityLabel={`Unit ${cycleIndex + 1}, ${item.itemName}`}
                        style={[
                          styles.tile,
                          current && styles.tileCurrent,
                          isFrontier && styles.tileFrontier,
                          !reachable && ui.dim,
                        ]}
                      >
                        {isFrontier ? (
                          <View style={[StyleSheet.absoluteFill, ui.center]}>
                            <Text style={styles.frontierGlyph}>+</Text>
                            <Text style={styles.frontierText}>Next shot</Text>
                          </View>
                        ) : reachable ? (
                          <SlotImage
                            localUri={local}
                            remoteUri={serverPhoto?.viewUrl}
                            style={StyleSheet.absoluteFill}
                            emptyLabel="Preview unavailable"
                          />
                        ) : (
                          <View style={[StyleSheet.absoluteFill, ui.center]}>
                            <Text style={styles.frontierText}>—</Text>
                          </View>
                        )}
                        {badge && entry && entry.state !== 'uploaded' ? (
                          <View style={[styles.tileBadge, { backgroundColor: badge.bg }]}>
                            <Text style={[styles.tileBadgeText, { color: badge.color }]}>
                              {entry.state === 'uploading' && props.progress[entry.id] !== undefined
                                ? `${Math.round((props.progress[entry.id] ?? 0) * 100)}%`
                                : entry.state === 'failed'
                                  ? 'Failed'
                                  : entry.state === 'conflict'
                                    ? 'Decide'
                                    : 'Queued'}
                            </Text>
                          </View>
                        ) : null}
                        <Text style={styles.tileLabel} numberOfLines={1}>
                          {item.itemName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.panel,
  },
  body: { padding: 16, gap: 18, paddingBottom: 40 },
  unit: { gap: 8 },
  unitHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unitTitle: { color: palette.ink, fontSize: 15, fontWeight: '700', flexShrink: 0 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'flex-end',
  },
  tileCurrent: { borderColor: palette.accent },
  tileFrontier: {
    backgroundColor: palette.panel,
    borderColor: palette.accent,
    borderStyle: 'dashed',
  },
  frontierGlyph: { color: palette.accent, fontSize: 28, fontWeight: '300', lineHeight: 30 },
  frontierText: { color: palette.faint, fontSize: 11, fontWeight: '600' },
  tileBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tileBadgeText: { fontSize: 10, fontWeight: '700' },
  tileLabel: {
    color: '#fff',
    fontSize: 10.5,
    fontWeight: '600',
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
