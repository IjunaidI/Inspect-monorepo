/**
 * Defects + measurements for one unit (INS-081: tags are loop-global and pin
 * to a slot; the measurement sheet is filled once per unit). Extracted from
 * the capture screen in INS-093.
 *
 * Device-pass fixes (2026-10-13):
 *  - A defect pins to a SHOT, and the frontier moves on the moment a photo is
 *    taken — so the sheet carries an explicit target ("Defect seen on") that
 *    defaults to the shot just taken instead of the empty slot under the
 *    camera. The rules are `notesUnit` / `defaultTagTarget` in capture-core.
 *  - A catalog defect already recorded on the target renders SELECTED (check +
 *    severity fill) and cannot be added twice; one that is not yet recorded is
 *    a plain chip with a severity dot. Mirrors the web console's `taggedHere`.
 *    While the add is in flight the chip shows the selected fill with a spinner.
 */
import { palette } from '@inspect/design-tokens';
import type {
  DefectCatalogDto,
  DefectSeverity,
  InspectionDto,
  MeasurementDto,
} from '@inspect/shared-types';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { sameCursor, taggedCatalogIds, type Cursor } from '@/lib/capture-core';

import { SEVERITIES, TINT, ui } from './ui';

export function measurementFor(
  measurements: MeasurementDto[] | undefined,
  cycleIndex: number,
  label: string,
): MeasurementDto | undefined {
  return measurements?.find((m) => m.cycleIndex === cycleIndex && m.label === label);
}

