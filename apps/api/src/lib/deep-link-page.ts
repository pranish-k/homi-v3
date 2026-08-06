/**
 * Shared interstitial for links that must end up inside the app.
 *
 * Mail clients and messaging apps reliably hyperlink only http(s) URLs,
 * so emailed and shared links point at the API; this page hands the
 * token to the app through a `homi://` deep link. Doing the real work in
 * the app (rather than emailing the raw endpoint) keeps the session
 * cookie on the app's own request instead of in whatever browser opened
 * the link - see HOMI-31 sign-in and HOMI-32 invites.
 *
 * The token never leaves the URL: the page is static HTML with no
 * external assets, and the auto-open script plus the button both target
 * the app scheme only.
 */

// Both token families (Better Auth magic links, base64url invite
// tokens) are URL-safe; anything else is rejected before it can reach
// the page - defense in depth, since the token is interpolated into
// HTML and a URL below.
const TOKEN_RE = /^[A-Za-z0-9._~-]{1,256}$/;

export function isValidDeepLinkToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export interface DeepLinkPage {
  /** App-scheme target, e.g. `homi://auth/verify`. */
  appLink: string;
  /** Browser tab title. */
  title: string;
  /** One line of explanation under the wordmark. */
  message: string;
  /** Label on the button that opens the app. */
  action: string;
}

export function renderDeepLinkPage(page: DeepLinkPage, token: string): string {
  const appUrl = `${page.appLink}?token=${encodeURIComponent(token)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${page.title}</title>
<style>
  /* Calm Ledger (docs/design/DESIGN_DIRECTION.md): this page sits in the
     middle of sign-in and join, so it uses the app's own tokens. The
     primary action is ink rather than a hue, which is why the old
     #208AEF accent is gone from here too. */
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: -apple-system, system-ui, sans-serif; background: #FFFFFF; color: #111113; }
  main { text-align: center; padding: 24px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  p { font-size: 16px; color: #6B6B73; margin: 0 0 24px; }
  a.open { display: inline-block; padding: 14px 28px; border-radius: 12px; background: #111113;
           color: #FFFFFF; font-size: 14px; font-weight: 500; text-decoration: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #0B0B0C; color: #F5F5F7; }
    p { color: #A0A0A8; }
    a.open { background: #F5F5F7; color: #0B0B0C; }
  }
</style>
</head>
<body>
<main>
  <h1>HOMI</h1>
  <p>${page.message}</p>
  <a class="open" href="${appUrl}">${page.action}</a>
</main>
<script>location.href = ${JSON.stringify(appUrl)};</script>
</body>
</html>
`;
}
