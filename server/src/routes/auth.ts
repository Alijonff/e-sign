import type { SessionResponse } from '@e-sign/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { createSession, isSessionValid, passwordsMatch, SESSION_MAX_AGE_SECONDS } from '../session.js';

export function requireSession(secret: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isSessionValid(request.cookies.sid, secret)) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Войдите в приложение' } });
    }
  };
}

export function registerAuthRoutes(app: FastifyInstance, config: Config): void {
  const cookie = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
  } as const;

  app.post<{ Body: { password?: unknown } | null }>('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const password = request.body?.password;
    if (typeof password !== 'string') {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Укажите пароль' } });
    }
    if (!passwordsMatch(password, config.appPassword)) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Неверный пароль' } });
    }

    return reply.setCookie('sid', createSession(config.sessionSecret), {
      ...cookie,
      maxAge: SESSION_MAX_AGE_SECONDS,
    }).code(204).send();
  });

  app.post('/logout', async (_request, reply) => reply.clearCookie('sid', cookie).code(204).send());

  app.get<{ Reply: SessionResponse }>('/session', { exposeHeadRoute: false }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { authenticated: isSessionValid(request.cookies.sid, config.sessionSecret) };
  });
}
