import express from 'express';
import { isValidToken } from './auth.js';
import type { Monitor } from './monitor.js';

export function createApp(monitor: Monitor, deviceToken: string) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/ping', (req, res) => {
    if (!isValidToken(req.get('authorization'), deviceToken)) {
      res.sendStatus(401);
      return;
    }
    monitor.onPing();
    res.sendStatus(204);
  });

  return app;
}
