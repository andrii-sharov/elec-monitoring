import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { testApp } from '../../test/app.ts';

async function document() {
  return (await request(testApp()).get('/api/v1/openapi.json')).body;
}

describe('API docs', () => {
  test('serves the OpenAPI 3.1 document', async () => {
    const res = await request(testApp()).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\.1/);
    expect(res.body.info.title).toBe('Electricity Monitor API');
    expect(res.body.components.schemas.Error).toBeDefined();
  });

  test('documents /health with 200 and 503', async () => {
    const res = await request(testApp()).get('/api/v1/openapi.json');
    expect(Object.keys(res.body.paths['/health'].get.responses).toSorted()).toEqual(['200', '503']);
  });

  test('the Error schema matches the API error shape', async () => {
    const res = await request(testApp()).get('/api/v1/openapi.json');
    const error = res.body.components.schemas.Error;
    expect(error.required).toEqual(['error']);
    expect(error.properties.error.required).toEqual(['code', 'message']);
    expect(error.properties.error.properties.details.type).toBe('array');
  });

  test('serves Swagger UI', async () => {
    const res = await request(testApp()).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('swagger-ui');
  });

  test('serves the Swagger UI scripts', async () => {
    const res = await request(testApp()).get('/api/docs/swagger-ui-bundle.js');
    expect(res.status).toBe(200);
    const init = await request(testApp()).get('/api/docs/swagger-ui-init.js');
    expect(init.text).toContain('/api/v1/openapi.json');
  });

  describe('groups', () => {
    test('declares the groups in display order', async () => {
      const { tags } = await document();
      expect(tags.map((t: { name: string }) => t.name)).toEqual([
        'Health',
        'Auth',
        'Account',
        'Devices',
        'Device',
        'Outages',
        'Notifications',
        'Sharing',
        'Firmware',
      ]);
      for (const tag of tags) expect(tag.description).toBeTruthy();
    });

    test('puts every operation in exactly one declared group', async () => {
      const { paths, tags } = await document();
      const declared = new Set(tags.map((t: { name: string }) => t.name));
      for (const [path, item] of Object.entries<Record<string, { tags?: string[] }>>(paths)) {
        for (const [method, operation] of Object.entries(item)) {
          expect(operation.tags, `${method} ${path}`).toHaveLength(1);
          expect(declared.has(operation.tags![0]), `${method} ${path}`).toBe(true);
        }
      }
    });

    test.each([
      ['/health', 'get', 'Health'],
      ['/api/auth/login', 'post', 'Auth'],
      ['/api/auth/google/callback', 'get', 'Auth'],
      ['/api/v1/me', 'patch', 'Account'],
    ])('%s %s is in %s', async (path, method, tag) => {
      expect((await document()).paths[path][method].tags).toEqual([tag]);
    });
  });

  describe('M1 auth endpoints', () => {
    const authPosts = [
      'signup',
      'verify-email',
      'resend-verification',
      'login',
      'refresh',
      'logout',
      'logout-all',
      'forgot-password',
      'reset-password',
      'change-password',
    ];
    const jwtOperations: Array<[string, string]> = [
      ['/api/auth/resend-verification', 'post'],
      ['/api/auth/logout-all', 'post'],
      ['/api/auth/change-password', 'post'],
      ['/api/auth/google', 'delete'],
      ['/api/v1/me', 'get'],
      ['/api/v1/me', 'patch'],
      ['/api/v1/me', 'delete'],
    ];

    test.each(authPosts)('documents POST /api/auth/%s', async (name) => {
      expect((await document()).paths[`/api/auth/${name}`].post).toBeDefined();
    });

    test('documents the Google and profile endpoints', async () => {
      const { paths } = await document();
      expect(paths['/api/auth/google'].get).toBeDefined();
      expect(paths['/api/auth/google'].delete).toBeDefined();
      expect(paths['/api/auth/google/callback'].get).toBeDefined();
      for (const method of ['get', 'patch', 'delete']) {
        expect(paths['/api/v1/me'][method]).toBeDefined();
      }
    });

    test.each(jwtOperations)('%s %s requires the bearer token', async (path, method) => {
      const { paths } = await document();
      expect(paths[path][method].security).toEqual([{ bearerAuth: [] }]);
    });

    test('declares the bearer scheme and the Me schema', async () => {
      const { components } = await document();
      expect(components.securitySchemes.bearerAuth).toEqual({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      });
      expect(components.schemas.Me).toBeDefined();
    });

    test.each(authPosts)('POST /api/auth/%s lists a 429 response', async (name) => {
      expect((await document()).paths[`/api/auth/${name}`].post.responses['429']).toBeDefined();
    });
  });
});

