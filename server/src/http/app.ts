import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import type { GoogleClient } from '../auth/google.ts';
import type { EmailSender } from '../email/sender.ts';
import type { FirmwareStore } from '../firmware/store.ts';
import type { Logger } from '../logger.ts';
import type { NotificationQueue } from '../notifications/queue.ts';
import type { TelegramClient } from '../notifications/telegram.ts';
import type { RateLimiter } from '../rateLimit/limiter.ts';
import type { WebhookSender } from '../webhooks/sender.ts';
import { corsMiddleware } from './cors.ts';
import { errorHandler, notFound } from './errors.ts';
import { healthPaths, healthRouter } from './health.ts';
import { mePaths, meRouter } from './account/me.ts';
import { googlePaths, googleRouter } from './auth/google.ts';
import { passwordPaths, passwordRouter } from './auth/password.ts';
import { phonePaths, phoneRouter } from './auth/phone.ts';
import { sessionPaths, sessionRouter } from './auth/session.ts';
import { signupPaths, signupRouter } from './auth/signup.ts';
import { channelsPaths, channelsRouter } from './channels/channels.ts';
import { deliveriesPaths, deliveriesRouter } from './channels/deliveries.ts';
import { claimPaths, claimRouter } from './device/claim.ts';
import { pingPaths, pingRouter } from './device/ping.ts';
import { devicesPaths, devicesRouter } from './devices/devices.ts';
import { firmwarePaths, firmwareRouter } from './firmware/firmware.ts';
import { historyPaths, historyRouter } from './devices/history.ts';
import { sharingPaths, sharingRouter } from './sharing/sharing.ts';
import { telegramWebhookRouter } from './telegram/webhook.ts';
import { buildOpenApiDocument, docsRouter, type OpenApiDocument } from './openapi.ts';

export type AppDeps = {
  db: Db;
  clock: Clock;
  logger: Logger;
  config: Config;
  email: EmailSender;
  google: GoogleClient;
  rateLimiter: RateLimiter;
  notifications: NotificationQueue;
  firmware: FirmwareStore;
  telegram: TelegramClient;
  webhooks: WebhookSender;
};

export function apiDocument(): OpenApiDocument {
  return buildOpenApiDocument([
    { tag: 'Health', description: 'API and database liveness', paths: [healthPaths] },
    {
      tag: 'Auth',
      description: 'Sign-up, sessions, passwords and Google sign-in',
      paths: [signupPaths, sessionPaths, passwordPaths, phonePaths, googlePaths],
    },
    { tag: 'Account', description: 'Profile of the signed-in user', paths: [mePaths] },
    { tag: 'Devices', description: 'Device management and settings', paths: [devicesPaths] },
    {
      tag: 'Device',
      description: 'Endpoints called by the device firmware',
      paths: [claimPaths, pingPaths],
    },
    {
      tag: 'Outages',
      description: 'Outage history and device diagnostics',
      paths: [historyPaths],
    },
    {
      tag: 'Notifications',
      description: 'Notification channels and which devices use them',
      paths: [channelsPaths, deliveriesPaths],
    },
    {
      tag: 'Sharing',
      description: 'Device members and invites',
      paths: [sharingPaths],
    },
    {
      tag: 'Firmware',
      description: 'Firmware images for flashing from the browser',
      paths: [firmwarePaths],
    },
  ]);
}

export function createApp(deps: AppDeps, extraRoutes?: (app: Express) => void): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.trustProxyHops);
  app.use(cookieParser());
  app.use(corsMiddleware(deps.config.urls));
  app.use(express.json({ limit: '100kb' }));
  app.use(healthRouter(deps.db));
  app.use(docsRouter(apiDocument()));
  app.use(signupRouter(deps));
  app.use(sessionRouter(deps));
  app.use(passwordRouter(deps));
  app.use(phoneRouter(deps));
  app.use(googleRouter(deps));
  app.use(meRouter(deps));
  app.use(devicesRouter(deps));
  app.use(claimRouter(deps));
  app.use(pingRouter(deps));
  app.use(historyRouter(deps));
  app.use(channelsRouter(deps));
  app.use(deliveriesRouter(deps));
  app.use(sharingRouter(deps));
  app.use(firmwareRouter(deps));
  app.use(telegramWebhookRouter(deps));
  extraRoutes?.(app);
  app.use(notFound);
  app.use(errorHandler(deps.logger));
  return app;
}
