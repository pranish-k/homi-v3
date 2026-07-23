import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { API_BASE } from '@/api/config';
import { authClient } from '@/auth/client';

type Phase = { state: 'form' } | { state: 'sending' } | { state: 'sent' };

// HOMI-31: magic-link sign-in. Email (plus name, applied on first
// sign-up only per HOMI-28) -> the API emails a link -> the user lands
// back in the app via homi://auth/verify. Placeholder styling until
// Pranish gives visual direction (pre-HOMI-33).
export default function SignInScreen() {
  const dark = useColorScheme() === 'dark';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>({ state: 'form' });
  const [error, setError] = useState<string | undefined>();

  const trimmedEmail = email.trim().toLowerCase();
  const canSend = /.+@.+\..+/.test(trimmedEmail) && phase.state !== 'sending';

  const send = async () => {
    setError(undefined);
    setPhase({ state: 'sending' });
    const trimmedName = name.trim();
    const { error: err } = await authClient.signIn.magicLink({
      email: trimmedEmail,
      ...(trimmedName ? { name: trimmedName } : {}),
    });
    if (err) {
      setPhase({ state: 'form' });
      setError(
        err.status === 429
          ? 'Too many sign-in emails requested. Wait a few minutes and try again.'
          : (err.message ?? 'Could not send the sign-in email. Check your connection and retry.'),
      );
      return;
    }
    setPhase({ state: 'sent' });
  };

  if (phase.state === 'sent') {
    return (
      <View style={[styles.container, dark && styles.containerDark]}>
        <Text style={[styles.title, dark && styles.textDark]}>Check your email</Text>
        <Text style={[styles.body, dark && styles.textDark]}>
          We sent a sign-in link to {trimmedEmail}. Open it on this phone.
        </Text>
        <Pressable onPress={() => setPhase({ state: 'form' })} style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Use a different email</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, dark && styles.containerDark]}
    >
      <Text style={[styles.title, dark && styles.textDark]}>HOMI</Text>
      <Text style={[styles.body, dark && styles.textDark]}>
        Sign in with your email. No password needed.
      </Text>
      <TextInput
        style={[styles.input, dark && styles.inputDark]}
        placeholder="you@example.com"
        placeholderTextColor="#888888"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        autoCorrect={false}
        editable={phase.state !== 'sending'}
      />
      <TextInput
        style={[styles.input, dark && styles.inputDark]}
        placeholder="Your name (first sign-in only)"
        placeholderTextColor="#888888"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        editable={phase.state !== 'sending'}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        onPress={send}
        disabled={!canSend}
        style={[styles.button, !canSend && styles.buttonDisabled]}
      >
        {phase.state === 'sending' ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonLabel}>Email me a sign-in link</Text>
        )}
      </Pressable>
      <Text style={styles.url}>{API_BASE}</Text>
    </KeyboardAvoidingView>
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
    fontSize: 40,
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
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111111',
  },
  inputDark: {
    borderColor: '#444444',
    color: '#ffffff',
  },
  error: {
    fontSize: 14,
    color: '#d0342c',
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#208AEF',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    paddingVertical: 10,
  },
  secondaryLabel: {
    color: '#208AEF',
    fontSize: 15,
    fontWeight: '600',
  },
  url: {
    marginTop: 12,
    fontSize: 12,
    color: '#888888',
  },
});
