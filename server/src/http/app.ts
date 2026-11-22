import express, { type Express } from 'express';
import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { Logger } from '../logger.ts';
import { errorHandler, notFound } from './errors.ts';
import { healthPaths, healthRouter } from './health.ts';
import { buildOpenApiDocument, docsRouter } from './openapi.ts';

export type AppDeps = { db: Db; clock: Clock; logger: Logger; config: Config };

export function createApp(deps: AppDeps, extraRoutes?: (app: Express) => void): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(healthRouter(deps.db));
  app.use(docsRouter(buildOpenApiDocument([healthPaths])));
  extraRoutes?.(app);
  app.use(notFound);
  app.use(errorHandler(deps.logger));
  return app;
}
