import type { Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { radius, spacing, typography } from '../tokens';
import Text from './Text';

export type InputProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label?: string;
  error?: string;
  /** Centred, widely tracked digits for the one-time code field. */
  code?: boolean;
  /**
   * Centred, large, tabular money entry. Not `code`: its wide tracking is
   * for reading a one-time code digit by digit, and on an amount it
   * prints "1 9 . 9 9".
   */
  amount?: boolean;
  /** For a screen that has to move focus itself (React 19 passes ref as a prop). */
  ref?: Ref<TextInput>;
};

export default function Input({
  label,
  error,
  code = false,
  amount = false,
  ref,
  ...rest
}: InputProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.group}>
      {label !== undefined && (
        <Text variant="label" tone="secondary">
          {label}
        </Text>
      )}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.input,
          {
            borderColor: error !== undefined ? colors.negative : colors.border,
            color: colors.textPrimary,
            backgroundColor: colors.bg,
          },
          code && styles.code,
          amount && styles.amount,
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
  amount: {
    textAlign: 'center',
    fontSize: typography.title.fontSize,
    fontWeight: typography.heading.fontWeight,
    fontVariant: ['tabular-nums'],
    paddingVertical: spacing.lg - 2,
  },
});
