import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { ApiErrorCode } from '@e-sign/shared';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { registerCleanup } from '../cleanup.js';
import type { Config } from '../config.js';
import { CoreError } from '../core/index.js';
import { registerAuthRoutes, requireSession } from './auth.js';
import { registerDocumentRoutes } from './documents.js';

function apiError(reply: FastifyReply, status: number, code: ApiErrorCode, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export function registerRoutes(app: FastifyInstance, config: Config): void {
  registerCleanup(app, config.dataDir, config.retentionDays);

  app.register(async (api) => {
    await api.register(cookie);
    await api.register(multipart);
    await api.register(rateLimit, { global: false });

    api.setErrorHandler((error, request, reply) => {
      if (error instanceof CoreError) {
        const readingUpload = request.routeOptions.url === '/api/documents';
        const pdfError = error.code === 'pdf_invalid' || error.code === 'pdf_encrypted';
        const message = error.code === 'pdf_invalid' ? 'PDF не удалось прочитать'
          : error.code === 'invalid_signature' ? 'Не удалось обработать изображение подписи'
            : error.message;
        return apiError(reply, readingUpload && pdfError ? 422 : 400, error.code, message);
      }
      const httpError = error instanceof Error ? error as FastifyError : undefined;
      if (httpError?.code === 'FST_REQ_FILE_TOO_LARGE' || httpError?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return apiError(reply, 413, 'file_too_large', 'Превышен допустимый размер запроса');
      }
      if (httpError?.statusCode === 429) {
        return apiError(reply, 429, 'bad_request', 'Слишком много попыток входа. Повторите позже');
      }
      if (httpError?.message === 'Multipart: Boundary not found'
        || httpError?.message === 'Part terminated early'
        || (httpError?.statusCode !== undefined && httpError.statusCode >= 400 && httpError.statusCode < 500)) {
        return apiError(reply, 400, 'bad_request', 'Некорректный запрос');
      }
      request.log.error({ err: error }, 'Не удалось обработать запрос');
      return apiError(reply, 500, 'internal', 'Внутренняя ошибка сервера');
    });

    registerAuthRoutes(api, config);
    api.register(async (secured) => {
      secured.addHook('onRequest', requireSession(config.sessionSecret));
      registerDocumentRoutes(secured, config.dataDir, config.maxUploadMb);
      const unknownRoute = async (_request: unknown, reply: FastifyReply) =>
        apiError(reply, 404, 'bad_request', 'Адрес запроса не найден');
      secured.all('/', unknownRoute);
      secured.all('/*', unknownRoute);
    });
  }, { prefix: '/api' });
}
