import { StyleSheet, Text, View } from 'react-native';
import { formatNumber } from '../utils/format';
import { useAppTheme } from '../theme';

export const StatRow = ({ label, value, testID }: { label: string; value: string | number | undefined; testID?: string }) => {
  const { colors } = useAppTheme();
  return (
    <View testID={testID} style={styles.row} accessibilityLabel={`${label}: ${typeof value === 'number' ? formatNumber(value) : value ?? '-'}`}>
      <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.onSurface }]}>{typeof value === 'number' ? formatNumber(value) : value ?? '-'}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32, paddingVertical: 4, gap: 12 },
  label: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  value: { fontWeight: '800', fontSize: 14, lineHeight: 20, textAlign: 'right' }
});
