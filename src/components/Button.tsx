import { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { useAppTheme } from '../theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';
  icon?: ComponentProps<typeof Ionicons>['name'];
  compact?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

export const Button = ({
  label,
  onPress,
  secondary = false,
  disabled = false,
  variant,
  icon,
  compact = false,
  accessibilityLabel,
  accessibilityHint,
  testID
}: ButtonProps) => {
  const { colors, radii } = useAppTheme();
  const resolvedVariant = variant ?? (secondary ? 'tonal' : 'filled');
  const palette: Record<typeof resolvedVariant, { backgroundColor: string; color: string; borderColor?: string }> = {
    filled: { backgroundColor: colors.primary, color: colors.onPrimary },
    tonal: { backgroundColor: colors.primaryContainer, color: colors.onPrimaryContainer },
    outlined: { backgroundColor: 'transparent', color: colors.primary, borderColor: colors.outline },
    text: { backgroundColor: 'transparent', color: colors.primary },
    danger: { backgroundColor: colors.errorContainer, color: colors.error }
  };
  const selected = palette[resolvedVariant];
  const containerStyle: ViewStyle = {
    backgroundColor: selected.backgroundColor,
    borderColor: selected.borderColor ?? 'transparent',
    borderRadius: radii.full,
    minHeight: 48,
    paddingHorizontal: compact ? 16 : 22
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      focusable={!disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.button, containerStyle, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
    >
      {icon ? <Ionicons name={icon} size={19} color={disabled ? colors.outline : selected.color} /> : null}
      <Text style={[styles.label, { color: disabled ? colors.outline : selected.color }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8
  },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.52 },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '800', textAlign: 'center' }
});
