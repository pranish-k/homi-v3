import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { palettes, radius, spacing } from '../tokens';
import Text from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Shows a spinner in place of the label and blocks presses. */
  loading?: boolean;
  disabled?: boolean;
};

/**
 * HOMI-36: buttons own their own loading state. Every screen used to
 * hand-roll `busy ? <ActivityIndicator color="#ffffff" /> : <Text>`, which
 * is where most of the duplicated hex in the app came from.
 *
 * Primary is ink, not a hue: the Calm Ledger palette spends colour on
 * money direction and nothing else.
 */
export default function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;

  // The destructive fill stays dark in both schemes, so its label is a
  // fixed light tone rather than the scheme-flipping onInk.
  const style = {
    primary: { filled: true, background: colors.ink, label: colors.onInk },
    destructive: { filled: true, background: colors.negative, label: palettes.light.onInk },
    secondary: { filled: false, background: 'transparent', label: colors.link },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        style.filled ? styles.filled : styles.text,
        { backgroundColor: style.background },
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        // Sized to the label box so the button does not resize mid-press.
        <View style={styles.spinner}>
          <ActivityIndicator color={style.label} />
        </View>
      ) : (
        <Text variant="label" center style={{ color: style.label }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filled: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg - 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
  },
  text: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  inactive: { opacity: 0.4 },
  spinner: { height: 20, justifyContent: 'center' },
});
