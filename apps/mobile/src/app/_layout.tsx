import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/ui/ThemeProvider';

// HOMI-36: ThemeProvider resolves the colour scheme once for the whole
// app (app.json sets userInterfaceStyle "automatic"), and SafeAreaProvider
// feeds the insets that Screen pads with. Headers stay off: navigation
// chrome arrives with the tab bar in HOMI-33.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
