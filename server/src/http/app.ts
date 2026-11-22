import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { GoogleClient } from '../auth/google.ts';
import type { EmailSender } from '../email/sender.ts';
import type { Logger } from '../logger.ts';
import type { RateLimiter } from '../rateLimit/limiter.ts';
import { corsMiddleware } from './cors.ts';
import { errorHandler, notFound } from './errors.ts';
import { healthPaths, healthRouter } from './health.ts';
import { mePaths, meRouter } from './account/me.ts';
import { googlePaths, googleRouter } from './auth/google.ts';
import { passwordPaths, passwordRouter } from './auth/password.ts';
import { sessionPaths, sessionRouter } from './auth/session.ts';
import { signupPaths, signupRouter } from './auth/signup.ts';
import { buildOpenApiDocument, docsRouter } from './openapi.ts';

export type AppDeps = {
  db: Db;
  clock: Clock;
  logger: Logger;
  config: Config;
  email: EmailSender;
  google: GoogleClient;
  rateLimiter: RateLimiter;
};

export function createApp(deps: AppDeps, extraRoutes?: (app: Express) => void): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.trustProxyHops);
  app.use(cookieParser());
  app.use(corsMiddleware(deps.config.urls));
  app.use(express.json({ limit: '100kb' }));
  app.use(healthRouter(deps.db));
  app.use(
    docsRouter(
      buildOpenApiDocument([
        healthPaths,
        signupPaths,
        sessionPaths,
        passwordPaths,
        googlePaths,
        mePaths,
      ]),
    ),
  );
  app.use(signupRouter(deps));
  app.use(sessionRouter(deps));
  app.use(passwordRouter(deps));
  app.use(googleRouter(deps));
  app.use(meRouter(deps));
  extraRoutes?.(app);
  app.use(notFound);
  app.use(errorHandler(deps.logger));
  return app;
}
