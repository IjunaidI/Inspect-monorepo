/**
 * The bottom tab bar (INS-095): 64pt + the bottom inset, card surface at 95 %,
 * a top hairline, 24px Solar icon over a 10pt label, active = primary. Skips
 * routes expo-router hid with `href: null` (it marks them
 * `tabBarItemStyle: { display: 'none' }`). A light haptic on every switch.
 */
import type { IconName } from '@inspect/design-tokens';
import type { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_HEIGHT, font, theme } from '@/theme';

import { Icon } from './icon';

const { colors } = theme;

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** Route file name → icon. Every tab screen must appear here. */
const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  inspections: 'inspections',
  library: 'library',
  profile: 'profile',
};

export function TabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom + 6 },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const itemStyle = options.tabBarItemStyle as { display?: string } | undefined;
        if (itemStyle?.display === 'none') return null;
        const focused = state.index === index;
        const label =
          typeof options.title === 'string'
            ? options.title
            : typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : route.name;
        const color = focused ? colors.primary : colors.mutedForeground;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            testID={options.tabBarButtonTestID}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                void Haptics.selectionAsync().catch(() => {});
                navigation.navigate(route.name, route.params);
              }
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Icon name={TAB_ICONS[route.name] ?? 'widget'} size={24} color={color} />
            <Text style={[styles.label, { color, fontFamily: font('sans', focused ? 700 : 500) }]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 8,
    paddingHorizontal: 16,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pressed: { opacity: 0.7 },
  label: { fontSize: 10, lineHeight: 12 },
});
