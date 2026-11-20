import type { ApiError } from '@e-sign/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiClientError, getDocument, login } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('сохраняет HTTP-статус, код и сообщение из ApiError', async () => {
  const body: ApiError = {
    error: { code: 'document_not_found', message: 'Документ не найден' },
  };
  const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);

  const request = getDocument('doc-1');
  await expect(request).rejects.toBeInstanceOf(ApiClientError);
  await expect(request).rejects.toMatchObject({
    status: 404,
    code: 'document_not_found',
    message: 'Документ не найден',
  });
  expect(fetchMock).toHaveBeenCalledWith('/api/documents/doc-1', { credentials: 'same-origin' });
});

it('разбирает ошибку без JSON-тела', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Ошибка', { status: 502 })));

  await expect(getDocument('doc-1')).rejects.toMatchObject({
    status: 502,
    code: 'internal',
  });
});

it('отправляет LoginRequest и принимает успешный ответ без тела', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(login({ password: 'example' })).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledWith('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'example' }),
    credentials: 'same-origin',
  });
});
