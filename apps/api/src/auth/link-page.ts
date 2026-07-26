/**
 * HOMI-31: interstitial for the magic-link email. The email points here
 * rather than at the verify endpoint, so the app calls verify itself and
 * the session cookie is set on the app's own request, not in the browser
 * that opened the email. See lib/deep-link-page for the shared page.
 */

import {
  isValidDeepLinkToken,
  renderDeepLinkPage,
  type DeepLinkPage,
} from '../lib/deep-link-page';

export const APP_SIGN_IN_LINK = 'homi://auth/verify';

const SIGN_IN_PAGE: DeepLinkPage = {
  appLink: APP_SIGN_IN_LINK,
  title: 'Sign in to HOMI',
  message: 'Open this link on the phone where the HOMI app is installed.',
  action: 'Open HOMI to sign in',
};

export function isValidMagicLinkToken(token: unknown): token is string {
  return isValidDeepLinkToken(token);
}

export function renderSignInLinkPage(token: string): string {
  return renderDeepLinkPage(SIGN_IN_PAGE, token);
}
