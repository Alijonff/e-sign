import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DocumentInfo, SignatureBlock, SignRequest, SignResponse } from '@e-sign/shared';
import type { FastifyInstance } from 'fastify';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { makeSignaturePng } from './helpers.js';

const samples = join(import.meta.dirname, '../../samples');
const documents = '/api/documents';
const maxUploadBytes = 1024 * 1024;
const sampleOne = '01-dogovor-uslug.pdf';
const sampleFive = '05-letter-s-povernutoy-stranicey.pdf';
const imagePngBase64 = Buffer.from(makeSignaturePng()).toString('base64');
const signDataBase64 = Buffer.from('вымышленные данные подписи').toString('base64');
let dataDir: string;
let app: FastifyInstance;
let cookies: { sid: string };

function startApp() {
  return buildApp(loadConfig({
    NODE_ENV: 'test', APP_PASSWORD: 'test', SESSION_SECRET: 'test', DATA_DIR: dataDir, MAX_UPLOAD_MB: '1',
  }));
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'e-sign-documents-'));
  app = startApp();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'test' } });
  expect(login.statusCode).toBe(204);
  cookies = { sid: login.cookies[0]!.value };
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function upload(bytes: Buffer, filename: string, field = 'file', mime = 'application/pdf') {
  const boundary = 'test-' + randomUUID();
  const start = '--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="' + field + '"; filename="' + filename + '"\r\n'
    + 'Content-Type: ' + mime + '\r\n\r\n';
  const end = '\r\n--' + boundary + '--\r\n';
  return app.inject({
    method: 'POST',
    url: documents,
    cookies,
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    payload: Buffer.concat([Buffer.from(start), bytes, Buffer.from(end)]),
  });
}

async function uploadSample(name = sampleOne): Promise<DocumentInfo> {
  const response = await upload(await readFile(join(samples, name)), name);
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}

function get(id: string, suffix = '') {
  return app.inject({ url: documents + '/' + id + suffix, cookies });
}

function block(page: number): SignatureBlock {
  return { id: 'block-' + page, page, x: 0.2, y: 0.7, width: 0.3, height: 0.15 };
}

function signInput(blocks: SignatureBlock[], signData?: string): SignRequest {
  return { blocks, signature: { imagePngBase64, padKind: 'mock', signDataBase64: signData } };
}

function sign(id: string, payload: SignRequest) {
  return app.inject({ method: 'POST', url: documents + '/' + id + '/sign', payload, cookies });
}

async function embeddedImages(pdf: Buffer): Promise<number[]> {
  const document = await PDFDocument.load(pdf);
  return document.getPages().map((page) => {
    const resources = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    return resources?.keys().length ?? 0;
  });
}

it.each([
  [sampleOne, 2],
  ['02-akt-vypolnennyh-rabot.pdf', 1],
  ['03-zayavlenie.pdf', 1],
  ['04-pravila-obsluzhivaniya-5-stranic.pdf', 5],
  [sampleFive, 3],
] as const)('сохраняет и выдаёт оригинал %s', async (name, pageCount) => {
  const original = await readFile(join(samples, name));
  const document = await uploadSample(name);
  const { id, ...fields } = document;
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(fields).toMatchObject({ name, sizeBytes: original.length, signed: false, pageCount });
  expect(fields.pages).toHaveLength(pageCount);
  expect(Number.isFinite(Date.parse(fields.createdAt))).toBe(true);
  if (name === sampleFive) {
    expect(fields.pages[1]).toEqual({ width: 792, height: 612, rotation: 90 });
  }
  expect((await readdir(join(dataDir, id))).sort()).toEqual(['meta.json', 'original.pdf']);
  expect(JSON.parse(await readFile(join(dataDir, id, 'meta.json'), 'utf8'))).toEqual({
    id, name, sizeBytes: original.length, pageCount, pages: fields.pages, createdAt: fields.createdAt,
  });
  expect((await get(id)).json()).toEqual(document);
  const pdf = await get(id, '/file');
  expect(pdf.statusCode).toBe(200);
  expect(pdf.headers).toMatchObject({
    'content-type': 'application/pdf',
    'content-disposition': "inline; filename*=UTF-8''" + name,
    'cache-control': 'no-store',
  });
  expect(pdf.rawPayload.equals(original)).toBe(true);
  const unsigned = await get(id, '/signed');
  expect(unsigned.statusCode).toBe(404);
  expect(unsigned.json()).toMatchObject({ error: { code: 'document_not_found' } });
});

