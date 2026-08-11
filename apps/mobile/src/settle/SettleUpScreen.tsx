import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { newIdempotencyKey } from '@/api/client';
import { useHouse } from '@/houses/HouseContext';
import { getSnapshot, memberName, type SnapshotMember } from '@/houses/snapshot';
import { useTheme } from '@/ui/ThemeProvider';
import { formatMoney, parseAmountToCents } from '@/ui/format';
import { radius, spacing } from '@/ui/tokens';
import { Button, Input, Loading, Money, Screen, SectionHeader, Text } from '@/ui/components';
import { DISPUTE_WINDOW_HOURS, methodLinks, recordPayment, type PaymentMethod } from './api';

const METHODS: PaymentMethod[] = ['venmo', 'cash_app', 'zelle', 'cash', 'other'];

/**
 * HOMI-35: settle up. One tap records the payment; the payment apps are
 * offered alongside, never required, because HOMI records the truth and
 * does not move the money (spec M4).
 *
 * The amount is pre-filled from what HOME says you owe, so the common
 * case is open-and-confirm. It stays editable for a part payment.
 */
export default function SettleUpScreen() {
  const house = useHouse();
  const { colors } = useTheme();
  const { to, amount: presetAmount } = useLocalSearchParams<{ to?: string; amount?: string }>();

  const [members, setMembers] = useState<SnapshotMember[] | undefined>();
  const [amount, setAmount] = useState(
    presetAmount === undefined ? '' : (Number(presetAmount) / 100).toFixed(2),
  );
  const [method, setMethod] = useState<PaymentMethod | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Held across retries so tapping again cannot record a second payment.
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
  const payee = members?.find((m) => m.userId === to);

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
    if (busy || to === undefined || amountCents === undefined) return;
    setBusy(true);
    setError(undefined);
    pendingKey.current ??= newIdempotencyKey();

    recordPayment(
      house.id,
      { toUser: to, amountCents, ...(method === undefined ? {} : { method }) },
      pendingKey.current,
    ).then(
      () => {
        pendingKey.current = undefined;
        setBusy(false);
        router.navigate('/home');
      },
      (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : 'Could not record the payment.');
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

      {error !== undefined && (
        <Text variant="caption" tone="negative">
          {error}
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
