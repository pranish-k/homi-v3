import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { authClient } from '@/auth/client';

// HOMI-31: deep-link target of the emailed sign-in link
// (homi://auth/verify?token=...). Verifying from inside the app puts the
// session cookie in the app's SecureStore; had the email pointed at the
// API's verify URL directly, the session would end up in Safari instead.
export default function VerifyScreen() {
  const dark = useColorScheme() === 'dark';
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
    <View style={[styles.container, dark && styles.containerDark]}>
      {error ? (
        <>
          <Text style={[styles.title, dark && styles.textDark]}>Sign-in failed</Text>
          <Text style={[styles.body, dark && styles.textDark]}>{error}</Text>
          <Pressable onPress={() => router.replace('/')} style={styles.button}>
            <Text style={styles.buttonLabel}>Back to sign-in</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color="#208AEF" />
          <Text style={[styles.body, dark && styles.textDark]}>Signing you in…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: '#ffffff',
  },
  containerDark: {
    backgroundColor: '#000000',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111111',
  },
  body: {
    fontSize: 15,
    color: '#111111',
    textAlign: 'center',
  },
  textDark: {
    color: '#ffffff',
  },
  button: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#208AEF',
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
