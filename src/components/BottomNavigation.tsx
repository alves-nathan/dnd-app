import { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme';

export type BottomNavigationItem = {
  key: string;
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
};

export const BottomNavigation = ({ items, activeKey }: { items: BottomNavigationItem[]; activeKey: string }) => {
  const { colors, radii } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingBottom: Math.max(8, insets.bottom), backgroundColor: colors.surface, borderTopColor: colors.outlineVariant }]} accessibilityRole="tablist">
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            accessibilityHint={`Abrir ${item.label}`}
            focusable
            onPress={item.onPress}
            style={({ pressed }) => [styles.item, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.indicator, { borderRadius: radii.full, backgroundColor: active ? colors.secondaryContainer : 'transparent' }]}>
              <Ionicons name={item.icon} size={22} color={active ? colors.onSecondaryContainer : colors.onSurfaceVariant} />
            </View>
            <Text style={[styles.label, { color: active ? colors.onSurface : colors.onSurfaceVariant }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { borderTopWidth: 1, paddingTop: 8, paddingHorizontal: 8, flexDirection: 'row' },
  item: { minHeight: 58, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  indicator: { minWidth: 62, height: 32, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, lineHeight: 15, fontWeight: '800' }
});
