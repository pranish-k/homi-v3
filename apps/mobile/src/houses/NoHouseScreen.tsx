import { useState } from 'react';
import * as Localization from 'expo-localization';

import { authClient } from '@/auth/client';
import { Button, Input, Screen, Text } from '@/ui/components';
import { createHouse } from './api';

/**
 * HOMI-32: what a signed-in user with no house sees. Creating asks for
 * the one thing only a human knows - the name; the timezone comes from
 * the device (it drives digests and day boundaries server-side) and
 * currency is USD until multi-currency is a real story.
 *
 * Joining is deliberately not a form: invites are links, not codes
 * (spec 4.3), so the joiner taps the link and lands on /join.
 */
export default function NoHouseScreen({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const trimmed = name.trim();

  const submit = () => {
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setError(undefined);
    createHouse(trimmed, Localization.getCalendars()[0]?.timeZone ?? 'UTC').then(
      () => {
        setBusy(false);
        onCreated();
      },
      (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : 'Could not create the house.');
      },
    );
  };

  return (
    <Screen center>
      <Text variant="title" center>
        Start a house
      </Text>
      <Text variant="body" tone="secondary" center>
        Name it something your roommates will recognise. You can invite them next.
      </Text>
      <Input
        value={name}
        error={error}
        onChangeText={setName}
        placeholder="Maple Street"
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={100}
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!busy}
      />
      <Button label="Create house" onPress={submit} loading={busy} disabled={trimmed.length === 0} />
      <Text variant="caption" tone="tertiary" center>
        Joining someone else&apos;s house? Tap the invite link they sent you.
      </Text>
      <Button label="Sign out" variant="secondary" onPress={() => void authClient.signOut()} />
    </Screen>
  );
}
