import { PropsWithChildren, ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAppTheme } from '../theme';

type ScreenProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
  onBack?: () => void;
  headerAction?: ReactNode;
  footer?: ReactNode;
}>;

export const Screen = ({ title, subtitle, eyebrow, onBack, headerAction, footer, children }: ScreenProps) => {
  const { colors, dark } = useAppTheme();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']} onAccessibilityEscape={onBack}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          {onBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Voltar" accessibilityHint={`Voltar a partir da tela ${title}`} focusable hitSlop={8} onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceContainer }]}> 
              <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
            </Pressable>
          ) : null}
          <View style={styles.headerText}>
            {eyebrow ? <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow.toUpperCase()}</Text> : null}
            <Text accessibilityRole="header" style={[styles.title, { color: colors.onSurface }]}>{title}</Text>
          </View>
          {headerAction ? <View>{headerAction}</View> : null}
        </View>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant }]}>{footer}</View> : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 14, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, gap: 2 },
  back: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1.1 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.4 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 }
});
