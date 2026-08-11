import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { authClient } from '@/auth/client';
import { feedLine, relativeTime } from '@/houses/feed-copy';
import { getSnapshot, memberName, type Snapshot } from '@/houses/snapshot';
import { useRealtimeHints } from '@/houses/useRealtimeHints';
import { useHouse } from '@/houses/HouseContext';
import { useTheme } from '@/ui/ThemeProvider';
import { spacing } from '@/ui/tokens';
import { EmptyState, Loading, Money, Row, Screen, SectionHeader, Text } from '@/ui/components';

/**
 * HOMI-33: the answer to "what needs my attention?".
 *
 * Layout follows docs/design/DESIGN_DIRECTION.md section 7: action items
 * first as plain rows (HOMI asks quietly, never in a coloured banner),
 * then the net position, then per-member balances, then the feed head.
 */
export default function HomeScreen() {
  const house = useHouse();
  const { colors } = useTheme();
  const { data: session } = authClient.useSession();
  const viewerId = session?.user.id;

  const [snapshot, setSnapshot] = useState<Snapshot | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setError(undefined);
    return getSnapshot(house.id).then(setSnapshot, (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not load your house.');
    });
  }, [house.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // A realtime hint means "your copy is stale", never "here is the data".
  useRealtimeHints(house.id, () => void load());

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  if (error !== undefined && snapshot === undefined) {
    return (
      <Screen center>
        <EmptyState
          title="Could not load your house"
          body={error}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      </Screen>
    );
  }

  if (snapshot === undefined) {
    return (
      <Screen center>
        <Loading />
      </Screen>
    );
  }

  const { currency } = snapshot.house;
  const net = viewerId === undefined ? 0 : (snapshot.balances.net[viewerId] ?? 0);
  const others = snapshot.members.filter((m) => m.userId !== viewerId);

  /**
   * Per-member rows are the viewer's position against *that person*,
   * which lives in `pairwise`. A member's `net` is their standing against
   * the whole house and says nothing about what passes between the two of
   * you, so it must not be used here. Positive means they owe the viewer.
   */
  const between = new Map<string, number>();
  for (const p of snapshot.balances.pairwise) {
    if (p.from === viewerId) between.set(p.to, -p.amountCents);
    else if (p.to === viewerId) between.set(p.from, p.amountCents);
  }

  // Positive net means the house owes the viewer.
  const netLabel = net > 0 ? 'You are owed' : net < 0 ? 'You owe' : "You're settled up";

  return (
    <Screen
      scroll
      gap={0}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textSecondary} />}
    >
      <Text variant="title">{snapshot.house.name}</Text>

      {snapshot.actionItems.length > 0 && (
        <View style={styles.actions}>
          {snapshot.actionItems.map((item) => {
            if (item.type === 'settle_up') {
              const to = snapshot.members.find((m) => m.userId === item.toUserId);
              return (
                <Row
                  key={`settle-${item.toUserId}`}
                  label={`Pay ${memberName(to)}`}
                  value={<Money cents={item.amountCents} currency={currency} />}
                  divider={false}
                />
              );
            }
            const from = snapshot.members.find((m) => m.userId === item.fromUserId);
            return (
              <Row
                key={`confirm-${item.paymentId}`}
                label={`${memberName(from)} says they paid you`}
                detail={`You can dispute this until ${new Date(item.disputableUntil).toLocaleDateString()}`}
                value={<Money cents={item.amountCents} currency={currency} />}
                divider={false}
              />
            );
          })}
        </View>
      )}

      <View style={styles.balance}>
        {/* Capped so the label cannot outgrow the amount it introduces at
            the largest Dynamic Type sizes and invert the hierarchy. */}
        <Text variant="body" tone="secondary" maxFontSizeMultiplier={1.3}>
          {netLabel}
        </Text>
        {/* Settled is a state, not an amount: "You're settled up" already
            said it, and "$0.00" underneath only says it again. */}
        {net !== 0 && (
          <Money cents={net} currency={currency} variant="display" mode="direction" />
        )}
      </View>

      <View style={[styles.rule, { backgroundColor: colors.border }]} />

      {others.map((member, index) => {
        const owed = between.get(member.userId) ?? 0;
        return (
          <Row
            key={member.userId}
            label={memberName(member)}
            detail={
              member.isPlaceholder
                ? 'Has not joined yet'
                : owed > 0
                  ? 'Owes you'
                  : owed < 0
                    ? 'You owe'
                    : undefined
            }
            // A settled roommate is a state, not an amount, so it reads
            // as a word rather than "$0.00".
            value={
              owed === 0 ? (
                'Settled'
              ) : (
                <Money cents={owed} currency={currency} mode="direction" />
              )
            }
            divider={index < others.length - 1}
          />
        );
      })}

      <SectionHeader title="Activity" />
      {snapshot.feed.length === 0 ? (
        <Text variant="body" tone="secondary">
          Nothing has happened yet. Add your first expense and it shows up here.
        </Text>
      ) : (
        snapshot.feed.map((event) => (
          <View key={event.id} style={styles.event}>
            <Text variant="body">
              {feedLine(event, snapshot.members, viewerId, currency)}
            </Text>
            <Text variant="caption" tone="tertiary">
              {relativeTime(event.createdAt)}
            </Text>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { paddingTop: spacing.md },
  balance: { paddingTop: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xs },
  rule: { height: StyleSheet.hairlineWidth, marginBottom: spacing.xs },
  event: { paddingVertical: spacing.sm, gap: 2 },
});
