import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import SignInScreen from '@/auth/SignInScreen';
import { authClient } from '@/auth/client';
import { Button, Card, EmptyState, Loading, Screen, Text } from '@/ui/components';
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
      <Screen center>
        <EmptyState
          title="Invite problem"
          body={error}
          action={{ label: 'Continue to HOMI', onPress: () => router.replace('/') }}
        />
      </Screen>
    );
  }

  if (isPending) {
    return (
      <Screen center>
        <Loading />
      </Screen>
    );
  }

  // Sign in first; this screen stays mounted, so the invite resumes with
  // the preview as soon as the session lands.
  if (!session) return <SignInScreen prompt="Sign in to accept your invite." />;

  if (preview === undefined) {
    return (
      <Screen center>
        <Loading message="Checking your invite…" />
      </Screen>
    );
  }

  return (
    <Screen center>
      <Text variant="title" center>
        {preview.houseName}
      </Text>
      <Text variant="body" tone="secondary" center>
        {preview.invitedByName} invited you to this house.
      </Text>
      {preview.placeholderName !== null && (
        <Card>
          <Text variant="bodyStrong">You&apos;ll join as {preview.placeholderName}</Text>
          <Text variant="body" tone="secondary">
            You&apos;ll pick up the expenses already logged under that name. Every line stays yours
            to review.
          </Text>
        </Card>
      )}
      <Button label={`Join ${preview.houseName}`} onPress={join} loading={joining} />
      <Button label="Not now" variant="secondary" onPress={() => router.replace('/')} />
    </Screen>
  );
}
