import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { palettes, type Palette } from './tokens';

/**
 * HOMI-36: the colour scheme is resolved once, here, instead of every
 * screen calling useColorScheme() and appending a `dark && styles.xDark`
 * override. Components ask for a colour by meaning and get the right one
 * for the active scheme.
 *
 * app.json sets userInterfaceStyle "automatic", so this follows the OS.
 */

export type Theme = {
  colors: Palette;
  dark: boolean;
};

const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const dark = useColorScheme() === 'dark';
  const value = useMemo<Theme>(() => ({ colors: dark ? palettes.dark : palettes.light, dark }), [dark]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === undefined) {
    throw new Error('useTheme must be used inside <ThemeProvider> (mounted in src/app/_layout.tsx)');
  }
  return theme;
}
