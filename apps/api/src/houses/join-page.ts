/**
 * HOMI-32: interstitial for invite links. `invites.service` mints
 * `${origin}/j/${token}` so the link survives being pasted into iMessage
 * or WhatsApp; this page bounces it into the app, which previews the
 * house and accepts the invite on the joiner's own session.
 *
 * The page is deliberately anonymous - it names no house and no inviter,
 * because an invite link travels through group chats and forwards, and
 * the browser is the one place we cannot tell who is looking. The app
 * names the house once there is a signed-in user to name it to.
 */

import {
  isValidDeepLinkToken,
  renderDeepLinkPage,
  type DeepLinkPage,
} from '../lib/deep-link-page';

export const APP_JOIN_LINK = 'homi://join';

const JOIN_PAGE: DeepLinkPage = {
  appLink: APP_JOIN_LINK,
  title: 'Join a house on HOMI',
  message: 'Open this invite on the phone where the HOMI app is installed.',
  action: 'Open HOMI to join',
};

export function isValidInviteToken(token: unknown): token is string {
  return isValidDeepLinkToken(token);
}

export function renderJoinLinkPage(token: string): string {
  return renderDeepLinkPage(JOIN_PAGE, token);
}
