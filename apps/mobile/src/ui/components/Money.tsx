import { formatMoney } from '../format';
import type { TextVariant } from '../tokens';
import Text, { type Tone } from './Text';

export type MoneyProps = {
  /** Integer cents, as the API returns them. Sign is direction. */
  cents: number;
  currency: string;
  variant?: TextVariant;
  /**
   * 'direction' colours by sign and prefixes an explicit + or -, for
   * balances. 'plain' is a neutral amount, for an expense total.
   */
  mode?: 'direction' | 'plain';
};

/**
 * The only component that renders an amount.
 *
 * Direction is never carried by colour alone: a positive balance is green
 * *and* prefixed "+", so the app still reads correctly to someone who
 * cannot separate the two hues.
 */
export default function Money({ cents, currency, variant = 'bodyStrong', mode = 'plain' }: MoneyProps) {
  if (mode === 'plain') {
    return (
      <Text variant={variant} tabular>
        {formatMoney(cents, currency)}
      </Text>
    );
  }

  const tone: Tone = cents > 0 ? 'positive' : cents < 0 ? 'negative' : 'tertiary';
  const prefix = cents > 0 ? '+' : cents < 0 ? '-' : '';

  return (
    <Text variant={variant} tone={tone} tabular>
      {prefix}
      {formatMoney(cents, currency, { absolute: true })}
    </Text>
  );
}
