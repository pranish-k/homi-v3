import { SplitError } from './split';

/**
 * HOMI-23: a shared room's weight belongs to the room, not to one
 * person - a couple sharing the big room splits its basis points
 * between them. Integer division with a deterministic remainder rule
 * (leftover basis points go one each to the FIRST occupants in the
 * order given; callers order by joinedAt so the rule is stable), so the
 * per-house 10000bp invariant survives intact through computeSplits.
 */
export function divideRoomWeight(weightBp: number, occupants: string[]): Record<string, number> {
  if (!Number.isSafeInteger(weightBp) || weightBp < 1 || weightBp > 10000) {
    throw new SplitError('room weight must be between 1 and 10000 basis points');
  }
  if (occupants.length === 0) throw new SplitError('a room weight needs at least one occupant');
  if (new Set(occupants).size !== occupants.length) {
    throw new SplitError('room occupants must be distinct');
  }

  const base = Math.floor(weightBp / occupants.length);
  let remainder = weightBp - base * occupants.length;
  const shares: Record<string, number> = {};
  for (const occupant of occupants) {
    shares[occupant] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  return shares;
}
