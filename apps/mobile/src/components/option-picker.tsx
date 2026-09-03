/**
 * A minimal cross-platform select: a labelled field that opens a modal option
 * list. Extracted from /inspections/new when the company edit screen needed
 * the same control — one picker, not one per screen.
 *
 * INS-091: searchable (shared `filterOptions`, so web and mobile match alike),
 * an `emptyText` instead of a blank box, an optional "+ Add new…" footer that
 * hands control to the host (it never changes the value), 44pt rows.
 */
import { palette } from '@inspect/design-tokens';
import { filterOptions } from '@inspect/domain';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export function OptionPicker<T>(props: {
  label: string;
  value: T | null;
  options: T[];
  display: (v: T) => string;
  placeholder: string;
  onSelect: (v: T) => void;
  /** Show the search field even for short lists (default: > 6 options). */
  searchable?: boolean;
  emptyText?: string;
  createLabel?: string;
  onCreate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const showSearch = props.searchable ?? props.options.length > 6;
  const { options, display } = props;
  const filtered = useMemo(() => filterOptions(query, options, display), [query, options, display]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <Pressable style={styles.select} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={props.value == null ? styles.selectPlaceholder : styles.selectValue}>
          {props.value == null ? props.placeholder : props.display(props.value)}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.pickerBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.backdropTouch} onPress={close} />
          <View style={styles.pickerBody}>
            {showSearch ? (
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={palette.faint}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}
            <FlatList
              data={filtered}
              keyExtractor={(_, i) => String(i)}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {query ? 'No matches.' : (props.emptyText ?? 'Nothing to choose from yet.')}
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={styles.pickerRow}
                  onPress={() => {
                    props.onSelect(item);
                    close();
                  }}
                >
                  <Text style={styles.pickerRowText}>{props.display(item)}</Text>
                </Pressable>
              )}
            />
            {props.onCreate ? (
              <Pressable
                style={[styles.pickerRow, styles.createRow]}
                onPress={() => {
                  close();
                  props.onCreate?.();
                }}
              >
                <Text style={styles.createRowText}>{props.createLabel ?? '+ Add new…'}</Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
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
    minHeight: 44,
    justifyContent: 'center',
  },
  selectValue: { color: palette.ink, fontSize: 14 },
  selectPlaceholder: { color: palette.faint, fontSize: 14 },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,18,32,0.45)',
    justifyContent: 'center',
    padding: 32,
  },
  backdropTouch: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  pickerBody: {
    backgroundColor: palette.bg,
    borderRadius: 12,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  search: {
    height: 44,
    paddingHorizontal: 16,
    fontSize: 14,
    color: palette.ink,
    backgroundColor: palette.panel,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  pickerRow: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.lineSoft,
  },
  pickerRowText: { color: palette.ink, fontSize: 14 },
  emptyText: { color: palette.faint, fontSize: 13, padding: 16 },
  createRow: {
    borderBottomWidth: 0,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    backgroundColor: palette.panel,
  },
  createRowText: { color: palette.accent, fontSize: 14, fontWeight: '600' },
});
