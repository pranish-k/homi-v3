import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { spacing } from '../tokens';
import Text from './Text';

export type RowProps = {
  label: string;
  /** A string renders as body text; anything else (a Money) renders as-is. */
  value?: ReactNode;
  detail?: string;
  onPress?: () => void;
  /** Hairline underneath. The last row in a group leaves this off. */
  divider?: boolean;
};

/**
 * The label-left, value-right list row: member balances, house details,
 * settings. Separation is a hairline, never a shadow.
 */
export default function Row({ label, value, detail, onPress, divider = true }: RowProps) {
  const { colors } = useTheme();

  const body = (
    <View style={[styles.row, divider && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={styles.labels}>
        <Text variant="body">{label}</Text>
        {detail !== undefined && (
          <Text variant="caption" tone="tertiary">
            {detail}
          </Text>
        )}
      </View>
      {typeof value === 'string' ? (
        <Text variant="bodyStrong" tone="secondary">
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );

  if (onPress === undefined) return body;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  labels: { flexShrink: 1, gap: 2 },
  pressed: { opacity: 0.6 },
});
