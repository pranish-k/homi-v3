/**
 * What an equal split will charge, for the preview under the split chips.
 *
 * The server is the one splitter (invariant 2), so this mirrors its rule
 * rather than inventing a friendlier one: everyone's share is the floor of
 * total / count, and the leftover cents go to the payer
 * (computeSplits in packages/domain/src/money/split.ts). The test checks
 * this against computeSplits itself, so the preview cannot drift from what
 * actually posts. It is not imported here because @homi/domain ships as
 * built CommonJS, which the app bundle does not depend on.
 *
 * Pure, so it runs under plain vitest.
 */
export function equalSplitPreview(
  totalCents: number,
  participantCount: number,
): { eachCents: number; payerExtraCents: number } {
  const eachCents = Math.floor(totalCents / participantCount);
  return { eachCents, payerExtraCents: totalCents - eachCents * participantCount };
}
