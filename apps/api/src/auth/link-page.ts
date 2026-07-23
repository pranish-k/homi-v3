/**
 * HOMI-31: interstitial for the magic-link email. Mail clients reliably
 * hyperlink only http(s) URLs, so the email points here; this page hands
 * the token to the app through the homi:// deep link, and the app calls
 * the verify endpoint itself so the session cookie is set on the app's
 * own request, not in the browser that opened the email.
 *
 * The token never leaves the URL: the page is static HTML with no
 * external assets, and the auto-open script plus the button both target
 * the app scheme only.
 */

export const APP_SIGN_IN_LINK = 'homi://auth/verify';

// Better Auth tokens are URL-safe; anything else is rejected before it
// can reach the page (defense in depth - the token is interpolated into
// HTML and a URL below).
const TOKEN_RE = /^[A-Za-z0-9._~-]{1,256}$/;

export function isValidMagicLinkToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function renderSignInLinkPage(token: string): string {
  const appUrl = `${APP_SIGN_IN_LINK}?token=${encodeURIComponent(token)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Sign in to HOMI</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: -apple-system, system-ui, sans-serif; background: #ffffff; color: #111111; }
  main { text-align: center; padding: 24px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  p { font-size: 15px; color: #555555; margin: 0 0 24px; }
  a.open { display: inline-block; padding: 14px 28px; border-radius: 10px; background: #208AEF;
           color: #ffffff; font-size: 17px; font-weight: 600; text-decoration: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #000000; color: #ffffff; }
    p { color: #aaaaaa; }
  }
</style>
</head>
<body>
<main>
  <h1>HOMI</h1>
  <p>Open this link on the phone where the HOMI app is installed.</p>
  <a class="open" href="${appUrl}">Open HOMI to sign in</a>
</main>
<script>location.href = ${JSON.stringify(appUrl)};</script>
</body>
</html>
`;
}
