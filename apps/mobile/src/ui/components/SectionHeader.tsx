import { StyleSheet, View } from 'react-native';

import { spacing } from '../tokens';
import Text from './Text';

/** The muted uppercase rule above a group, such as ACTIVITY on HOME. */
export default function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <Text variant="overline" tone="tertiary">
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.lg, paddingBottom: spacing.xs },
});
