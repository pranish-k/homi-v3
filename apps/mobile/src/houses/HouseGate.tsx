import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View, useColorScheme } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { shared, colors } from '@/ui/theme';
import { listHouses, type HouseSummary } from './api';
import HouseScreen from './HouseScreen';
import NoHouseScreen from './NoHouseScreen';

/**
 * HOMI-32: the fork a signed-in user lands on - no house yet means
 * create or join; a house means open it. Refetching on focus is what
 * makes the join deep link work: /join accepts the invite and routes
 * back here, and the new membership is picked up without any shared
 * store.
 */
export default function HouseGate() {
  const dark = useColorScheme() === 'dark';
  const [houses, setHouses] = useState<HouseSummary[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(() => {
    setError(undefined);
    listHouses().then(setHouses, (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not load your houses.');
    });
  }, []);

  useFocusEffect(load);

  if (error !== undefined) {
    return (
      <View style={[shared.screen, dark && shared.screenDark]}>
        <Text style={shared.error}>{error}</Text>
        <Pressable onPress={load} style={shared.button}>
          <Text style={shared.buttonLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (houses === undefined) {
    return (
      <View style={[shared.screen, dark && shared.screenDark]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // One house is the whole of v1; multi-house switching is a later
  // build, so the first membership is the house.
  const house = houses[0];
  return house ? <HouseScreen house={house} /> : <NoHouseScreen onCreated={load} />;
}
