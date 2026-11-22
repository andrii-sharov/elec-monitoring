import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { silentLogger } from '../../test/fakes.ts';
import { testApp } from '../../test/app.ts';
import { HttpError } from './errors.ts';

const settingsSchema = z.object({ ping_interval_s: z.number().int().min(15) });
const nestedSchema = z.object({
  settings: z.object({ quiet_hours: z.array(z.string().max(5)) }),
});

function appWithRoutes(logger = silentLogger()) {
  return {
    logger,
    app: testApp({
      logger,
      routes: (app) => {
        app.get('/test/conflict', () => {
          throw new HttpError(409, 'conflict', 'Device is busy');
        });
        app.post('/test/settings', (req, res) => {
          res.json(settingsSchema.parse(req.body));
        });
        app.post('/test/nested', (req, res) => {
          res.json(nestedSchema.parse(req.body));
        });
        app.get('/test/items/:id', (req, res) => {
          res.json({ id: req.params.id });
        });
        app.get('/test/crash', () => {
          throw new Error('db password is hunter2');
        });
        app.get('/test/crash-async', async () => {
          await Promise.resolve();
          throw new Error('db password is hunter2');
        });
      },
    }),
  };
}

describe('error handler', () => {
  test('renders an HttpError', async () => {
    const res = await request(appWithRoutes().app).get('/test/conflict');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'conflict', message: 'Device is busy' } });
  });

  test('renders Zod errors as validation_error with details', async () => {
    const res = await request(appWithRoutes().app)
      .post('/test/settings')
      .send({ ping_interval_s: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'validation_error',
        message: 'Invalid request',
        details: [{ path: 'ping_interval_s', code: 'too_small', min: 15 }],
      },
    });
  });

  test('joins nested paths with dots', async () => {
    const res = await request(appWithRoutes().app)
      .post('/test/nested')
      .send({ settings: { quiet_hours: ['toolong'] } });
    expect(res.body.error.details).toEqual([
      { path: 'settings.quiet_hours.0', code: 'too_big', max: 5 },
    ]);
  });

  test('rejects malformed JSON as validation_error', async () => {
    const res = await request(appWithRoutes().app)
      .post('/test/settings')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: { code: 'validation_error', message: 'Invalid request' } });
  });

  test('rejects a body over 100 kB as validation_error', async () => {
    const res = await request(appWithRoutes().app)
      .post('/test/settings')
      .send({ big: 'x'.repeat(101 * 1024) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  test('rejects an undecodable body encoding as validation_error', async () => {
    const res = await request(appWithRoutes().app)
      .post('/test/settings')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'br')
      .send('not brotli');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'validation_error', message: 'Invalid request' } });
  });

  test('rejects a malformed path parameter as validation_error', async () => {
    const { app, logger } = appWithRoutes();
    const res = await request(app).get('/test/items/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'validation_error', message: 'Invalid request' } });
    expect(logger.error).not.toHaveBeenCalled();
  });

  test.each([
    ['get', '/nope'],
    ['delete', '/health'],
  ] as const)('%s %s is a JSON not_found', async (method, path) => {
    const res = await request(appWithRoutes().app)[method](path);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });

  test.each(['/test/crash', '/test/crash-async'])(
    '%s hides the error and logs it',
    async (path) => {
      const { app, logger } = appWithRoutes();
      const res = await request(app).get(path);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { code: 'internal', message: 'Internal error' } });
      expect(res.text).not.toContain('hunter2');
      expect(logger.error).toHaveBeenCalledTimes(1);
    },
  );

  test('does not send x-powered-by', async () => {
    const res = await request(appWithRoutes().app).get('/nope');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
