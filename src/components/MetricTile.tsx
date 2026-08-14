import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../theme';

export const MetricTile = ({ label, value, supporting }: { label: string; value: string | number; supporting?: string }) => {
  const { colors, radii } = useAppTheme();
  return (
    <View style={[styles.tile, { backgroundColor: colors.surfaceContainerLow, borderRadius: radii.md }]} accessibilityLabel={`${label}: ${value}${supporting ? `. ${supporting}` : ''}`}>
      <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.onSurface }]} numberOfLines={1}>{value}</Text>
      {supporting ? <Text style={[styles.supporting, { color: colors.onSurfaceVariant }]} numberOfLines={1}>{supporting}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  tile: { minWidth: 104, flex: 1, padding: 14, gap: 3 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  value: { fontSize: 24, lineHeight: 29, fontWeight: '900', letterSpacing: -0.4 },
  supporting: { fontSize: 11, lineHeight: 15 }
});

