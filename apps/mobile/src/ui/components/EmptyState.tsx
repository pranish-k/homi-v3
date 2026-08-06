import { StyleSheet, View } from 'react-native';

import { spacing } from '../tokens';
import Button from './Button';
import Text from './Text';

export type EmptyStateProps = {
  title: string;
  body?: string;
  /** Copy stays direct and non-judgmental: state the fact, offer the fix. */
  action?: { label: string; onPress: () => void; loading?: boolean };
};

/** Nothing here yet, or something did not load. */
export default function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Text variant="heading" center>
        {title}
      </Text>
      {body !== undefined && (
        <Text variant="body" tone="secondary" center>
          {body}
        </Text>
      )}
      {action !== undefined && (
        <View style={styles.action}>
          <Button
            label={action.label}
            onPress={action.onPress}
            loading={action.loading ?? false}
            variant="primary"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  action: { alignSelf: 'stretch', paddingTop: spacing.sm },
});
