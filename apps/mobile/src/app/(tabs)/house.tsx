import { useHouse } from '@/houses/HouseContext';
import HouseScreen from '@/houses/HouseScreen';

// HOMI-33: HouseScreen was the whole signed-in app in HOMI-32; now that
// HOME owns balances and activity, it becomes the HOUSE tab, keeping the
// invite share sheet and sign-out where members can still find them.
export default function HouseTab() {
  return <HouseScreen house={useHouse()} />;
}
