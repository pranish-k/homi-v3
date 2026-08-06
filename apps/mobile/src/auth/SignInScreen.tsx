import { useState } from 'react';

import { API_BASE } from '@/api/config';
import { authClient } from '@/auth/client';
import { Button, Input, Screen, Text } from '@/ui/components';

// HOMI-31: two passwordless channels. The code is primary because it is
// deep-link-free - the user types it in and the session lands on this
// request, so sign-in can never be stranded in a browser. The magic link
// stays as a one-tap secondary for when the homi:// bounce does work.
type Phase =
  | { state: 'form' } // entering email, choosing a channel
  | { state: 'sendingCode' }
  | { state: 'code' } // code emailed, awaiting entry
  | { state: 'verifying' } // checking the entered code
  | { state: 'sendingLink' }
  | { state: 'linkSent' };

// HOMI-32: the join flow renders this in place, so it can say why
// sign-in is being asked for instead of dropping the user at a bare form.
export default function SignInScreen({ prompt }: { prompt?: string } = {}) {
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
      // stay on the code screen so the user can retry or resend.
      // Better Auth allows 3 wrong codes, then deletes the verification
      // and answers 403 TOO_MANY_ATTEMPTS - not 429, which only the send
      // paths produce - so the exhausted case is matched on that.
      setPhase({ state: 'code' });
      setError(
        err.status === 403
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
      <Screen center>
        <Text variant="title" center>
          Enter your code
        </Text>
        <Text variant="body" tone="secondary" center>
          We sent a 6-digit code to {trimmedEmail}.
        </Text>
        <Input
          code
          error={error}
          placeholder="123456"
          value={otp}
          onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          editable={phase.state !== 'verifying'}
        />
        <Button
          label="Verify and sign in"
          onPress={() => void verifyCode()}
          loading={phase.state === 'verifying'}
          disabled={!canVerify}
        />
        <Button
          label="Resend code"
          variant="secondary"
          onPress={() => void sendCode()}
          disabled={busy}
        />
        <Button label="Use a different email" variant="secondary" onPress={restart} disabled={busy} />
      </Screen>
    );
  }

  // Magic link sent (secondary path).
  if (phase.state === 'linkSent') {
    return (
      <Screen center>
        <Text variant="title" center>
          Check your email
        </Text>
        <Text variant="body" tone="secondary" center>
          We sent a sign-in link to {trimmedEmail}. Open it on this phone.
        </Text>
        <Button label="Use a different email" variant="secondary" onPress={restart} />
      </Screen>
    );
  }

  // Email entry + channel choice.
  return (
    <Screen center>
      <Text variant="display" center>
        HOMI
      </Text>
      <Text variant="body" tone="secondary" center>
        {prompt ?? 'Sign in with your email. No password needed.'}
      </Text>
      <Input
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        autoCorrect={false}
        editable={!busy}
      />
      <Input
        placeholder="Your name (first sign-in only)"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        editable={!busy}
      />
      {/* A send failure is about the request, not either field, so it
          sits on its own rather than hanging off the name input. */}
      {error !== undefined && (
        <Text variant="caption" tone="negative" center>
          {error}
        </Text>
      )}
      <Button
        label="Email me a code"
        onPress={() => void sendCode()}
        loading={phase.state === 'sendingCode'}
        disabled={!validEmail || busy}
      />
      <Button
        label="or send me a link instead"
        variant="secondary"
        onPress={() => void sendLink()}
        loading={phase.state === 'sendingLink'}
        disabled={!validEmail || busy}
      />
      <Text variant="caption" tone="tertiary" center>
        {API_BASE}
      </Text>
    </Screen>
  );
}
