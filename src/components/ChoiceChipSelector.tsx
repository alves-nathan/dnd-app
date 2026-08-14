import { Text, View } from 'react-native';
import { mergeChoiceOptions, toggleChoice } from '../characters/choiceOptions';
import { useAppTheme } from '../theme';
import { PaginatedChipList } from './PaginatedChipList';

export interface ChoiceChipSelectorProps {
  title: string;
  options: readonly string[];
  selectedValues: string[];
  lockedSelectedValues?: string[];
  onChange: (values: string[]) => void;
  maximumSelections?: number;
  totalSelectionCount?: number;
  supportingText?: string;
  pageSize?: number;
  emptyText?: string;
  testIDPrefix?: string;
}

export const ChoiceChipSelector = ({
  title,
  options,
  selectedValues,
  lockedSelectedValues = [],
  onChange,
  maximumSelections,
  totalSelectionCount,
  supportingText,
  pageSize = 24,
  emptyText,
  testIDPrefix = 'choice'
}: ChoiceChipSelectorProps) => {
  const { colors } = useAppTheme();
  const effectiveCount = totalSelectionCount ?? selectedValues.length;
  const mergedOptions = mergeChoiceOptions(options, [...lockedSelectedValues, ...selectedValues]);
  const isLocked = (option: string) => lockedSelectedValues.includes(option);

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.onSurface, fontWeight: '800' }}>
        {title} ({maximumSelections === undefined ? effectiveCount : `${effectiveCount}/${maximumSelections}`})
      </Text>
      {supportingText ? (
        <Text style={{ color: colors.onSurfaceVariant, fontSize: 12, lineHeight: 17 }}>
          {supportingText}
        </Text>
      ) : null}
      <PaginatedChipList
        items={mergedOptions}
        keyExtractor={(option) => `${testIDPrefix}-${option}`}
        labelForItem={(option) => option}
        isSelected={(option) => selectedValues.includes(option) || isLocked(option)}
        isDisabled={(option) => isLocked(option) || (maximumSelections !== undefined && !selectedValues.includes(option) && effectiveCount >= maximumSelections)}
        onPressItem={(option) => { if (!isLocked(option)) onChange(toggleChoice(selectedValues, option, maximumSelections ?? Number.MAX_SAFE_INTEGER)); }}
        pageSize={pageSize}
        resetKey={`${testIDPrefix}:${lockedSelectedValues.join('|')}:${selectedValues.join('|')}:${maximumSelections ?? 'unlimited'}`}
        testIDForItem={(option) => `${testIDPrefix}-${option.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        emptyText={emptyText ?? 'Nenhuma opção disponível.'}
      />
    </View>
  );
};
