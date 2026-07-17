import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { divideRoomWeight } from './rooms';
import { SplitError } from './split';

describe('divideRoomWeight (HOMI-23)', () => {
  it('gives a lone occupant the whole room weight', () => {
    expect(divideRoomWeight(4000, ['a'])).toEqual({ a: 4000 });
  });

  it('splits an even weight equally across a couple', () => {
    expect(divideRoomWeight(5000, ['a', 'b'])).toEqual({ a: 2500, b: 2500 });
  });

  it('gives the odd basis point to the first occupant (earlier-joined)', () => {
    expect(divideRoomWeight(3333, ['first', 'second'])).toEqual({ first: 1667, second: 1666 });
  });

  it('handles more occupants than basis points divide evenly into', () => {
    expect(divideRoomWeight(10000, ['a', 'b', 'c'])).toEqual({ a: 3334, b: 3333, c: 3333 });
  });

  it('rejects empty, duplicate, and out-of-range inputs', () => {
    expect(() => divideRoomWeight(4000, [])).toThrow(SplitError);
    expect(() => divideRoomWeight(4000, ['a', 'a'])).toThrow(SplitError);
    expect(() => divideRoomWeight(0, ['a'])).toThrow(SplitError);
    expect(() => divideRoomWeight(10001, ['a'])).toThrow(SplitError);
    expect(() => divideRoomWeight(4000.5, ['a'])).toThrow(SplitError);
  });

  it('property: shares always sum to the room weight and differ by at most 1bp', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 6 }),
        (weightBp, n) => {
          const occupants = Array.from({ length: n }, (_, i) => `u${i}`);
          const shares = divideRoomWeight(weightBp, occupants);
          const values = Object.values(shares);
          expect(values.reduce((a, b) => a + b, 0)).toBe(weightBp);
          expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
