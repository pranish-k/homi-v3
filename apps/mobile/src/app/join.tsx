import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View, useColorScheme } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import SignInScreen from '@/auth/SignInScreen';
import { authClient } from '@/auth/client';
import { shared, colors } from '@/ui/theme';
import { acceptInvite, previewInvite, type InvitePreview } from '@/houses/api';

/**
 * HOMI-32: deep-link target of an invite link (homi://join?token=...),
 * reached from the API's /j/<token> interstitial.
 *
 * Accepting is an explicit tap, never automatic: an invite link arrives
 * in a group chat and can be opened by someone it was not meant for, and
 * a bound invite additionally claims a placeholder's ledger history - so
 * the house, the inviter, and any "join as Sam" are named first.
 *
 * A signed-out tap shows sign-in here rather than bouncing home, so the
 * token survives the round trip and the join resumes on this screen.
 */
export default function JoinScreen() {
  const dark = useColorScheme() === 'dark';
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { data: session, isPending } = authClient.useSession();
  const [preview, setPreview] = useState<InvitePreview | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This invite link is incomplete. Ask for a fresh one.');
      return;
    }
    if (isPending || !session) return; // preview needs a session
    previewInvite(token).then(setPreview, (err: unknown) => {
      setError(err instanceof Error ? err.message : 'This invite link is no longer valid.');
    });
  }, [token, session, isPending]);

  const join = useCallback(() => {
    if (!token || joining) return;
    setJoining(true);
    setError(undefined);
    acceptInvite(token).then(
      () => router.replace('/'),
      (err: unknown) => {
        setJoining(false);
        setError(err instanceof Error ? err.message : 'Could not join this house.');
      },
    );
  }, [token, joining]);

  if (error !== undefined) {
    return (
      <View style={[shared.screen, dark && shared.screenDark]}>
        <Text style={[shared.title, dark && shared.textDark]}>Invite problem</Text>
        <Text style={shared.error}>{error}</Text>
        <Pressable onPress={() => router.replace('/')} style={shared.button}>
          <Text style={shared.buttonLabel}>Continue to HOMI</Text>
        </Pressable>
      </View>
    );
  }

  if (isPending) {
    return (
      <View style={[shared.screen, dark && shared.screenDark]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Sign in first; this screen stays mounted, so the invite resumes with
  // the preview as soon as the session lands.
  if (!session) return <SignInScreen prompt="Sign in to accept your invite." />;

  if (preview === undefined) {
    return (
      <View style={[shared.screen, dark && shared.screenDark]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={shared.detail}>Checking your invite…</Text>
      </View>
    );
  }

  return (
    <View style={[shared.screen, dark && shared.screenDark]}>
      <Text style={[shared.title, dark && shared.textDark]}>{preview.houseName}</Text>
      <Text style={shared.detail}>{preview.invitedByName} invited you to this house.</Text>
      {preview.placeholderName !== null && (
        <Text style={[shared.body, dark && shared.textDark]}>
          You&apos;ll join as {preview.placeholderName} and pick up the expenses already logged
          under that name. Every line stays yours to review.
        </Text>
      )}
      <Pressable
        onPress={join}
        disabled={joining}
        style={[shared.button, joining && shared.buttonDisabled]}
      >
        {joining ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={shared.buttonLabel}>Join {preview.houseName}</Text>
        )}
      </Pressable>
      <Pressable onPress={() => router.replace('/')} style={shared.secondaryButton}>
        <Text style={shared.secondaryLabel}>Not now</Text>
      </Pressable>
    </View>
  );
}
