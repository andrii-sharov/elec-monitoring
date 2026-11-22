import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { testApp } from '../../test/app.ts';

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
});
