import { authClient } from '@/auth/client';
import SignInScreen from '@/auth/SignInScreen';
import HouseGate from '@/houses/HouseGate';
import { Loading, Screen } from '@/ui/components';

// HOMI-31: session gate - signed out goes to passwordless sign-in.
// HOMI-32: signed in hands off to the house gate, which decides between
// creating or joining a house and opening it.
export default function Index() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <Screen center>
        <Loading />
      </Screen>
    );
  }

  if (!session) return <SignInScreen />;

  return <HouseGate />;
}
