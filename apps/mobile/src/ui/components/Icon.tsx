import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';

import { useTheme } from '../ThemeProvider';
import type { Tone } from './Text';

export type IconName = keyof typeof Ionicons.glyphMap;

export type IconProps = {
  name: IconName;
  size?: number;
  tone?: Tone;
  /** Overrides tone; used by the tab bar, which passes a resolved colour. */
  color?: ColorValue;
};

/**
 * HOMI-33: the one place the icon set is named, so swapping it later is
 * a single-file change. Ionicons per DESIGN_DIRECTION.md section 6.
 */
export default function Icon({ name, size = 24, tone = 'primary', color }: IconProps) {
  const { colors } = useTheme();
  const resolved =
    color ??
    {
      primary: colors.textPrimary,
      secondary: colors.textSecondary,
      tertiary: colors.textTertiary,
      positive: colors.positive,
      negative: colors.negative,
      link: colors.link,
      onInk: colors.onInk,
    }[tone];

  return <Ionicons name={name} size={size} color={resolved} />;
}
