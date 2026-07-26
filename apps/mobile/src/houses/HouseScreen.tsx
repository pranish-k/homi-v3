import { useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View, useColorScheme } from 'react-native';

import { authClient } from '@/auth/client';
import { shared } from '@/ui/theme';
import { createInvite, type HouseSummary } from './api';

/**
 * HOMI-32: proof the user is in a house, and the place invites come
 * from. Balances, members, and the feed arrive with the real HOME tab
 * (HOMI-33), which replaces this screen.
 */
export default function HouseScreen({ house }: { house: HouseSummary }) {
  const dark = useColorScheme() === 'dark';
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
    <View style={[shared.screen, dark && shared.screenDark]}>
      <Text style={[shared.title, dark && shared.textDark]}>{house.name}</Text>
      <Text style={shared.detail}>
        {house.role === 'admin' ? 'You are an admin' : 'You are a member'} · {house.currency}
      </Text>
      {error !== undefined && <Text style={shared.error}>{error}</Text>}
      {/* Only admins can mint invites server-side (HOMI-8), so members
          are not offered a button that would 403. */}
      {house.role === 'admin' && (
        <Pressable
          onPress={invite}
          disabled={busy}
          style={[shared.button, busy && shared.buttonDisabled]}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={shared.buttonLabel}>Invite a roommate</Text>
          )}
        </Pressable>
      )}
      <Pressable onPress={() => void authClient.signOut()} style={shared.secondaryButton}>
        <Text style={shared.secondaryLabel}>Sign out</Text>
      </Pressable>
    </View>
  );
}
