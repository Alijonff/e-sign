import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { registerRoutes } from './routes/index.js';

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({ logger: config.nodeEnv !== 'test' });

  app.get('/health', async () => ({ ok: true }));
  registerRoutes(app, config);

  const webDist = resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.get<{ Params: { '*': string } }>('/*', (request, reply) => {
      const path = request.params['*'];
      if (path === 'api' || path.startsWith('api/')) {
        return reply.callNotFound();
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
