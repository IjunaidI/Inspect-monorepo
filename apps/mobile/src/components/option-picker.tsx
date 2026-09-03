/**
 * A minimal cross-platform select: a labelled field that opens a modal option
 * list. Extracted from /inspections/new when the company edit screen needed
 * the same control — one picker, not one per screen.
 */
import { palette } from '@inspect/design-tokens';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function OptionPicker<T>(props: {
  label: string;
  value: T | null;
  options: T[];
  display: (v: T) => string;
  placeholder: string;
  onSelect: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <Pressable style={styles.select} onPress={() => setOpen(true)}>
        <Text style={props.value == null ? styles.selectPlaceholder : styles.selectValue}>
          {props.value == null ? props.placeholder : props.display(props.value)}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade">
        <Pressable style={styles.pickerBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.pickerBody}>
            <ScrollView>
              {props.options.map((opt, i) => (
                <Pressable
                  key={i}
                  style={styles.pickerRow}
                  onPress={() => {
                    props.onSelect(opt);
                    setOpen(false);
                  }}
                >
                  <Text style={styles.pickerRowText}>{props.display(opt)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  fieldLabel: {
    color: palette.faint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  select: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 8,
    backgroundColor: palette.panel,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  selectValue: { color: palette.ink, fontSize: 14 },
  selectPlaceholder: { color: palette.faint, fontSize: 14 },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,18,32,0.45)',
    justifyContent: 'center',
    padding: 32,
  },
  pickerBody: {
    backgroundColor: palette.bg,
    borderRadius: 12,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  pickerRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: palette.lineSoft,
  },
  pickerRowText: { color: palette.ink, fontSize: 14 },
});
