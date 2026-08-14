import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { useAppTheme } from '../theme';

export interface PaginatedOptionCardListProps<T> {
  items: T[];
  keyExtractor: (item: T) => string;
  titleForItem: (item: T) => string;
  descriptionForItem: (item: T) => string;
  isSelected: (item: T) => boolean;
  onPressItem: (item: T) => void;
  metaForItem?: (item: T) => string | undefined;
  isDisabled?: (item: T) => boolean;
  pageSize?: number;
  resetKey?: string;
  emptyText?: string;
  selectedAccessibilityHint?: string;
}

export const PaginatedOptionCardList = <T,>({
  items,
  keyExtractor,
  titleForItem,
  descriptionForItem,
  isSelected,
  onPressItem,
  metaForItem,
  isDisabled,
  pageSize = 10,
  resetKey = '',
  emptyText = 'Nenhuma opção encontrada.',
  selectedAccessibilityHint
}: PaginatedOptionCardListProps<T>) => {
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
      {visible.map((item) => {
        const selected = isSelected(item);
        const disabled = isDisabled?.(item) ?? false;
        const meta = metaForItem?.(item);
        const title = titleForItem(item);
        const description = descriptionForItem(item);
        return (
          <Card
            key={keyExtractor(item)}
            variant={selected ? 'hero' : 'outlined'}
            title={title}
            subtitle={description}
            onPress={disabled ? undefined : () => onPressItem(item)}
            accessibilityLabel={`${title}. ${description}. ${selected ? `Selecionado.${selectedAccessibilityHint ? ` ${selectedAccessibilityHint}` : ''}` : disabled ? 'Indisponível.' : 'Toque para selecionar.'}`}
          >
            {meta ? (
              <Text style={[styles.meta, { color: selected ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>
                {meta}
              </Text>
            ) : null}
          </Card>
        );
      })}

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
  wrapper: { gap: 10 },
  muted: { fontSize: 12, lineHeight: 17 },
  meta: { fontSize: 12, lineHeight: 17, fontWeight: '700' }
});
