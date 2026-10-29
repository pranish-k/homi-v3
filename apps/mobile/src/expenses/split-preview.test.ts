import { computeSplits } from '@homi/domain';
import { describe, expect, it } from 'vitest';

import { equalSplitPreview } from './split-preview';

describe('equalSplitPreview', () => {
  it('gives everyone the floor and the payer the leftover cents', () => {
    expect(equalSplitPreview(1000, 3)).toEqual({ eachCents: 333, payerExtraCents: 1 });
    expect(equalSplitPreview(1001, 3)).toEqual({ eachCents: 333, payerExtraCents: 2 });
    expect(equalSplitPreview(900, 3)).toEqual({ eachCents: 300, payerExtraCents: 0 });
    expect(equalSplitPreview(1, 2)).toEqual({ eachCents: 0, payerExtraCents: 1 });
  });

  it('agrees with the server splitter for every non-payer and the payer', () => {
    const participants = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'];
    for (let count = 1; count <= participants.length; count++) {
      const ids = participants.slice(0, count);
      for (const total of [1, 2, 99, 100, 101, 1000, 1999, 4417, 9_999_999]) {
        const paidBy = ids[ids.length - 1] as string;
        const splits = computeSplits({ totalCents: total, paidBy, mode: 'equal', participants: ids });
        const { eachCents, payerExtraCents } = equalSplitPreview(total, count);
        for (const id of ids) {
          expect(splits[id]).toBe(id === paidBy ? eachCents + payerExtraCents : eachCents);
        }
      }
    }
  });
});
