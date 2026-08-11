import { createContext, useContext, type ReactNode } from 'react';

import type { HouseSummary } from './api';

/**
 * HOMI-33: the house the tabs are showing. One house is the whole of v1
 * (multi-house switching is a later build), so this is a single value
 * rather than a switcher, and it is provided by the tab layout after the
 * membership is known - every tab can then assume it exists.
 */
const HouseContext = createContext<HouseSummary | undefined>(undefined);

export function HouseProvider({ house, children }: { house: HouseSummary; children: ReactNode }) {
  return <HouseContext.Provider value={house}>{children}</HouseContext.Provider>;
}

export function useHouse(): HouseSummary {
  const house = useContext(HouseContext);
  if (house === undefined) {
    throw new Error('useHouse must be used inside the (tabs) layout, which provides the house');
  }
  return house;
}
