import { ComponentType, ReactElement, ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  FlatList,
  FlatListProps,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAppTheme } from '../theme';

type VirtualizedScreenProps<ItemT> = Omit<
  FlatListProps<ItemT>,
  | 'ListHeaderComponent'
  | 'ListFooterComponent'
  | 'ListEmptyComponent'
  | 'contentContainerStyle'
> & {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  onBack?: () => void;
  headerAction?: ReactNode;
  headerContent?: ReactNode;
  footerContent?: ReactNode;
  emptyContent?: ReactNode;
  fixedFooter?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  itemSeparatorHeight?: number;
};

/**
 * Screen shell backed by FlatList. Use it for screens whose primary content is
 * a potentially large collection. Header/footer forms remain part of the same
 * virtualized scroll container, avoiding FlatList-inside-ScrollView warnings.
 */
export function VirtualizedScreen<ItemT>({
  title,
  subtitle,
  eyebrow,
  onBack,
  headerAction,
  headerContent,
  footerContent,
  emptyContent,
  fixedFooter,
  contentContainerStyle,
  itemSeparatorHeight = 14,
  initialNumToRender = 10,
  maxToRenderPerBatch = 12,
  updateCellsBatchingPeriod = 40,
  windowSize = 7,
  keyboardShouldPersistTaps = 'handled',
  keyboardDismissMode = 'on-drag',
  ...listProps
}: VirtualizedScreenProps<ItemT>): ReactElement {
  const { colors, dark } = useAppTheme();

  const Header = (
    <View style={styles.block}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            accessibilityHint={`Voltar a partir da tela ${title}`}
            focusable
            hitSlop={8}
            onPress={onBack}
            style={[styles.back, { backgroundColor: colors.surfaceContainer }]}
          >
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
      {headerContent}
    </View>
  );

  const Footer = footerContent ? <View style={styles.block}>{footerContent}</View> : null;
  const Empty = emptyContent ? <View style={styles.block}>{emptyContent}</View> : null;
  const Separator: ComponentType = () => <View style={{ height: itemSeparatorHeight }} />;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']} onAccessibilityEscape={onBack}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <FlatList
        {...listProps}
        ListHeaderComponent={Header}
        ListFooterComponent={Footer}
        ListEmptyComponent={Empty}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        contentInsetAdjustmentBehavior="automatic"
        initialNumToRender={initialNumToRender}
        maxToRenderPerBatch={maxToRenderPerBatch}
        updateCellsBatchingPeriod={updateCellsBatchingPeriod}
        windowSize={windowSize}
        removeClippedSubviews
        contentContainerStyle={[styles.content, contentContainerStyle]}
      />
      {fixedFooter ? <View style={[styles.fixedFooter, { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant }]}>{fixedFooter}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  block: { gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, gap: 2 },
  back: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1.1 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.4 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  fixedFooter: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 }
});
