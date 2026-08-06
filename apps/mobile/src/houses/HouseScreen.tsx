import { useState } from 'react';
import { Share } from 'react-native';

import { authClient } from '@/auth/client';
import { Button, Row, Screen, Text } from '@/ui/components';
import { createInvite, type HouseSummary } from './api';

/**
 * HOMI-32: proof the user is in a house, and the place invites come
 * from. Balances, members, and the feed arrive with the real HOME tab
 * (HOMI-33), which replaces this screen.
 */
export default function HouseScreen({ house }: { house: HouseSummary }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const invite = () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    createInvite(house.id).then(
      async ({ url }) => {
        setBusy(false);
        // The OS sheet is the whole point: invites travel through
        // whatever thread the roommates already use.
        await Share.share({ message: `Join ${house.name} on HOMI: ${url}` });
      },
      (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : 'Could not create an invite link.');
      },
    );
  };

  return (
    <Screen scroll>
      <Text variant="title">{house.name}</Text>
      <Row label="Your role" value={house.role === 'admin' ? 'Admin' : 'Member'} />
      <Row label="Currency" value={house.currency} divider={false} />
      {error !== undefined && (
        <Text variant="caption" tone="negative">
          {error}
        </Text>
      )}
      {/* Only admins can mint invites server-side (HOMI-8), so members
          are not offered a button that would 403. */}
      {house.role === 'admin' && (
        <Button label="Invite a roommate" onPress={invite} loading={busy} />
      )}
      <Button label="Sign out" variant="secondary" onPress={() => void authClient.signOut()} />
    </Screen>
  );
}
