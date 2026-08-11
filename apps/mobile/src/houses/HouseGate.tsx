import { useCallback, useState } from 'react';
import { Redirect, useFocusEffect } from 'expo-router';

import { EmptyState, Loading, Screen } from '@/ui/components';
import { listHouses, type HouseSummary } from './api';
import NoHouseScreen from './NoHouseScreen';

/**
 * HOMI-32: the fork a signed-in user lands on - no house yet means
 * create or join; a house means open it. Refetching on focus is what
 * makes the join deep link work: /join accepts the invite and routes
 * back here, and the new membership is picked up without any shared
 * store.
 *
 * HOMI-33: a house now hands off to the tab navigator rather than
 * rendering a screen inline. The tabs re-resolve the house themselves,
 * because a layout has to own the value it provides to its children.
 */
export default function HouseGate() {
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
      <Screen center>
        <EmptyState
          title="Could not load your house"
          body={error}
          action={{ label: 'Try again', onPress: load }}
        />
      </Screen>
    );
  }

  if (houses === undefined) {
    return (
      <Screen center>
        <Loading />
      </Screen>
    );
  }

  // One house is the whole of v1; multi-house switching is a later
  // build, so the first membership is the house.
  return houses[0] ? <Redirect href="/home" /> : <NoHouseScreen onCreated={load} />;
}
