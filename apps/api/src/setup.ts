import type { INestApplication } from '@nestjs/common';
import { json, type Request, type Response } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { getAuth } from './auth/auth.instance';
import { isValidMagicLinkToken, renderSignInLinkPage } from './auth/link-page';
import { isValidInviteToken, renderJoinLinkPage } from './houses/join-page';

/**
 * Shared between main.ts and tests. The Better Auth handler must be
 * mounted BEFORE any body parser (it consumes the raw request stream),
 * which is why Nest is created with bodyParser: false and JSON parsing
 * is registered here, after the auth routes.
 */
export function setupApp(app: INestApplication): void {
  const server = app.getHttpAdapter().getInstance();
  server.all('/api/auth/*', toNodeHandler(getAuth()));
  // HOMI-31: the magic-link email lands here; raw express alongside the
  // auth handler because this is auth plumbing, not an API resource.
  server.get('/auth/link', (req: Request, res: Response) => {
    const token = req.query.token;
    res.setHeader('Cache-Control', 'no-store');
    if (!isValidMagicLinkToken(token)) {
      res.status(400).type('text/plain').send('Invalid sign-in link');
      return;
    }
    res.type('text/html').send(renderSignInLinkPage(token));
  });
  // HOMI-32: the invite link shared into a group chat lands here and
  // bounces into the app, which previews and accepts it. Short path
  // because invite links get typed and read by humans.
  server.get('/j/:token', (req: Request, res: Response) => {
    const token = req.params.token;
    res.setHeader('Cache-Control', 'no-store');
    if (!isValidInviteToken(token)) {
      res.status(400).type('text/plain').send('Invalid invite link');
      return;
    }
    res.type('text/html').send(renderJoinLinkPage(token));
  });
  app.use(json());
}
