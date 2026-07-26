import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import * as Localization from 'expo-localization';

import { authClient } from '@/auth/client';
import { shared, colors } from '@/ui/theme';
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
  const dark = useColorScheme() === 'dark';
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
    <View style={[shared.screen, dark && shared.screenDark]}>
      <Text style={[shared.title, dark && shared.textDark]}>Start a house</Text>
      <Text style={shared.detail}>
        Name it something your roommates will recognise. You can invite them next.
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Maple Street"
        placeholderTextColor={colors.muted}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={100}
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!busy}
        style={[shared.input, dark && shared.inputDark]}
      />
      {error !== undefined && <Text style={shared.error}>{error}</Text>}
      <Pressable
        onPress={submit}
        disabled={trimmed.length === 0 || busy}
        style={[shared.button, (trimmed.length === 0 || busy) && shared.buttonDisabled]}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={shared.buttonLabel}>Create house</Text>
        )}
      </Pressable>
      <Text style={shared.detail}>
        Joining someone else&apos;s house? Tap the invite link they sent you.
      </Text>
      <Pressable onPress={() => void authClient.signOut()} style={shared.secondaryButton}>
        <Text style={shared.secondaryLabel}>Sign out</Text>
      </Pressable>
    </View>
  );
}
