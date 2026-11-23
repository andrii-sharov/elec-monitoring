import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { createDocument, type ZodOpenApiPathsObject } from 'zod-openapi';
import { errorSchema } from './errors.ts';

const DOCUMENT_PATH = '/api/v1/openapi.json';

export type OpenApiDocument = ReturnType<typeof createDocument>;

export interface ApiGroup {
  tag: string;
  description: string;
  paths: ZodOpenApiPathsObject[];
}

function tagOperations(tag: string, paths: ZodOpenApiPathsObject): ZodOpenApiPathsObject {
  return Object.fromEntries(
    Object.entries(paths).map(([path, item]) => [
      path,
      Object.fromEntries(
        Object.entries(item).map(([method, operation]) => [method, { ...operation, tags: [tag] }]),
      ),
    ]),
  );
}

export function buildOpenApiDocument(groups: ApiGroup[]): OpenApiDocument {
  return createDocument({
    openapi: '3.1.0',
    info: { title: 'Electricity Monitor API', version: '2.0.0' },
    tags: groups.map(({ tag, description }) => ({ name: tag, description })),
    paths: Object.assign(
      {},
      ...groups.flatMap(({ tag, paths }) => paths.map((p) => tagOperations(tag, p))),
    ),
    components: {
      schemas: { Error: errorSchema },
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
  });
}

export function docsRouter(document: OpenApiDocument): Router {
  const router = Router();
  router.get(DOCUMENT_PATH, (_req, res) => {
    res.json(document);
  });
  router.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(undefined, { swaggerOptions: { url: DOCUMENT_PATH } }),
  );
  return router;
}