it('очищает загруженное имя и кодирует его для показа PDF', async () => {
  const original = await readFile(join(samples, sampleOne));
  const response = await upload(original, "folder/Догово\u007fр (1)'.pdf", 'file', 'application/octet-stream');
  expect(response.statusCode, response.body).toBe(201);
  const document = response.json<DocumentInfo>();
  expect(document.name).toBe("Договор (1)'.pdf");
  const pdf = await get(document.id, '/file');
  expect(pdf.headers['content-disposition']).toBe(
    "inline; filename*=UTF-8''%D0%94%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%20%281%29%27.pdf",
  );
});

it('отличает не-PDF от битого PDF и проверяет имя поля', async () => {
  const notPdf = await upload(Buffer.from('Вымышленный текст'), 'text.pdf');
  expect(notPdf.statusCode).toBe(422);
  expect(notPdf.json()).toMatchObject({ error: { code: 'not_pdf' } });
  const brokenPdf = await upload(Buffer.from('%PDF-1.7\nbroken'), 'broken.pdf');
  expect(brokenPdf.statusCode).toBe(422);
  expect(brokenPdf.json()).toMatchObject({ error: { code: 'pdf_invalid' } });
  const wrongField = await upload(await readFile(join(samples, sampleOne)), sampleOne, 'other');
  expect(wrongField.statusCode).toBe(400);
  expect(wrongField.json()).toMatchObject({ error: { code: 'bad_request' } });
  expect(await readdir(dataDir)).toEqual([]);
});

it('принимает PDF ровно по лимиту и отклоняет превышение на один байт', async () => {
  const original = await readFile(join(samples, sampleOne));
  const atLimit = Buffer.concat([original, Buffer.alloc(maxUploadBytes - original.length, 32)]);
  const overLimit = await upload(Buffer.concat([atLimit, Buffer.from(' ')]), sampleOne);
  expect(overLimit.statusCode).toBe(413);
  expect(overLimit.json()).toMatchObject({ error: { code: 'file_too_large' } });
  const exactSize = await upload(atLimit, sampleOne);
  expect(exactSize.statusCode, exactSize.body).toBe(201);
  expect(exactSize.json<DocumentInfo>().sizeBytes).toBe(maxUploadBytes);
  expect(await readdir(dataDir)).toEqual([exactSize.json<DocumentInfo>().id]);
});

it.each([
  [sampleOne, [0, 1], [1, 1]],
  [sampleFive, [0, 1, 2], [1, 1, 1]],
] as const)('подписывает образец %s во всех указанных блоках', async (name, pages, expectedImages) => {
  const document = await uploadSample(name);
  const { id } = document;
  const input = signInput(pages.map(block), signDataBase64);
  input.signature.padKind = 'signotec';
  const response = await sign(id, input);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json<SignResponse>()).toEqual({
    document: { ...document, signed: true }, stampedBlocks: pages.length,
  });

  const signed = await get(id, '/signed');
  expect(signed.statusCode).toBe(200);
  expect(signed.headers).toMatchObject({
    'content-type': 'application/pdf',
    'content-disposition': "inline; filename*=UTF-8''" + name.replace('.pdf', '')
      + '-' + encodeURIComponent('подписано') + '.pdf',
    'cache-control': 'no-store',
  });
  expect(await embeddedImages(signed.rawPayload)).toEqual(expectedImages);
  const stored = join(dataDir, id);
  expect((await readFile(join(stored, 'signed.pdf'))).equals(signed.rawPayload)).toBe(true);
  expect(await readFile(join(stored, 'signdata.b64'), 'utf8')).toBe(signDataBase64);
  const png = PNG.sync.read(await readFile(join(stored, 'signature.png')));
  expect(png.width).toBeLessThan(600);
  expect(png.data[3]).toBe(0);
  const meta = JSON.parse(await readFile(join(stored, 'meta.json'), 'utf8'));
  expect(Number.isFinite(Date.parse(meta.signedAt))).toBe(true);
  expect(meta.createdAt).toBe(document.createdAt);
  if (name === sampleFive) {
    const signedDocument = await PDFDocument.load(signed.rawPayload);
    expect(signedDocument.getPage(1).getRotation().angle).toBe(90);
  }

  await app.close();
  app = startApp();
  expect((await get(id)).json()).toEqual({ ...document, signed: true });
  expect((await get(id, '/signed')).rawPayload.equals(signed.rawPayload)).toBe(true);
});

