import type { INestApplication } from '@nestjs/common';
import { json, type Request, type Response } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { getAuth } from './auth/auth.instance';
import { isValidMagicLinkToken, renderSignInLinkPage } from './auth/link-page';

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
  app.use(json());
}
