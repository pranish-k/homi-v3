import { BadRequestException } from '@nestjs/common';
import { SplitError } from '@homi/domain';
import { PostingProblem } from '@homi/ledger';

/**
 * Translate a rejection from the shared posting core into a 400. The
 * core signals caller-fixable problems - a placeholder trying to act
 * (PostingProblem) or an invalid split (SplitError) - which are the
 * client's fault; anything else is a real fault and rethrows unchanged.
 * Always throws, so a catch block does not fall through after calling it.
 */
export function throwPostingProblemAs400(err: unknown): never {
  if (err instanceof PostingProblem || err instanceof SplitError) {
    throw new BadRequestException(err.message);
  }
  throw err;
}