describe('M3 notification endpoints', () => {
  test.each([
    ['/api/v1/channels/telegram-link', ['post']],
    ['/api/v1/channels', ['get']],
    ['/api/v1/devices/{id}/channels', ['get', 'put']],
  ])('documents %s with bearer auth in Notifications', async (path, methods) => {
    const { paths } = await document();
    for (const method of methods) {
      expect(paths[path][method].security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
      expect(paths[path][method].tags).toEqual(['Notifications']);
    }
  });

  test('has the Channel schema and no Telegram webhook path', async () => {
    const { paths, components } = await document();
    expect(components.schemas.Channel).toBeDefined();
    expect(Object.keys(paths).some((p) => p.startsWith('/telegram'))).toBe(false);
  });
});

function findOperation(
  paths: Record<string, Record<string, { security?: unknown; tags?: string[] }>>,
  route: string,
) {
  const [method, path] = route.split(' ') as [string, string];
  return paths[path]?.[method];
}

describe('M2 device endpoints', () => {
  const deviceApi = ['post /api/v1/device/claim', 'post /api/v1/device/ping'];
  const userApi = [
    'get /api/v1/devices',
    'post /api/v1/devices',
    'get /api/v1/devices/{id}',
    'patch /api/v1/devices/{id}',
    'delete /api/v1/devices/{id}',
    'post /api/v1/devices/{id}/pairing-code',
    'post /api/v1/devices/{id}/rotate-token',
    'get /api/v1/devices/{id}/outages',
    'get /api/v1/devices/{id}/diagnostics',
  ];

  test('documents every device route', async () => {
    const { paths } = await document();
    const missing = [...deviceApi, ...userApi].filter((route) => !findOperation(paths, route));
    expect(missing).toEqual([]);
  });

  test('uses the device token for the ping and JWT for user routes', async () => {
    const { paths, components } = await document();
    expect(components.securitySchemes.deviceToken).toEqual({ type: 'http', scheme: 'bearer' });
    expect(findOperation(paths, 'post /api/v1/device/ping')!.security).toEqual([
      { deviceToken: [] },
    ]);
    expect(findOperation(paths, 'post /api/v1/device/claim')!.security).toBeUndefined();
    const security = userApi.map((route) => [route, findOperation(paths, route)!.security]);
    expect(security).toEqual(userApi.map((route) => [route, [{ bearerAuth: [] }]]));
  });

  test('declares the device schemas', async () => {
    const { components } = await document();
    expect(Object.keys(components.schemas)).toEqual(
      expect.arrayContaining(['Device', 'DeviceListItem', 'OutageItem', 'DiagnosticItem']),
    );
  });
});

describe('M5 firmware endpoints', () => {
  const firmwareApi = [
    'get /api/v1/firmware/manifest.json',
    'get /api/v1/firmware/images/{version}/factory.bin',
  ];

  test.each(firmwareApi)('%s is public and in Firmware', async (route) => {
    const operation = findOperation((await document()).paths, route);
    expect(operation).toBeDefined();
    expect(operation!.security).toBeUndefined();
    expect(operation!.tags).toEqual(['Firmware']);
  });
});
