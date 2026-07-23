import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { authClient } from '@/auth/client';
import SignInScreen from '@/auth/SignInScreen';

// HOMI-31: session gate. Signed out -> magic-link sign-in; signed in ->
// placeholder home proving the persistent cookie session (replaced by
// the real HOME tab in HOMI-33).
export default function Index() {
  const dark = useColorScheme() === 'dark';
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <View style={[styles.container, dark && styles.containerDark]}>
        <ActivityIndicator color="#208AEF" />
      </View>
    );
  }

  if (!session) return <SignInScreen />;

  return (
    <View style={[styles.container, dark && styles.containerDark]}>
      <Text style={[styles.title, dark && styles.textDark]}>HOMI</Text>
      <Text style={[styles.body, dark && styles.textDark]}>
        Signed in as {session.user.name || session.user.email}
      </Text>
      <Text style={styles.detail}>{session.user.email}</Text>
      <Pressable onPress={() => void authClient.signOut()} style={styles.signOut}>
        <Text style={styles.signOutLabel}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
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
    fontSize: 17,
    color: '#111111',
  },
  detail: {
    fontSize: 13,
    color: '#888888',
  },
  textDark: {
    color: '#ffffff',
  },
  signOut: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#208AEF',
  },
  signOutLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
