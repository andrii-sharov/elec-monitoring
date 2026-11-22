import cors from 'cors';
import type { RequestHandler } from 'express';
import type { AppUrls } from '../config.ts';
import { HttpError } from './errors.ts';

export function corsMiddleware(urls: AppUrls): RequestHandler {
  return cors({ origin: [urls.client, urls.admin], credentials: true, maxAge: 600 });
}

export function requireAppOrigin(urls: AppUrls): RequestHandler {
  const allowed = new Set([urls.client, urls.admin]);
  return (req, _res, next) => {
    const origin = req.get('Origin');
    if (!origin || !allowed.has(origin)) throw new HttpError(403, 'forbidden', 'Forbidden');
    next();
  };
}
