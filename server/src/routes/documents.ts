import type { SignRequest, SignResponse } from '@e-sign/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { CoreError, normalizeSignaturePng, readPageInfos, stampSignature } from '../core/index.js';
import { DocumentStorage } from '../storage.js';

type DocumentParams = { id: string };
const MEBIBYTE = 1024 * 1024;

function cleanFileName(name = ''): string {
  const basename = name.split(/[\\/]/).pop() ?? '';
  return basename.replace(/\p{Cc}/gu, '').trim() || 'document.pdf';
}

function inlinePdf(reply: FastifyReply, bytes: Buffer, name: string) {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return reply.type('application/pdf')
    .header('Content-Disposition', `inline; filename*=UTF-8''${encoded}`)
    .header('Cache-Control', 'no-store')
    .send(bytes);
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: { code: 'document_not_found', message: 'Документ не найден' },
  });
}

export function registerDocumentRoutes(app: FastifyInstance, dataDir: string, maxUploadMb: number): void {
  const storage = new DocumentStorage(dataDir);
  const maxUploadBytes = maxUploadMb * MEBIBYTE;

  app.post('/documents', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Загрузите PDF в поле file' } });
    }

    let file: { bytes: Buffer; name: string } | undefined;
    const parts = request.parts({ limits: { files: 1, fileSize: maxUploadBytes } });
    for await (const part of parts) {
      if (part.type !== 'file') continue;
      const bytes = await part.toBuffer();
      if (part.fieldname === 'file') file = { bytes, name: cleanFileName(part.filename) };
    }
    if (!file) {
      return reply.code(400).send({ error: { code: 'bad_request', message: 'Загрузите PDF в поле file' } });
    }
    if (!file.bytes.subarray(0, 1024).includes('%PDF-')) {
      return reply.code(422).send({ error: { code: 'not_pdf', message: 'Загрузите файл в формате PDF' } });
    }
    const pages = await readPageInfos(file.bytes).catch((error: unknown) => {
      if (error instanceof CoreError) throw error;
      // Повреждённое дерево страниц может вызвать ошибку уже после разбора PDF.
      request.log.debug({ err: error }, 'Не удалось прочитать страницы PDF');
      throw new CoreError('pdf_invalid', 'PDF не удалось прочитать');
    });
    const document = await storage.create(file.name, file.bytes, pages);
    return reply.code(201).send(document);
  });

  app.get<{ Params: DocumentParams }>('/documents/:id', async (request, reply) => {
    const document = await storage.get(request.params.id);
    if (!document) return notFound(reply);
    return document;
  });

  app.get<{ Params: DocumentParams }>('/documents/:id/file', async (request, reply) => {
    const original = await storage.readPdf(request.params.id, 'original.pdf');
    if (!original) return notFound(reply);
    return inlinePdf(reply, original.bytes, original.name);
  });

  app.get<{ Params: DocumentParams }>('/documents/:id/signed', async (request, reply) => {
    const signed = await storage.readPdf(request.params.id, 'signed.pdf');
    if (!signed) return notFound(reply);
    const name = `${signed.name.replace(/\.pdf$/i, '')}-подписано.pdf`;
    return inlinePdf(reply, signed.bytes, name);
  });

  app.post<{ Params: DocumentParams; Body: SignRequest | null }>(
    '/documents/:id/sign',
    { bodyLimit: 5 * MEBIBYTE },
    async (request, reply) => {
      const id = request.params.id;
      const original = await storage.readPdf(id, 'original.pdf');
      if (!original) return notFound(reply);

      const { blocks, signature } = request.body ?? {};
      if (typeof signature?.imagePngBase64 !== 'string'
        || (signature.padKind !== 'mock' && signature.padKind !== 'signotec')
        || (signature.signDataBase64 !== undefined && typeof signature.signDataBase64 !== 'string')) {
        return reply.code(400).send({ error: { code: 'bad_request', message: 'Некорректные данные подписи' } });
      }
      if (!Array.isArray(blocks) || blocks.some((block) => typeof block?.id !== 'string')) {
        throw new CoreError('invalid_blocks', 'Некорректные блоки подписи');
      }

      const png = normalizeSignaturePng(Buffer.from(signature.imagePngBase64, 'base64'));
      const pdf = await stampSignature(original.bytes, blocks, png);
      const document = await storage.saveSignature(id, pdf, png, signature.signDataBase64);
      if (!document) return notFound(reply);
      return { document, stampedBlocks: blocks.length } satisfies SignResponse;
    },
  );
}
