/**
 * Library tab (INS-096 M2) — the QA hub: loop presets, products, purchase
 * orders, companies, signed reports and (Org Owner) the team, with live counts
 * from `GET /dashboard/summary` and `GET /loop-presets`. Hidden from
 * inspectors at the tab layout.
 */
import { latestPresetPerName, roleAtLeast } from '@inspect/domain';
import type { DashboardSummaryDto, LoopPresetDto } from '@inspect/shared-types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, Header, IconTile, ListCard, ListRow, Screen, type IconName } from '@/components/ui';
import { fetchMissing } from '@/lib/fetch-missing';
import { client } from '@/lib/session';
import { useSession } from '@/lib/session-context';
import { text, theme } from '@/theme';

const { colors, space } = theme;

type Lists = { summary: DashboardSummaryDto; presets: LoopPresetDto[] };

export default function Library() {
  const router = useRouter();
  const { identity } = useSession();
  const owner = roleAtLeast(identity?.role, 'ORG_OWNER');
  const [lists, setLists] = useState<Partial<Lists>>({});

  // Pure fetch — setState only ever happens in `.then`.
  const fetchLists = (have: Partial<Lists>) =>
    fetchMissing<Lists>(have, {
      summary: () => client.get<DashboardSummaryDto>('/dashboard/summary'),
      presets: () => client.get<LoopPresetDto[]>('/loop-presets'),
    });

  useEffect(() => {
    fetchLists({}).then((result) => setLists(result.values));
  }, []);

  const load = useCallback(async (have: Partial<Lists>) => {
    const result = await fetchLists(have);
    setLists(result.values);
  }, []);

  const presets = lists.presets ? latestPresetPerName(lists.presets) : null;
  const mostUsed = lists.presets
    ? [...lists.presets].sort((a, b) => (b._count?.inspections ?? 0) - (a._count?.inspections ?? 0))[0]
    : null;
  const count = (n: number | undefined) => (n === undefined ? '' : n.toLocaleString('en-US'));

  const row = (icon: IconName, title: string, sub: string, value: string, href: string) => (
    <ListRow
      inset
      key={title}
      leading={<IconTile name={icon} tone="primary" size={40} />}
      title={title}
      subtitle={sub}
      trailing={value ? <Text style={styles.count}>{value}</Text> : undefined}
      chevron
      onPress={() => router.push(href as never)}
    />
  );

  return (
    <Screen header={<Header title="Library" />} onRefresh={() => load({})}>
      {mostUsed && (mostUsed._count?.inspections ?? 0) > 0 ? (
        <Card padded={20} style={styles.mostUsed}>
          <Text style={text('overline', colors.mutedForeground)}>Most used loop</Text>
          <View style={styles.mostUsedRow}>
            <View style={styles.mostUsedText}>
              <Text style={text('subheading')} numberOfLines={1}>
                {mostUsed.name}
              </Text>
              <Text style={text('caption', colors.mutedForeground)} numberOfLines={1}>
                v{mostUsed.version} · {mostUsed._count?.items ?? 0} shots · {mostUsed._count?.inspections ?? 0} inspections
              </Text>
            </View>
            <Button
              label="Duplicate"
              variant="secondary"
              size="sm"
              onPress={() => router.push(`/presets/new?from=${mostUsed.id}` as never)}
            />
          </View>
        </Card>
      ) : null}
      <ListCard>
        {row('inspections', 'Loop presets', 'Capture loops, one image per shot', count(presets?.length), '/presets')}
        {row('product', 'Products', 'Style numbers', count(lists.summary?.products), '/products')}
        {row('purchaseOrder', 'Purchase orders', 'Client · factory · quantity', count(lists.summary?.purchaseOrders), '/purchase-orders')}
        {row('company', 'Companies', 'Clients and factories', count(lists.summary?.companies), '/companies')}
        {row('signed', 'Signed reports', 'Ed25519-signed PDFs', count(lists.summary?.reports), '/reports')}
        {owner ? row('team', 'Team', 'Members and roles', '', '/users') : null}
      </ListCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mostUsed: { gap: space[3] },
  mostUsedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  mostUsedText: { flex: 1, minWidth: 0, gap: 2 },
  count: { ...text('label', colors.mutedForeground) },
});
