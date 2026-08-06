import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { spacing } from '../tokens';
import Text from './Text';

/**
 * The waiting state, used by every gate in the app. The spinner is ink,
 * because a spinner is not carrying meaning that deserves colour.
 */
export default function Loading({ message }: { message?: string } = {}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.textSecondary} />
      {message !== undefined && (
        <Text variant="caption" tone="secondary" center>
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.md },
});