it('при повторной подписи начинает с оригинала и заменяет данные подписи', async () => {
  const { id } = await uploadSample();
  expect((await sign(id, signInput([block(0)], signDataBase64))).statusCode).toBe(200);
  expect(await embeddedImages((await get(id, '/signed')).rawPayload)).toEqual([1, 0]);
  expect((await sign(id, signInput([block(1)]))).statusCode).toBe(200);
  expect(await embeddedImages((await get(id, '/signed')).rawPayload)).toEqual([0, 1]);
  expect((await readdir(join(dataDir, id))).sort()).toEqual(['meta.json', 'original.pdf', 'signature.png', 'signed.pdf']);
  expect((await get(id, '/file')).rawPayload.equals(await readFile(join(samples, sampleOne)))).toBe(true);
});

it('сохраняет согласованный комплект файлов при одновременной подписи', async () => {
  const { id } = await uploadSample();
  const firstData = Buffer.from('first').toString('base64');
  const secondData = Buffer.from('second').toString('base64');
  const results = await Promise.all([
    sign(id, signInput([block(0)], firstData)),
    sign(id, signInput([block(1)], secondData)),
  ]);
  expect(results.map((response) => response.statusCode)).toEqual([200, 200]);

  const { rawPayload: pdf } = await get(id, '/signed');
  const images = await embeddedImages(pdf);
  expect(images[0]! + images[1]!).toBe(1);
  expect(await readFile(join(dataDir, id, 'signdata.b64'), 'utf8')).toBe(images[0] ? firstData : secondData);
});

it('проверяет блоки, PNG, вид планшета и ограничивает размер запроса подписи', async () => {
  const { id } = await uploadSample();
  const invalidBlocks = await sign(id, signInput([block(20)]));
  expect(invalidBlocks.statusCode).toBe(400);
  expect(invalidBlocks.json()).toMatchObject({ error: { code: 'invalid_blocks' } });

  const input = signInput([block(0)]);
  input.signature.imagePngBase64 = Buffer.from('не PNG').toString('base64');
  const invalidSignature = await sign(id, input);
  expect(invalidSignature.statusCode).toBe(400);
  expect(invalidSignature.json()).toMatchObject({ error: { code: 'invalid_signature' } });
  const invalidPad = await app.inject({
    method: 'POST', url: documents + '/' + id + '/sign', cookies,
    payload: { ...input, signature: { ...input.signature, padKind: 'unknown' } },
  });
  expect(invalidPad.statusCode).toBe(400);
  expect(invalidPad.json()).toMatchObject({ error: { code: 'bad_request' } });

  const tooLarge = await sign(id, signInput([block(0)], 'A'.repeat(5 * maxUploadBytes)));
  expect(tooLarge.statusCode).toBe(413);
  expect(tooLarge.json()).toMatchObject({ error: { code: 'file_too_large' } });
  expect((await get(id)).json<DocumentInfo>().signed).toBe(false);
});

it('принимает запрос подписи ровно в 5 МБ', async () => {
  const { id } = await uploadSample();
  const response = await app.inject({
    method: 'POST',
    url: documents + '/' + id + '/sign',
    cookies,
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify(signInput([block(0)])).padEnd(5 * maxUploadBytes),
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json<SignResponse>().stampedBlocks).toBe(1);
});

it('возвращает 404 для отсутствующего документа и недопустимого id', async () => {
  for (const id of [randomUUID(), encodeURIComponent('../document')]) {
    for (const response of [await get(id), await get(id, '/file'), await get(id, '/signed'),
      await sign(id, signInput([block(0)]))]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'document_not_found' } });
    }
  }
});

it('возвращает 500 в общем формате без деталей внутренней ошибки', async () => {
  const { id } = await uploadSample();
  await writeFile(join(dataDir, id, 'meta.json'), 'broken metadata');
  const response = await get(id);
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: { code: 'internal', message: 'Внутренняя ошибка сервера' } });
});
