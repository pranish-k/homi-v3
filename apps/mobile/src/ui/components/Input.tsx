import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { radius, spacing, typography } from '../tokens';
import Text from './Text';

export type InputProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label?: string;
  error?: string;
  /** Centred, widely tracked digits for the one-time code field. */
  code?: boolean;
};

export default function Input({ label, error, code = false, ...rest }: InputProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.group}>
      {label !== undefined && (
        <Text variant="label" tone="secondary">
          {label}
        </Text>
      )}
      <TextInput
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.input,
          {
            borderColor: error !== undefined ? colors.negative : colors.border,
            color: colors.textPrimary,
            backgroundColor: colors.bg,
          },
          code && styles.code,
        ]}
        {...rest}
      />
      {error !== undefined && (
        <Text variant="caption" tone="negative">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { alignSelf: 'stretch', gap: spacing.xs },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.md,
    fontSize: typography.body.fontSize,
  },
  code: {
    textAlign: 'center',
    fontSize: typography.title.fontSize,
    letterSpacing: 8,
    paddingVertical: spacing.lg - 2,
  },
});
