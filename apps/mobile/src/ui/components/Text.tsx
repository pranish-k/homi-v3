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
  style,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  const { maxFontSizeMultiplier, ...typeStyle } = typography[variant];

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
      maxFontSizeMultiplier={maxFontSizeMultiplier}
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
