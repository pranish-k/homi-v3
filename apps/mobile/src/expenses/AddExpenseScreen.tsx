import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { bindIdempotencyKey, IDEMPOTENCY_CONFLICT, type PendingRequest } from '@/api/idempotency';
import { authClient } from '@/auth/client';
import { useHouse } from '@/houses/HouseContext';
import { getSnapshot, memberName, type SnapshotMember } from '@/houses/snapshot';
import { useTheme } from '@/ui/ThemeProvider';
import { formatMoney, parseAmountToCents } from '@/ui/format';
import { radius, spacing } from '@/ui/tokens';
import { Button, EmptyState, Input, Loading, Screen, SectionHeader, Text } from '@/ui/components';
import { createExpense, type CreateExpenseInput, type SplitMode } from './api';
import { equalSplitPreview } from './split-preview';

/**
 * HOMI-34: add an expense in under 15 seconds, which is the R1 release
 * gate. The layout order IS the design (DESIGN_DIRECTION.md section 8):
 * amount first with the keyboard already up, then who paid defaulting to
 * you, then the split defaulting to equal, then an optional description.
 * Someone who accepts every default reaches the button having typed only
 * an amount.
 *
 * The `[+]` tab stays mounted, so a half-typed expense survives a trip to
 * another tab, but a finished one must not leak into the next: every
 * field, the error and the idempotency key live in `AddExpenseForm`, which
 * is remounted (keyed) after each successful add.
 */
export default function AddExpenseScreen() {
  const house = useHouse();

  const [members, setMembers] = useState<SnapshotMember[] | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [added, setAdded] = useState(0);

  const load = useCallback(() => {
    setLoadError(undefined);
    getSnapshot(house.id).then(
      (snapshot) => setMembers(snapshot.members),
      (err: unknown) =>
        setLoadError(err instanceof Error ? err.message : 'Could not load the house.'),
    );
  }, [house.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Without the members there is no form to show, so a failed first load
  // must say so and offer the fix, not spin forever.
  if (members === undefined && loadError !== undefined) {
    return (
      <Screen center>
        <EmptyState
          title="Could not load your house"
          body={loadError}
          action={{ label: 'Try again', onPress: load }}
        />
      </Screen>
    );
  }

  if (members === undefined) {
    return (
      <Screen center>
        <Loading />
      </Screen>
    );
  }

  return (
    <AddExpenseForm
      key={added}
      members={members}
      loadError={loadError}
      onAdded={() => {
        setAdded((n) => n + 1);
        router.navigate('/home');
      }}
    />
  );
}

function AddExpenseForm({
  members,
  loadError,
  onAdded,
}: {
  members: SnapshotMember[];
  loadError: string | undefined;
  onAdded: () => void;
}) {
  const house = useHouse();
  const { colors } = useTheme();
  const { data: session } = authClient.useSession();
  const viewerId = session?.user.id;

  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | undefined>();
  const [mode, setMode] = useState<SplitMode>('equal');
  const [exact, setExact] = useState<Record<string, string>>({});
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /**
   * Bound to the request body: reused while a failed submit is retried
   * unchanged (a fresh key per retry would post a second expense, H1), and
   * replaced when the form is edited, since the same key with a different
   * body is a 409. The form remounts after success, so the next expense
   * always starts without one.
   */
  const pending = useRef<PendingRequest | undefined>(undefined);

  // autoFocus fires on mount only, and this tab stays mounted: put the
  // keyboard back up on every arrival, which is the 15-second design.
  const amountInput = useRef<TextInput>(null);
  useFocusEffect(
    useCallback(() => {
      amountInput.current?.focus();
    }, []),
  );

  const shownError = error ?? loadError;

  const amountCents = parseAmountToCents(amount);
  const payer = paidBy ?? viewerId;

  const exactTotal = useMemo(
    () =>
      Object.values(exact).reduce((sum, value) => sum + (parseAmountToCents(value) ?? 0), 0),
    [exact],
  );

  const exactMismatch =
    mode === 'exact' && amountCents !== undefined && exactTotal !== amountCents;

  const canSubmit = amountCents !== undefined && payer !== undefined && !exactMismatch;

  const submit = () => {
    if (busy || payer === undefined) return;
    if (amountCents === undefined || exactMismatch) return;

    const participants = members.map((m) => m.userId);
    const input: CreateExpenseInput = {
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
    };
    setBusy(true);
    setError(undefined);
    pending.current = bindIdempotencyKey(pending.current, input, newIdempotencyKey);

    createExpense(house.id, input, pending.current.key).then(
      // This expense is done; the remount gives the next one a clean form
      // and a new key.
      onAdded,
      (err: unknown) => {
        setBusy(false);
        if (err instanceof ApiError && err.status === IDEMPOTENCY_CONFLICT) {
          // The key met a different request server-side, so whether an
          // earlier attempt landed is unknown. Never retry into a possible
          // duplicate: drop the key and point at the ledger.
          pending.current = undefined;
          setError('This may already have been added - check Home.');
          return;
        }
        // Otherwise the key is kept, so tapping again with the same form
        // retries the same expense instead of creating a second one.
        setError(err instanceof Error ? err.message : 'Could not add the expense.');
      },
    );
  };

  // "You" leads the payer chips, since it is the default and the common
  // case; snapshot order would put it wherever the viewer happened to join.
  // A placeholder roommate owes shares but cannot have paid (the ledger
  // rejects it, packages/ledger/src/posting.ts), so it is offered as a
  // participant only, never as a payer.
  const payerOrder = members
    .filter((m) => !m.isPlaceholder)
    .sort((a, b) => Number(b.userId === viewerId) - Number(a.userId === viewerId));

  // Everyone is a participant in v1, and the server gives each the floor
  // and the payer the leftover cents; the preview says exactly that.
  const equalPreview =
    amountCents === undefined ? undefined : equalSplitPreview(amountCents, members.length);
  const payerCovers =
    payer === viewerId ? 'You cover' : `${memberName(members.find((m) => m.userId === payer))} covers`;
  const people = `${members.length} ${members.length === 1 ? 'person' : 'people'}`;
  const equalCopy =
    equalPreview === undefined
      ? `Split evenly between ${people}.`
      : equalPreview.payerExtraCents === 0
        ? `${formatMoney(equalPreview.eachCents, house.currency)} each, across ${people}.`
        : `${formatMoney(equalPreview.eachCents, house.currency)} each, across ${people}. ` +
          `${payerCovers} the extra ${formatMoney(equalPreview.payerExtraCents, house.currency)}.`;

  return (
    <Screen scroll>
      <Text variant="title">Add an expense</Text>

      <Input
        ref={amountInput}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
        autoFocus
        amount
        editable={!busy}
      />

      <SectionHeader title="Paid by" />
      <View style={styles.chips}>
        {payerOrder.map((member) => {
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
          {equalCopy}
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

      {shownError !== undefined && (
        <Text variant="caption" tone="negative">
          {shownError}
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
