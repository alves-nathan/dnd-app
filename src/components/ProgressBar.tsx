import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../theme';

export const ProgressBar = ({ value, label, showPercent = false }: { value: number; label?: string; showPercent?: boolean }) => {
  const { colors, radii } = useAppTheme();
  const normalized = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.wrapper} accessibilityRole="progressbar" accessibilityLabel={label ?? `Progresso: ${Math.round(normalized * 100)}%`} accessibilityValue={{ min: 0, max: 100, now: Math.round(normalized * 100), text: `${Math.round(normalized * 100)}%` }}>
      {label || showPercent ? (
        <View style={styles.labelRow}>
          {label ? <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>{label}</Text> : <View />}
          {showPercent ? <Text style={[styles.value, { color: colors.onSurface }]}>{Math.round(normalized * 100)}%</Text> : null}
        </View>
      ) : null}
      <View style={[styles.track, { backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.full }]}>
        <View style={[styles.fill, { width: `${normalized * 100}%`, backgroundColor: colors.primary, borderRadius: radii.full }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 7 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  value: { fontSize: 12, lineHeight: 16, fontWeight: '900' },
  track: { height: 8, overflow: 'hidden' },
  fill: { height: '100%' }
});

