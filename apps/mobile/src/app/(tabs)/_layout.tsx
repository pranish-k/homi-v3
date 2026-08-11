import { useCallback, useState } from 'react';
import { Redirect, Tabs, useFocusEffect } from 'expo-router';

import { listHouses, type HouseSummary } from '@/houses/api';
import { HouseProvider } from '@/houses/HouseContext';
import { useTheme } from '@/ui/ThemeProvider';
import { EmptyState, Icon, Loading, Screen } from '@/ui/components';

/**
 * HOMI-33: the app's real navigation. Until now the signed-in app was
 * conditional rendering inside index.tsx; the tab bar needs actual routes.
 *
 * v1 ships HOME, the `[+]` create tab (HOMI-34), and HOUSE. MONEY and
 * CHORES from the spec's five-tab map stay out until they have something
 * behind them - an empty tab is a dead control.
 *
 * The house is resolved once here and handed to every tab through
 * HouseProvider, so no tab has to re-derive it.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  const [houses, setHouses] = useState<HouseSummary[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(() => {
    setError(undefined);
    listHouses().then(setHouses, (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not load your house.');
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

  const house = houses[0];
  // Left the house (or the last one) while the tabs were mounted: the
  // root gate owns the create-or-join fork, so hand back to it.
  if (!house) return <Redirect href="/" />;

  return (
    <HouseProvider house={house}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <Icon name="home-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="add"
          options={{
            title: 'Add',
            tabBarIcon: ({ color, size }) => (
              <Icon name="add-circle-outline" color={color} size={size + 4} />
            ),
          }}
        />
        <Tabs.Screen
          name="house"
          options={{
            title: 'House',
            tabBarIcon: ({ color, size }) => <Icon name="people-outline" color={color} size={size} />,
          }}
        />
      </Tabs>
    </HouseProvider>
  );
}
