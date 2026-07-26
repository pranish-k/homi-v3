import { ActivityIndicator, View, useColorScheme } from 'react-native';

import { authClient } from '@/auth/client';
import SignInScreen from '@/auth/SignInScreen';
import HouseGate from '@/houses/HouseGate';
import { shared, colors } from '@/ui/theme';

// HOMI-31: session gate - signed out goes to passwordless sign-in.
// HOMI-32: signed in hands off to the house gate, which decides between
// creating or joining a house and opening it.
export default function Index() {
  const dark = useColorScheme() === 'dark';
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <View style={[shared.screen, dark && shared.screenDark]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!session) return <SignInScreen />;

  return <HouseGate />;
}
