import type { ReactElement, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../ThemeProvider';
import { spacing } from '../tokens';

export type ScreenProps = {
  children: ReactNode;
  /** Vertically centred: the auth, gate, and single-decision screens. */
  center?: boolean;
  /** Content that can outgrow the viewport (lists, long copy). */
  scroll?: boolean;
  gap?: number;
  /** Pull-to-refresh. Requires `scroll`, since Screen owns the ScrollView. */
  refreshControl?: ReactElement<RefreshControlProps>;
};

/**
 * HOMI-36: the safe-area, padding, and keyboard container every screen
 * sits in. Before this, nothing in the app imported safe-area-context and
 * only the sign-in screen avoided the keyboard, which held together only
 * because every screen was a centred flex column.
 */
export default function Screen({
  children,
  center = false,
  scroll = false,
  gap = spacing.md,
  refreshControl,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const padding = {
    paddingTop: insets.top + spacing.lg,
    paddingBottom: insets.bottom + spacing.lg,
    paddingLeft: insets.left + spacing.xl,
    paddingRight: insets.right + spacing.xl,
  };

  const content = center
    ? [styles.content, styles.centered, { gap }]
    : [styles.content, { gap }];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: colors.bg }]}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={[content, padding, center && styles.grow]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[content, padding, styles.grow]}>{children}</View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grow: { flexGrow: 1 },
  content: { alignItems: 'stretch' },
  centered: { justifyContent: 'center' },
});
