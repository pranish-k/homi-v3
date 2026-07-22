import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { API_BASE } from '@/api/config';

type Check =
  | { state: 'checking' }
  | { state: 'ok' }
  | { state: 'error'; detail: string };

// Boot screen for HOMI-30 Half A: proves the phone-to-staging path by
// calling the API's public readiness probe. Replaced by real screens in HOMI-31+.
export default function BootScreen() {
  const [check, setCheck] = useState<Check>({ state: 'checking' });
  const dark = useColorScheme() === 'dark';

  const runCheck = useCallback(async () => {
    setCheck({ state: 'checking' });
    try {
      const res = await fetch(`${API_BASE}/readyz`);
      if (res.ok) {
        setCheck({ state: 'ok' });
      } else {
        setCheck({ state: 'error', detail: `HTTP ${res.status}` });
      }
    } catch (err) {
      setCheck({ state: 'error', detail: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const statusLine =
    check.state === 'checking'
      ? 'checking API…'
      : check.state === 'ok'
        ? 'API ready'
        : `API unreachable (${check.detail})`;

  return (
    <View style={[styles.container, dark && styles.containerDark]}>
      <Text style={[styles.title, dark && styles.textDark]}>HOMI</Text>
      <Text style={[styles.status, dark && styles.textDark]}>{statusLine}</Text>
      <Text style={styles.url}>{API_BASE}</Text>
      {check.state === 'error' && (
        <Pressable onPress={runCheck} style={styles.retry}>
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
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
  status: {
    fontSize: 17,
    color: '#111111',
  },
  textDark: {
    color: '#ffffff',
  },
  url: {
    fontSize: 12,
    color: '#888888',
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#208AEF',
  },
  retryLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
