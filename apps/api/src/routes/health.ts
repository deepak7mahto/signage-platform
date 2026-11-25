import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { pgClient } from '../db/index.js';

async function loadOpenApiSpec(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), 'docs/openapi.generated.json'),
    path.resolve(process.cwd(), '../../docs/openapi.generated.json'),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {
      // try next path
    }
  }
  return null;
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', async () => {
    await pgClient`SELECT 1`;
    return {
      status: 'ok',
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/v1/openapi.json', async (_req, reply) => {
    const raw = await loadOpenApiSpec();
    if (!raw) {
      return reply.code(404).send({ error: 'OpenAPI spec not generated yet' });
    }
    return reply.type('application/json').send(raw);
  });
}
