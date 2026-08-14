import { useId } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { useAppTheme } from '../theme';

export const Field = ({ label, supportingText, errorText, ...props }: TextInputProps & { label: string; supportingText?: string; errorText?: string }) => {
  const { colors, radii } = useAppTheme();
  const labelId = useId();
  return (
    <View style={styles.wrapper}>
      <Text nativeID={labelId} style={[styles.label, { color: errorText ? colors.error : colors.onSurfaceVariant }]}>{label}</Text>
      <TextInput
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityLabelledBy={labelId}
        accessibilityHint={props.accessibilityHint ?? errorText ?? supportingText}
        {...props}
        style={[
          styles.input,
          { borderColor: errorText ? colors.error : colors.outline, backgroundColor: colors.surface, color: colors.onSurface, borderRadius: radii.sm },
          props.style
        ]}
        placeholderTextColor={colors.outline}
      />
      {errorText ? <Text accessibilityLiveRegion="polite" style={[styles.supporting, { color: colors.error }]}>{errorText}</Text> : supportingText ? <Text accessibilityLiveRegion="polite" style={[styles.supporting, { color: colors.onSurfaceVariant }]}>{supportingText}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  input: {
    borderWidth: 1,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  supporting: { fontSize: 12, lineHeight: 17, marginHorizontal: 4 }
});
