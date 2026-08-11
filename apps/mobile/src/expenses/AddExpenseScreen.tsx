import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { newIdempotencyKey } from '@/api/client';
import { authClient } from '@/auth/client';
import { useHouse } from '@/houses/HouseContext';
import { getSnapshot, memberName, type SnapshotMember } from '@/houses/snapshot';
import { useTheme } from '@/ui/ThemeProvider';
import { formatMoney, parseAmountToCents } from '@/ui/format';
import { radius, spacing } from '@/ui/tokens';
import { Button, Input, Loading, Screen, SectionHeader, Text } from '@/ui/components';
import { createExpense, type SplitMode } from './api';

/**
 * HOMI-34: add an expense in under 15 seconds, which is the R1 release
 * gate. The layout order IS the design (DESIGN_DIRECTION.md section 8):
 * amount first with the keyboard already up, then who paid defaulting to
 * you, then the split defaulting to equal, then an optional description.
 * Someone who accepts every default reaches the button having typed only
 * an amount.
 */
export default function AddExpenseScreen() {
  const house = useHouse();
  const { colors } = useTheme();
  const { data: session } = authClient.useSession();
  const viewerId = session?.user.id;

  const [members, setMembers] = useState<SnapshotMember[] | undefined>();
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | undefined>();
  const [mode, setMode] = useState<SplitMode>('equal');
  const [exact, setExact] = useState<Record<string, string>>({});
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /**
   * Generated once per submit and reused while that submit is being
   * retried; cleared only after one succeeds. Regenerating on retry would
   * post a second expense (H1).
   */
  const pendingKey = useRef<string | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      getSnapshot(house.id).then(
        (snapshot) => setMembers(snapshot.members),
        (err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the house.'),
      );
    }, [house.id]),
  );

  const amountCents = parseAmountToCents(amount);
  const payer = paidBy ?? viewerId;

  const exactTotal = useMemo(
    () =>
      Object.values(exact).reduce((sum, value) => sum + (parseAmountToCents(value) ?? 0), 0),
    [exact],
  );

  const exactMismatch =
    mode === 'exact' && amountCents !== undefined && exactTotal !== amountCents;

  const canSubmit =
    amountCents !== undefined && payer !== undefined && members !== undefined && !exactMismatch;

  const submit = () => {
    if (busy || members === undefined || payer === undefined) return;
    if (amountCents === undefined || exactMismatch) return;
    setBusy(true);
    setError(undefined);
    pendingKey.current ??= newIdempotencyKey();

    const participants = members.map((m) => m.userId);
    createExpense(
      house.id,
      {
        // The API requires a description; the design makes it optional so
        // an amount alone is a valid expense, so the default lives here
        // rather than loosening the ledger schema.
        description: description.trim() || 'Expense',
        amountCents,
        paidBy: payer,
        mode,
        participants,
        ...(mode === 'exact'
          ? {
              exactCents: Object.fromEntries(
                participants.map((id) => [id, parseAmountToCents(exact[id] ?? '') ?? 0]),
              ),
            }
          : {}),
      },
      pendingKey.current,
    ).then(
      () => {
        pendingKey.current = undefined; // this submit is done; the next one is a new expense
        setBusy(false);
        setAmount('');
        setDescription('');
        setExact({});
        setMode('equal');
        setPaidBy(undefined);
        router.navigate('/home');
      },
      (err: unknown) => {
        // The key is deliberately kept, so tapping again retries the same
        // expense instead of creating a second one.
        setBusy(false);
        setError(err instanceof Error ? err.message : 'Could not add the expense.');
      },
    );
  };

  if (members === undefined) {
    return (
      <Screen center>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text variant="title">Add an expense</Text>

      <Input
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
        autoFocus
        code
        editable={!busy}
      />

      <SectionHeader title="Paid by" />
      <View style={styles.chips}>
        {members.map((member) => {
          const selected = member.userId === payer;
          return (
            <Pressable
              key={member.userId}
              onPress={() => setPaidBy(member.userId)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.ink : 'transparent',
                  borderColor: selected ? colors.ink : colors.border,
                },
              ]}
            >
              <Text variant="label" style={{ color: selected ? colors.onInk : colors.textPrimary }}>
                {member.userId === viewerId ? 'You' : memberName(member)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionHeader title="Split" />
      <View style={styles.chips}>
        {(['equal', 'exact'] as const).map((option) => {
          const selected = option === mode;
          return (
            <Pressable
              key={option}
              onPress={() => setMode(option)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? colors.ink : 'transparent',
                  borderColor: selected ? colors.ink : colors.border,
                },
              ]}
            >
              <Text variant="label" style={{ color: selected ? colors.onInk : colors.textPrimary }}>
                {option === 'equal' ? 'Split equally' : 'Exact amounts'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {mode === 'equal' ? (
        <Text variant="caption" tone="tertiary">
          {amountCents === undefined
            ? `Split evenly between ${members.length} ${members.length === 1 ? 'person' : 'people'}.`
            : `${formatMoney(Math.round(amountCents / members.length), house.currency)} each, across ${members.length}. HOMI settles the odd cent.`}
        </Text>
      ) : (
        <View style={styles.exact}>
          {members.map((member) => (
            <Input
              key={member.userId}
              label={member.userId === viewerId ? 'You' : memberName(member)}
              value={exact[member.userId] ?? ''}
              onChangeText={(value) => setExact((prev) => ({ ...prev, [member.userId]: value }))}
              placeholder="0.00"
              keyboardType="decimal-pad"
              editable={!busy}
            />
          ))}
          {exactMismatch && amountCents !== undefined && (
            <Text variant="caption" tone="negative">
              These add up to {formatMoney(exactTotal, house.currency)}, not{' '}
              {formatMoney(amountCents, house.currency)}.
            </Text>
          )}
        </View>
      )}

      <SectionHeader title="What was it?" />
      <Input
        value={description}
        onChangeText={setDescription}
        placeholder="Groceries (optional)"
        autoCapitalize="sentences"
        maxLength={200}
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={submit}
      />

      {error !== undefined && (
        <Text variant="caption" tone="negative">
          {error}
        </Text>
      )}

      <Button label="Add expense" onPress={submit} loading={busy} disabled={!canSubmit} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  exact: { gap: spacing.md },
});
