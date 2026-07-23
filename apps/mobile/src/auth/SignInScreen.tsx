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

// HOMI-31: two passwordless channels. The code is primary because it is
// deep-link-free - the user types it in and the session lands on this
// request, so sign-in can never be stranded in a browser. The magic link
// stays as a one-tap secondary for when the homi:// bounce does work.
// Placeholder styling until Pranish gives visual direction (pre-HOMI-33).
type Phase =
  | { state: 'form' } // entering email, choosing a channel
  | { state: 'sendingCode' }
  | { state: 'code' } // code emailed, awaiting entry
  | { state: 'verifying' } // checking the entered code
  | { state: 'sendingLink' }
  | { state: 'linkSent' };

export default function SignInScreen() {
  const dark = useColorScheme() === 'dark';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [phase, setPhase] = useState<Phase>({ state: 'form' });
  const [error, setError] = useState<string | undefined>();

  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = name.trim();
  const validEmail = /.+@.+\..+/.test(trimmedEmail);
  const busy =
    phase.state === 'sendingCode' || phase.state === 'sendingLink' || phase.state === 'verifying';
  const otpDigits = otp.replace(/\D/g, '');
  const canVerify = otpDigits.length === 6 && phase.state !== 'verifying';

  const sendFailure = (err: { status?: number; message?: string }): string =>
    err.status === 429
      ? 'Too many sign-in emails requested. Wait a few minutes and try again.'
      : (err.message ?? 'Could not send the sign-in email. Check your connection and retry.');

  const sendCode = async () => {
    setError(undefined);
    setPhase({ state: 'sendingCode' });
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({
      email: trimmedEmail,
      type: 'sign-in',
    });
    if (err) {
      setPhase({ state: 'form' });
      setError(sendFailure(err));
      return;
    }
    setOtp('');
    setPhase({ state: 'code' });
  };

  const verifyCode = async () => {
    setError(undefined);
    setPhase({ state: 'verifying' });
    // name is applied only when this code signs up a first-time user
    // (HOMI-28), matching the magic-link path; ignored for returning users
    const { error: err } = await authClient.signIn.emailOtp({
      email: trimmedEmail,
      otp: otpDigits,
      ...(trimmedName ? { name: trimmedName } : {}),
    });
    if (err) {
      // stay on the code screen so the user can retry or resend
      setPhase({ state: 'code' });
      setError(
        err.status === 429
          ? 'Too many attempts. Request a new code and try again.'
          : 'That code is wrong or expired. Check it or request a new one.',
      );
      return;
    }
    // the session atom updates on sign-in; the index gate re-renders into the app
  };

  const sendLink = async () => {
    setError(undefined);
    setPhase({ state: 'sendingLink' });
    const { error: err } = await authClient.signIn.magicLink({
      email: trimmedEmail,
      ...(trimmedName ? { name: trimmedName } : {}),
    });
    if (err) {
      setPhase({ state: 'form' });
      setError(sendFailure(err));
      return;
    }
    setPhase({ state: 'linkSent' });
  };

  const restart = () => {
    setError(undefined);
    setOtp('');
    setPhase({ state: 'form' });
  };

  // Code entered by the user (primary path).
  if (phase.state === 'code' || phase.state === 'verifying') {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.container, dark && styles.containerDark]}
      >
        <Text style={[styles.title, dark && styles.textDark]}>Enter your code</Text>
        <Text style={[styles.body, dark && styles.textDark]}>
          We sent a 6-digit code to {trimmedEmail}.
        </Text>
        <TextInput
          style={[styles.input, styles.otpInput, dark && styles.inputDark]}
          placeholder="123456"
          placeholderTextColor="#888888"
          value={otp}
          onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          editable={phase.state !== 'verifying'}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          onPress={verifyCode}
          disabled={!canVerify}
          style={[styles.button, !canVerify && styles.buttonDisabled]}
        >
          {phase.state === 'verifying' ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonLabel}>Verify and sign in</Text>
          )}
        </Pressable>
        <Pressable onPress={sendCode} disabled={busy} style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Resend code</Text>
        </Pressable>
        <Pressable onPress={restart} disabled={busy} style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Use a different email</Text>
        </Pressable>
      </KeyboardAvoidingView>
    );
  }

  // Magic link sent (secondary path).
  if (phase.state === 'linkSent') {
    return (
      <View style={[styles.container, dark && styles.containerDark]}>
        <Text style={[styles.title, dark && styles.textDark]}>Check your email</Text>
        <Text style={[styles.body, dark && styles.textDark]}>
          We sent a sign-in link to {trimmedEmail}. Open it on this phone.
        </Text>
        <Pressable onPress={restart} style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Use a different email</Text>
        </Pressable>
      </View>
    );
  }

  // Email entry + channel choice.
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
        editable={!busy}
      />
      <TextInput
        style={[styles.input, dark && styles.inputDark]}
        placeholder="Your name (first sign-in only)"
        placeholderTextColor="#888888"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        editable={!busy}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        onPress={sendCode}
        disabled={!validEmail || busy}
        style={[styles.button, (!validEmail || busy) && styles.buttonDisabled]}
      >
        {phase.state === 'sendingCode' ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonLabel}>Email me a code</Text>
        )}
      </Pressable>
      <Pressable onPress={sendLink} disabled={!validEmail || busy} style={styles.secondary}>
        {phase.state === 'sendingLink' ? (
          <ActivityIndicator color="#208AEF" />
        ) : (
          <Text style={[styles.secondaryLabel, (!validEmail || busy) && styles.buttonDisabled]}>
            or send me a link instead
          </Text>
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
  otpInput: {
    textAlign: 'center',
    fontSize: 28,
    letterSpacing: 8,
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
