import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { tabularNums, typography, type TextVariant } from '../tokens';

export type Tone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'positive'
  | 'negative'
  | 'link'
  | 'onInk';

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  tone?: Tone;
  center?: boolean;
  /** Column-aligned digits. Money sets this; so should any other amount. */
  tabular?: boolean;
  /**
   * Overrides the variant's Dynamic Type cap. Needed where a smaller
   * variant sits next to a capped larger one: without a cap of its own it
   * grows past the thing it is subordinate to and inverts the hierarchy.
   */
  maxFontSizeMultiplier?: number;
};

/**
 * Every string in the app goes through here, so the type scale and the
 * palette cannot drift apart and no screen hardcodes a size or a hex.
 */
export default function Text({
  variant = 'body',
  tone = 'primary',
  center = false,
  tabular = false,
  maxFontSizeMultiplier,
  style,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  const { maxFontSizeMultiplier: variantCap, ...typeStyle } = typography[variant];
  const cap = maxFontSizeMultiplier ?? variantCap;

  const color = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    positive: colors.positive,
    negative: colors.negative,
    link: colors.link,
    onInk: colors.onInk,
  }[tone];

  return (
    <RNText
      maxFontSizeMultiplier={cap}
      style={[
        typeStyle,
        { color },
        center && { textAlign: 'center' as const },
        tabular && tabularNums,
        style,
      ]}
      {...rest}
    />
  );
}
