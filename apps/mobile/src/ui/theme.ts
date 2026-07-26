import { StyleSheet } from 'react-native';

/**
 * Placeholder styling only (Sprint 7 decision): minimal, system font,
 * light/dark, one accent. It exists so the HOMI-32 screens share one
 * palette instead of copying hex codes, and so the real visual direction
 * for HOMI-33/34 has a single place to land.
 */

export const colors = {
  accent: '#208AEF',
  text: '#111111',
  textDark: '#ffffff',
  muted: '#888888',
  danger: '#C4372B',
  bg: '#ffffff',
  bgDark: '#000000',
  border: '#d8d8d8',
  borderDark: '#333333',
};

export const shared = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: colors.bg,
  },
  screenDark: {
    backgroundColor: colors.bgDark,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  body: {
    fontSize: 15,
    color: colors.text,
    textAlign: 'center',
  },
  detail: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
  },
  error: {
    fontSize: 15,
    color: colors.danger,
    textAlign: 'center',
  },
  textDark: {
    color: colors.textDark,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  },
  inputDark: {
    borderColor: colors.borderDark,
    color: colors.textDark,
  },
  button: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 12,
  },
  secondaryLabel: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '500',
  },
});
