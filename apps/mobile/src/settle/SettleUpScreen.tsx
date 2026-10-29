import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { bindIdempotencyKey, IDEMPOTENCY_CONFLICT, type PendingRequest } from '@/api/idempotency';
import { useHouse } from '@/houses/HouseContext';
import { getSnapshot, memberName, type SnapshotMember } from '@/houses/snapshot';
import { useTheme } from '@/ui/ThemeProvider';
import { formatMoney, parseAmountToCents } from '@/ui/format';
import { radius, spacing } from '@/ui/tokens';
import { Button, Input, Loading, Money, Screen, SectionHeader, Text } from '@/ui/components';
import { DISPUTE_WINDOW_HOURS, methodLinks, recordPayment, type PaymentMethod } from './api';

const METHODS: PaymentMethod[] = ['venmo', 'cash_app', 'zelle', 'cash', 'other'];

/** Integer cents from the route ("534") into the editable field ("5.34"). */
const presetToInput = (cents: string | undefined): string =>
  cents === undefined ? '' : (Number(cents) / 100).toFixed(2);

/**
 * HOMI-35: settle up. One tap records the payment; the payment apps are
 * offered alongside, never required, because HOMI records the truth and
 * does not move the money (spec M4).
 *
 * The amount is pre-filled from what HOME says you owe, so the common
 * case is open-and-confirm. It stays editable for a part payment.
 *
 * This route is a hidden tab, so the screen stays mounted between visits.
 * Everything a visit types or picks therefore lives in `SettleUpForm`,
 * keyed on the route params and on a visit counter bumped when the screen
 * loses focus: each arrival starts from the params it was opened with,
 * never from what the previous visit left behind (the previous payee's
 * amount, method, error, or idempotency key).
 */
export default function SettleUpScreen() {
  const house = useHouse();
  const { to, amount: presetAmount } = useLocalSearchParams<{ to?: string; amount?: string }>();

  const [members, setMembers] = useState<SnapshotMember[] | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [visit, setVisit] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setLoadError(undefined);
      getSnapshot(house.id).then(
        (snapshot) => setMembers(snapshot.members),
        (err: unknown) =>
          setLoadError(err instanceof Error ? err.message : 'Could not load the house.'),
      );
      // Leaving ends this settle-up: the next arrival gets a fresh form.
      return () => setVisit((n) => n + 1);
    }, [house.id]),
  );

  const payee = members?.find((m) => m.userId === to);

  if (members === undefined) {
    return (
      <Screen center>
        <Loading />
      </Screen>
    );
  }

  if (to === undefined || payee === undefined) {
    return (
      <Screen center>
        <Text variant="heading" center>
          Nothing to settle
        </Text>
        <Button label="Back to home" variant="secondary" onPress={() => router.navigate('/home')} />
      </Screen>
    );
  }

  return (
    <SettleUpForm
      key={`${to}|${presetAmount ?? ''}|${visit}`}
      payee={payee}
      presetAmount={presetAmount}
      loadError={loadError}
    />
  );
}

function SettleUpForm({
  payee,
  presetAmount,
  loadError,
}: {
  payee: SnapshotMember;
  presetAmount: string | undefined;
  loadError: string | undefined;
}) {
  const house = useHouse();
  const { colors } = useTheme();
  const to = payee.userId;

  const [amount, setAmount] = useState(presetToInput(presetAmount));
  const [method, setMethod] = useState<PaymentMethod | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Bound to the request body: an unchanged retry reuses the key, so
  // tapping again cannot record a second payment; an edited amount or
  // method is a new request and gets a new key instead of a 409.
  const pending = useRef<PendingRequest | undefined>(undefined);

  const amountCents = parseAmountToCents(amount);
  const shownError = error ?? loadError;

  const openMethodApp = async (chosen: PaymentMethod) => {
    setMethod(chosen);
    const url = methodLinks[chosen].url;
    if (url === undefined) return;
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    } catch {
      // Not having the app installed is not an error worth interrupting
      // the flow for: recording the payment is the part that matters.
    }
  };

  const submit = () => {
    if (busy || amountCents === undefined) return;
    const input = { toUser: to, amountCents, ...(method === undefined ? {} : { method }) };
    setBusy(true);
    setError(undefined);
    pending.current = bindIdempotencyKey(pending.current, input, newIdempotencyKey);

    recordPayment(house.id, input, pending.current.key).then(
      () => {
        pending.current = undefined;
        setBusy(false);
        router.navigate('/home');
      },
      (err: unknown) => {
        setBusy(false);
        if (err instanceof ApiError && err.status === IDEMPOTENCY_CONFLICT) {
          // Whether an earlier attempt landed is unknown; never retry into
          // a possible duplicate payment.
          pending.current = undefined;
          setError('This may already have been recorded - check Home.');
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not record the payment.');
      },
    );
  };

  return (
    <Screen scroll>
      <Text variant="title">Pay {memberName(payee)}</Text>

      {amountCents !== undefined && (
        <Money cents={-amountCents} currency={house.currency} variant="display" mode="direction" />
      )}

      <SectionHeader title="Amount" />
      <Input
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
        editable={!busy}
      />

      <SectionHeader title="How did you pay?" />
      <View style={styles.chips}>
        {METHODS.map((option) => {
          const selected = option === method;
          return (
            <Pressable
              key={option}
              onPress={() => void openMethodApp(option)}
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
                {methodLinks[option].label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" tone="tertiary">
        Opening Venmo, Cash App or Zelle just takes you to the app - HOMI does not move any money,
        it records that you paid.
      </Text>

      {shownError !== undefined && (
        <Text variant="caption" tone="negative">
          {shownError}
        </Text>
      )}

      <Button
        label={
          amountCents === undefined
            ? 'Record payment'
            : `Record ${formatMoney(amountCents, house.currency)} paid`
        }
        onPress={submit}
        loading={busy}
        disabled={amountCents === undefined}
      />
      <Text variant="caption" tone="tertiary" center>
        {memberName(payee)} can flag this for {DISPUTE_WINDOW_HOURS} hours if it does not look
        right.
      </Text>
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
});
