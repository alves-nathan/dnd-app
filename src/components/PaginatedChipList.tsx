import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { Chip } from './Chip';
import { useAppTheme } from '../theme';

export interface PaginatedChipListProps<T> {
  items: T[];
  keyExtractor: (item: T) => string;
  labelForItem: (item: T) => string;
  isSelected: (item: T) => boolean;
  onPressItem: (item: T) => void;
  isDisabled?: (item: T) => boolean;
  pageSize?: number;
  resetKey?: string;
  emptyText?: string;
  testIDForItem?: (item: T) => string;
  descriptionForSelectedItem?: (item: T) => string | undefined;
}

export const PaginatedChipList = <T,>({
  items,
  keyExtractor,
  labelForItem,
  isSelected,
  onPressItem,
  isDisabled,
  pageSize = 24,
  resetKey = '',
  emptyText = 'Nenhuma opção encontrada.',
  testIDForItem,
  descriptionForSelectedItem
}: PaginatedChipListProps<T>) => {
  const { colors } = useAppTheme();
  const [visibleCount, setVisibleCount] = useState(pageSize);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [pageSize, resetKey]);

  const orderedItems = useMemo(() => {
    const selected = items.filter(isSelected);
    const selectedKeys = new Set(selected.map(keyExtractor));
    return [...selected, ...items.filter((item) => !selectedKeys.has(keyExtractor(item)))];
  }, [items, isSelected, keyExtractor]);

  const visible = orderedItems.slice(0, visibleCount);
  const remaining = Math.max(0, orderedItems.length - visible.length);

  if (!items.length) {
    return <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>{emptyText}</Text>;
  }

  return (
    <View style={styles.wrapper} accessibilityLabel={`${items.length} opções disponíveis`}>
      <View style={styles.chips}>
        {visible.map((item) => {
          const selected = isSelected(item);
          return (
            <Chip
              key={keyExtractor(item)}
              label={labelForItem(item)}
              selected={selected}
              description={selected ? descriptionForSelectedItem?.(item) : undefined}
              disabled={isDisabled?.(item) ?? false}
              onPress={() => onPressItem(item)}
              testID={testIDForItem?.(item)}
            />
          );
        })}
      </View>
      <Text style={[styles.muted, { color: colors.onSurfaceVariant }]}>
        Exibindo {visible.length} de {orderedItems.length} opção(ões).
      </Text>
      {remaining > 0 ? (
        <Button
          label={`Mostrar mais (${Math.min(pageSize, remaining)} de ${remaining})`}
          variant="outlined"
          compact
          onPress={() => setVisibleCount((current) => current + pageSize)}
        />
      ) : orderedItems.length > pageSize ? (
        <Button
          label="Recolher lista"
          variant="text"
          compact
          onPress={() => setVisibleCount(pageSize)}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  muted: { fontSize: 12, lineHeight: 17 }
});
