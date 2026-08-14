import { PropsWithChildren } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../theme';

type CardProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  /** Use only when the card does not contain Button, Chip, Field or another interactive control. */
  onPress?: () => void;
  variant?: 'elevated' | 'filled' | 'outlined' | 'hero';
  accessibilityLabel?: string;
}>;

export const Card = ({ title, subtitle, onPress, children, variant = 'outlined', accessibilityLabel }: CardProps) => {
  const { colors, radii } = useAppTheme();
  const variantStyle = {
    elevated: { backgroundColor: colors.surfaceContainerLow, borderColor: 'transparent' },
    filled: { backgroundColor: colors.surfaceContainer, borderColor: 'transparent' },
    outlined: { backgroundColor: colors.surface, borderColor: colors.outlineVariant },
    hero: { backgroundColor: colors.primaryContainer, borderColor: 'transparent' }
  }[variant];
  const shadowStyle: ViewStyle = Platform.select<ViewStyle>({
    web: { boxShadow: '0 5px 12px rgba(0, 0, 0, 0.08)' },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2
    }
  }) ?? {};
  const content = (
    <>
      {title ? <Text style={[styles.title, { color: variant === 'hero' ? colors.onPrimaryContainer : colors.onSurface }]}>{title}</Text> : null}
      {subtitle ? <Text style={[styles.subtitle, { color: variant === 'hero' ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>{subtitle}</Text> : null}
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join('. ')}
        accessibilityHint={title ? `Abrir ${title}` : "Abrir conteúdo"}
        focusable
        onPress={onPress}
        style={({ pressed }) => [styles.card, variantStyle, shadowStyle, { borderRadius: variant === 'hero' ? radii.lg : radii.md }, pressed ? styles.pressed : null]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.card, variantStyle, shadowStyle, { borderRadius: variant === 'hero' ? radii.lg : radii.md }]}>{content}</View>;
};

const styles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 10,
    borderWidth: 1
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '800' },
  subtitle: { fontSize: 13, lineHeight: 19 }
});
