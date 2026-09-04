/**
 * Defects + measurements for the current unit (INS-081: tags are loop-global
 * and pin to a slot; the measurement sheet is filled once per unit). Extracted
 * from the capture screen unchanged in behaviour (INS-093).
 */
import { palette } from '@inspect/design-tokens';
import type { DefectCatalogDto, DefectSeverity, InspectionDto, MeasurementDto } from '@inspect/shared-types';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Cursor } from '@/lib/capture-core';

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
  cursor: Cursor;
  /** The slot holds a SERVER photo — a defect hangs off evidence the server has. */
  canTag: boolean;
  /** The slot's photo is still on its way up — explains why tagging waits. */
  pendingUpload: boolean;
  busy: boolean;
  readOnly: boolean;
  onTag: (item: DefectCatalogDto) => void;
  onCustom: (text: string, severity: DefectSeverity) => Promise<boolean>;
  onMeasure: (label: string, unit: string | undefined, value: string) => void;
}) {
  const { catalog, inspection, cursor, canTag, busy, readOnly } = props;
  const [customText, setCustomText] = useState('');
  const [customSeverity, setCustomSeverity] = useState<DefectSeverity>('MINOR');

  const unitDefects = (inspection.items ?? []).flatMap((item) =>
    (item.defects ?? [])
      .filter((d) => d.cycleIndex === cursor.cycleIndex)
      .map((d) => ({ ...d, itemName: item.itemName })),
  );
  const fields = inspection.loopPresetSnapshot?.measurementFields ?? [];

  return (
    <View style={{ gap: 16, paddingBottom: 24 }}>
      <View>
        <Text style={ui.sectionLabel}>Defect tags</Text>
        {!canTag && !readOnly ? (
          <Text style={ui.hint}>
            {props.pendingUpload
              ? 'This photo is still uploading — tags can be added the moment it lands.'
              : "Take this item's photo first — a defect is recorded against the shot it was seen on."}
          </Text>
        ) : null}
        {SEVERITIES.map((sev) => {
          const group = catalog.filter((c) => c.defaultSeverity === sev && !c.isArchived);
          if (!group.length) return null;
          return (
            <View key={sev} style={{ marginTop: 8 }}>
              <Text style={[styles.severityLabel, { color: TINT[sev].fg }]}>
                {sev.charAt(0) + sev.slice(1).toLowerCase()}
              </Text>
              <View style={styles.chipWrap}>
                {group.map((c) => (
                  <Pressable
                    key={c.id}
                    disabled={!canTag || busy || readOnly}
                    onPress={() => props.onTag(c)}
                    style={[
                      styles.defectChip,
                      { backgroundColor: TINT[sev].bg },
                      (!canTag || readOnly) && ui.dim,
                    ]}
                  >
                    <Text style={[styles.defectChipLabel, { color: TINT[sev].fg }]}>{c.name}</Text>
                  </Pressable>
                ))}
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
                  SEVERITIES[(SEVERITIES.indexOf(customSeverity) + 1) % SEVERITIES.length],
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
              key={`${cursor.cycleIndex}:${f.label}`}
              label={f.label}
              unit={f.unit}
              initial={
                measurementFor(inspection.measurements, cursor.cycleIndex, f.label)?.recordedValue ??
                ''
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
  defectChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36 },
  defectChipLabel: { fontSize: 12.5, fontWeight: '600' },
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
