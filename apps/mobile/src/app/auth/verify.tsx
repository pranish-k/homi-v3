import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { authClient } from '@/auth/client';
import { EmptyState, Loading, Screen } from '@/ui/components';

// HOMI-31: deep-link target of the emailed sign-in link
// (homi://auth/verify?token=...). Verifying from inside the app puts the
// session cookie in the app's SecureStore; had the email pointed at the
// API's verify URL directly, the session would end up in Safari instead.
export default function VerifyScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [error, setError] = useState<string | undefined>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // tokens are single-use; never verify twice
    started.current = true;
    if (!token) {
      setError('This sign-in link is incomplete. Request a new one.');
      return;
    }
    void authClient.magicLink.verify({ query: { token } }).then(({ error: err }: { error: unknown }) => {
      if (err) {
        setError(
          'This sign-in link is invalid or has expired. Request a new one from the sign-in screen.',
        );
        return;
      }
      router.replace('/');
    });
  }, [token]);

  return (
    <Screen center>
      {error !== undefined ? (
        <EmptyState
          title="Sign-in failed"
          body={error}
          action={{ label: 'Back to sign-in', onPress: () => router.replace('/') }}
        />
      ) : (
        <Loading message="Signing you in…" />
      )}
    </Screen>
  );
}
