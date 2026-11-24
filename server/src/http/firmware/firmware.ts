import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Router } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { findPublished, latestPublished, versionCode } from '../../firmware/releases.ts';
import { FIRMWARE_DOWNLOAD_PER_IP } from '../../rateLimit/limiter.ts';
import type { AppDeps } from '../app.ts';
import { HttpError, errorResponse } from '../errors.ts';
import { rateLimit } from '../rateLimit.ts';

const manifestSchema = z.object({
  name: z.string(),
  version: z.string().meta({ example: '2.0.0' }),
  new_install_prompt_erase: z.boolean(),
  builds: z.array(
    z.object({
      chipFamily: z.literal('ESP32-C3'),
      parts: z.array(z.object({ path: z.url(), offset: z.number().int() })),
    }),
  ),
});

const versionParams = z.object({ version: z.string().meta({ example: '2.0.0' }) });

export const firmwarePaths: ZodOpenApiPathsObject = {
  '/api/v1/firmware/manifest.json': {
    get: {
      summary: 'ESP Web Tools manifest',
      description:
        'Points at the newest published `STABLE` release, for flashing from the browser. Not cached.',
      responses: {
        '200': {
          description: 'Manifest',
          content: { 'application/json': { schema: manifestSchema } },
        },
        '404': errorResponse('No published release'),
      },
    },
  },
  '/api/v1/firmware/images/{version}/factory.bin': {
    get: {
      summary: 'Factory image of a published release',
      description:
        'Bootloader, partition table and app merged at offset 0. Published releases only. Cached for a day. Rate limit 20 / min per IP.',
      requestParams: { path: versionParams },
      responses: {
        '200': {
          description: 'Image bytes',
          content: {
            'application/octet-stream': { schema: z.string().meta({ format: 'binary' }) },
          },
        },
        '404': errorResponse('Unknown, draft or malformed version'),
        '429': errorResponse('Too many requests, with `Retry-After`'),
      },
    },
  },
};

function isPlainVersion(version: string): boolean {
  try {
    versionCode(version);
    return true;
  } catch {
    return false;
  }
}

export function firmwareRouter(deps: AppDeps): Router {
  const router = Router();
  const { db, config, firmware, logger, rateLimiter } = deps;

  router.get('/api/v1/firmware/manifest.json', async (_req, res) => {
    const release = await latestPublished(db);
    if (!release) throw new HttpError(404, 'not_found', 'No published firmware');
    res.set('Cache-Control', 'no-store');
    res.json({
      name: 'Electricity Monitor',
      version: release.version,
      new_install_prompt_erase: true,
      builds: [
        {
          chipFamily: 'ESP32-C3',
          parts: [
            {
              path: `${config.urls.api}/api/v1/firmware/images/${release.version}/factory.bin`,
              offset: 0,
            },
          ],
        },
      ],
    });
  });

  router.get(
    '/api/v1/firmware/images/:version/factory.bin',
    rateLimit(rateLimiter, 'firmware-download', { ip: FIRMWARE_DOWNLOAD_PER_IP }),
    async (req, res) => {
      const { version } = versionParams.parse(req.params);
      const release = isPlainVersion(version) ? await findPublished(db, version) : null;
      if (!release) throw new HttpError(404, 'not_found', 'Firmware not found');

      const path = `${release.imagePath}/factory.bin`;
      const file = await firmware.get(path);
      if (!file) {
        logger.error(`firmware image missing from the store: ${path}`);
        throw new HttpError(404, 'not_found', 'Firmware not found');
      }

      res.set({
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400, immutable',
      });
      if (file.size > 0) res.set('Content-Length', String(file.size));
      await pipeline(Readable.fromWeb(file.body as NodeReadableStream), res);
    },
  );

  return router;
}
