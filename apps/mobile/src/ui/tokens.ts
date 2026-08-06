/**
 * HOMI-36: the Calm Ledger design tokens. See docs/design/DESIGN_DIRECTION.md
 * for the reasoning; this file is the single source of every colour, size,
 * and space in the app.
 *
 * The rule the palette encodes: colour carries meaning, never decoration.
 * Money owed to you is `positive`, money you owe is `negative`, and
 * everything else is greyscale. There is no brand hue - the brand is ink.
 */

import type { FontVariant } from 'react-native';

export type Palette = {
  bg: string;
  surface: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  ink: string;
  onInk: string;
  positive: string;
  negative: string;
  link: string;
};

const light: Palette = {
  bg: '#FFFFFF',
  surface: '#F7F7F8',
  border: '#E4E4E7',
  textPrimary: '#111113',
  textSecondary: '#6B6B73',
  textTertiary: '#9A9AA3',
  ink: '#111113',
  onInk: '#FFFFFF',
  positive: '#0F7A4D',
  negative: '#B3261E',
  link: '#2563EB',
};

const dark: Palette = {
  bg: '#0B0B0C',
  surface: '#17171A',
  border: '#2A2A2F',
  textPrimary: '#F5F5F7',
  textSecondary: '#A0A0A8',
  textTertiary: '#6E6E76',
  ink: '#F5F5F7',
  onInk: '#0B0B0C',
  positive: '#3DD68C',
  negative: '#FF6B60',
  link: '#7AA2FF',
};

export const palettes = { light, dark };

/** 4pt base. Every margin, padding, and gap comes from here. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'overline';

type TypeStyle = {
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700';
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase';
  /**
   * Dynamic Type is on by default. The two largest variants are capped so
   * the balance header cannot push the members list off screen at the
   * biggest accessibility sizes; body text is deliberately left uncapped.
   */
  maxFontSizeMultiplier?: number;
};

export const typography: Record<TextVariant, TypeStyle> = {
  display: { fontSize: 40, fontWeight: '700', lineHeight: 46, maxFontSizeMultiplier: 1.4 },
  title: { fontSize: 28, fontWeight: '700', lineHeight: 34, maxFontSizeMultiplier: 1.6 },
  heading: { fontSize: 20, fontWeight: '600', lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 22 },
  bodyStrong: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '500', lineHeight: 20 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  overline: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
};

/**
 * Amounts are set in tabular numerals so a column of them lines up on the
 * decimal point. Applied by Money, and by anything else rendering digits
 * that should stay column-aligned.
 */
export const tabularNums: { fontVariant: FontVariant[] } = { fontVariant: ['tabular-nums'] };

/** Calm Ledger has no shadows: separation is a hairline or a surface tint. */
export const hairline = 1;