export function UnitSheet(props: {
  catalog: DefectCatalogDto[];
  inspection: InspectionDto;
  /** The unit this sheet is about — see `notesUnit` in capture-core. */
  cycleIndex: number;
  /** The cursor opened a fresh, empty unit, so this sheet is about the one just finished. */
  justCompleted: boolean;
  /** This unit's shots, in item order — the only legal tag targets. */
  targets: Cursor[];
  /** The shot a new tag lands on; null before the unit's first shot. */
  target: Cursor | null;
  onTarget: (c: Cursor) => void;
  /** The target's photo is on the SERVER — the API refuses a tag otherwise. */
  canTag: boolean;
  /** The target's photo is still on its way up — explains why tagging waits. */
  pendingUpload: boolean;
  offline: boolean;
  busy: boolean;
  readOnly: boolean;
  onTag: (item: DefectCatalogDto) => Promise<unknown>;
  onCustom: (text: string, severity: DefectSeverity) => Promise<boolean>;
  onMeasure: (label: string, unit: string | undefined, value: string) => void;
}) {
  const { catalog, inspection, cycleIndex, targets, target, canTag, busy, readOnly } = props;
  const items = inspection.items ?? [];
  const [customText, setCustomText] = useState('');
  const [customSeverity, setCustomSeverity] = useState<DefectSeverity>('MINOR');
  /** The catalog chip whose add is in flight — selected fill + spinner until the refetch lands. */
  const [pendingId, setPendingId] = useState<string | null>(null);

  const targetItem = target ? items[target.itemIndex] : undefined;
  const taggedHere =
    target && targetItem
      ? taggedCatalogIds(items, {
          inspectionLoopItemId: targetItem.id,
          cycleIndex: target.cycleIndex,
        })
      : new Set<string>();

  const unitDefects = items.flatMap((item) =>
    (item.defects ?? [])
      .filter((d) => d.cycleIndex === cycleIndex)
      .map((d) => ({ ...d, itemName: item.itemName })),
  );
  const fields = inspection.loopPresetSnapshot?.measurementFields ?? [];

  let hint: string | null = null;
  if (!readOnly) {
    if (!target) {
      hint = 'Take the first photo — a defect is recorded against the shot it was seen on.';
    } else if (!canTag) {
      const name = targetItem?.itemName ?? 'That';
      hint = props.pendingUpload
        ? `${name} is still ${props.offline ? 'waiting for network' : 'uploading'} — tags unlock the moment it lands.`
        : `${name} has no photo on the server yet.`;
    }
  }

  async function tag(item: DefectCatalogDto) {
    setPendingId(item.id);
    try {
      await props.onTag(item);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <View style={{ gap: 16, paddingBottom: 24 }}>
      {props.justCompleted ? (
        <Text style={ui.hint}>Just completed — the next unit has no photos yet.</Text>
      ) : null}

      <View>
        <Text style={ui.sectionLabel}>Defect tags</Text>

        {/* Which shot the defect pins to */}
        {!readOnly && targets.length > 0 ? (
          <View style={styles.targetBlock}>
            <Text style={styles.targetLabel}>Defect seen on</Text>
            <View style={styles.chipWrap}>
              {items.map((item, itemIndex) => {
                const c = { cycleIndex, itemIndex };
                const shot = targets.some((t) => sameCursor(t, c));
                const selected = target ? sameCursor(target, c) : false;
                return (
                  <Pressable
                    key={item.id}
                    disabled={!shot}
                    onPress={() => props.onTarget(c)}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: !shot }}
                    style={({ pressed }) => [
                      styles.targetChip,
                      selected && styles.targetChipOn,
                      !shot && ui.dim,
                      pressed && shot && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[styles.targetChipLabel, selected && styles.targetChipLabelOn]}
                      numberOfLines={1}
                    >
                      {item.itemName}
                      {shot ? '' : ' · no photo'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {hint ? <Text style={[ui.hint, styles.hintRow]}>{hint}</Text> : null}

        {SEVERITIES.map((sev) => {
          const group = catalog.filter((c) => c.defaultSeverity === sev && !c.isArchived);
          if (!group.length) return null;
          return (
            <View key={sev} style={{ marginTop: 8 }}>
              <Text style={[styles.severityLabel, { color: TINT[sev].fg }]}>
                {sev.charAt(0) + sev.slice(1).toLowerCase()}
              </Text>
              <View style={styles.chipWrap}>
                {group.map((c) => {
                  const on = taggedHere.has(c.id);
                  const pending = pendingId === c.id;
                  const lit = on || pending;
                  const enabled = canTag && !busy && !readOnly && !on;
                  return (
                    <Pressable
                      key={c.id}
                      disabled={!enabled}
                      onPress={() => void tag(c)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: lit, disabled: !enabled }}
                      accessibilityLabel={on ? `${c.name}, recorded on this shot` : c.name}
                      style={({ pressed }) => [
                        styles.defectChip,
                        lit
                          ? { backgroundColor: TINT[sev].bg, borderColor: TINT[sev].fg }
                          : styles.defectChipOff,
                        !lit && !canTag && !readOnly && ui.dim,
                        pressed && enabled && styles.pressed,
                      ]}
                    >
                      {pending ? (
                        <ActivityIndicator
                          size="small"
                          color={TINT[sev].fg}
                          style={styles.chipSpinner}
                        />
                      ) : on ? (
                        <Text style={[styles.chipCheck, { color: TINT[sev].fg }]}>✓</Text>
                      ) : (
                        <View style={[styles.chipDot, { backgroundColor: TINT[sev].dot }]} />
                      )}
                      <Text
                        style={[
                          styles.defectChipLabel,
                          { color: lit ? TINT[sev].fg : palette.sub },
                        ]}
                      >
                        {c.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}

        {!readOnly ? (
          <View style={styles.customRow}>
            <TextInput
              style={ui.input}
              placeholder="Add custom defect tag…"
              placeholderTextColor={palette.faint}
              value={customText}
              onChangeText={setCustomText}
              editable={canTag && !busy}
            />
            <Pressable
              onPress={() =>
                setCustomSeverity(
                  SEVERITIES[(SEVERITIES.indexOf(customSeverity) + 1) % SEVERITIES.length] ??
                    'MINOR',
                )
              }
              style={[ui.btnGhost, styles.compact, { backgroundColor: TINT[customSeverity].bg }]}
            >
              <Text style={[ui.btnGhostLabel, { color: TINT[customSeverity].fg }]}>
                {customSeverity.charAt(0) + customSeverity.slice(1).toLowerCase()}
              </Text>
            </Pressable>
            <Pressable
              style={[ui.btn, styles.compact, (!canTag || !customText.trim() || busy) && ui.dim]}
              disabled={!canTag || !customText.trim() || busy}
              onPress={async () => {
                if (await props.onCustom(customText.trim(), customSeverity)) setCustomText('');
              }}
            >
              <Text style={ui.btnLabel}>Add</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View>
        <Text style={ui.sectionLabel}>On this unit · {unitDefects.length}</Text>
        {unitDefects.length === 0 ? (
          <Text style={ui.hint}>No defects recorded.</Text>
        ) : (
          unitDefects.map((d) => (
            <View key={d.id} style={styles.unitDefectRow}>
              <Text style={[styles.defectChipLabel, { color: TINT[d.severity].fg }]}>
                {d.defectCatalog?.name ?? d.customText ?? '—'}
              </Text>
              <Text style={ui.hint}>{d.itemName}</Text>
            </View>
          ))
        )}
      </View>

      <View>
        <Text style={ui.sectionLabel}>Measurements · this unit</Text>
        {fields.length === 0 ? (
          <Text style={ui.hint}>No measurement sheet on this loop.</Text>
        ) : (
          fields.map((f) => (
            <MeasurementRow
              key={`${cycleIndex}:${f.label}`}
              label={f.label}
              unit={f.unit}
              initial={
                measurementFor(inspection.measurements, cycleIndex, f.label)?.recordedValue ?? ''
              }
              readOnly={readOnly}
              onSave={(v) => props.onMeasure(f.label, f.unit, v)}
            />
          ))
        )}
      </View>
    </View>
  );
}

function MeasurementRow(props: {
  label: string;
  unit?: string;
  initial: string;
  readOnly: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <View style={styles.measureRow}>
      <Text style={styles.measureLabel}>{props.label}</Text>
      <TextInput
        style={[ui.input, styles.measureInput]}
        value={value}
        onChangeText={setValue}
        onEndEditing={() => props.onSave(value)}
        editable={!props.readOnly}
        placeholder="—"
        placeholderTextColor={palette.faint}
      />
      <Text style={ui.hint}>{props.unit ?? ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  severityLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hintRow: { marginTop: 6 },
  pressed: { opacity: 0.8 },

  // Which shot the defect pins to
  targetBlock: { marginTop: 4, marginBottom: 6, gap: 6 },
  targetLabel: { color: palette.sub, fontSize: 12, fontWeight: '600' },
  targetChip: {
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  targetChipOn: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  targetChipLabel: { color: palette.sub, fontSize: 12.5, fontWeight: '600' },
  targetChipLabelOn: { color: palette.accent },

  // Catalog defect chips: off = dot + hairline, on = check + severity fill
  defectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
  },
  defectChipOff: { backgroundColor: palette.panel, borderColor: palette.line },
  defectChipLabel: { fontSize: 12.5, fontWeight: '600' },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipCheck: { fontSize: 12, fontWeight: '800', lineHeight: 14 },
  chipSpinner: { transform: [{ scale: 0.7 }], marginHorizontal: -3 },

  customRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  compact: { paddingHorizontal: 12, paddingVertical: 8, minHeight: 40 },
  unitDefectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: palette.lineSoft,
  },
  measureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  measureLabel: { color: palette.ink, fontSize: 13.5, flex: 1 },
  measureInput: { flex: 0, width: 110, textAlign: 'right' },
});
