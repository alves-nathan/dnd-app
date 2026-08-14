import { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../theme';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  description?: string;
};

export const Chip = ({ label, selected = false, onPress, icon, disabled = false, accessibilityLabel, accessibilityHint, testID, description }: ChipProps) => {
  const { colors, radii } = useAppTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (description ? `${label}. ${description}` : label)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      focusable={!disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        description ? styles.expandedChip : null,
        {
          borderRadius: radii.sm,
          backgroundColor: selected ? colors.secondaryContainer : colors.surface,
          borderColor: selected ? colors.secondary : colors.outlineVariant,
          opacity: disabled ? 0.5 : pressed ? 0.74 : 1
        }
      ]}
    >
      {selected ? <Ionicons name="checkmark" size={17} color={colors.onSecondaryContainer} style={description ? styles.expandedIcon : undefined} /> : icon ? <Ionicons name={icon} size={17} color={colors.onSurfaceVariant} style={description ? styles.expandedIcon : undefined} /> : null}
      <View style={styles.textContent}>
        <Text style={[styles.label, { color: selected ? colors.onSecondaryContainer : colors.onSurface }]}>{label}</Text>
        {description ? (
          <Text style={[styles.description, { color: selected ? colors.onSecondaryContainer : colors.onSurfaceVariant }]}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  chip: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  expandedChip: { width: '100%', alignItems: 'flex-start', justifyContent: 'flex-start' },
  expandedIcon: { marginTop: 1 },
  textContent: { flexShrink: 1, gap: 4 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  description: { fontSize: 12, lineHeight: 17, fontWeight: '500' }
});

