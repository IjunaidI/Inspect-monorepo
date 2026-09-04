/**
 * The end-of-loop gate (INS-081): a loop ends only on a unit boundary. The
 * "uploads outstanding" case is handled by the upload sheet's finishing mode,
 * so this component covers the two server-side verdicts — a partial unit
 * (finish it or discard it whole) and no complete unit at all.
 */
import { palette } from '@inspect/design-tokens';
import { Pressable, Text, View } from 'react-native';

import type { CanSubmitResult } from '@/lib/capture-core';

import { ui } from './ui';

export function EndGate(props: {
  verdict: CanSubmitResult;
  items: { id: string; itemName: string }[];
  busy: boolean;
  onFinish: (cycleIndex: number) => void;
  onDiscard: (cycleIndex: number) => void;
  onCancel: () => void;
}) {
  const { verdict } = props;
  if (verdict.ok) return null;
  if (verdict.reason === 'queue-not-empty') {
    return (
      <View style={{ gap: 12 }}>
        <Text style={ui.gateTitle}>Photos still uploading</Text>
        <Text style={ui.gateText}>
          The loop can end once every photo is on the server — completeness is judged against what
          the server holds.
        </Text>
        <Pressable style={ui.btn} onPress={props.onCancel}>
          <Text style={ui.btnLabel}>OK</Text>
        </Pressable>
      </View>
    );
  }
  if (verdict.reason === 'no-complete-unit') {
    return (
      <View style={{ gap: 12 }}>
        <Text style={ui.gateTitle}>No complete unit yet</Text>
        <Text style={ui.gateText}>
          A loop can only be ended on a complete unit. Finish at least one unit first.
        </Text>
        <Pressable style={ui.btn} onPress={props.onCancel}>
          <Text style={ui.btnLabel}>OK</Text>
        </Pressable>
      </View>
    );
  }
  const { partial } = verdict;
  const missing = partial.missingItemIds
    .map((mid) => props.items.find((i) => i.id === mid)?.itemName ?? 'item')
    .join(', ');
  return (
    <View style={{ gap: 12 }}>
      <Text style={ui.gateTitle}>Unit {partial.cycleIndex + 1} is incomplete</Text>
      <Text style={ui.gateText}>
        Still missing: {missing}. A loop can only be ended on a complete unit — finish this one, or
        discard it whole.
      </Text>
      <Pressable style={ui.btn} onPress={() => props.onFinish(partial.cycleIndex)}>
        <Text style={ui.btnLabel}>Finish unit {partial.cycleIndex + 1}</Text>
      </Pressable>
      <Pressable
        style={[ui.btnGhost, ui.btnDanger]}
        disabled={props.busy}
        onPress={() => props.onDiscard(partial.cycleIndex)}
      >
        <Text style={[ui.btnGhostLabel, { color: palette.danger }]}>
          Discard unit {partial.cycleIndex + 1}
        </Text>
      </Pressable>
      <Pressable style={ui.btnGhost} onPress={props.onCancel}>
        <Text style={ui.btnGhostLabel}>Cancel</Text>
      </Pressable>
    </View>
  );
}
