import type { DocumentInfo } from '@e-sign/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

it.each(['/', '/doc/doc-1', '/unknown'])('отправляет с %s на /login без сеанса', async (path) => {
  window.history.replaceState(null, '', path);
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ authenticated: false }));
  vi.stubGlobal('fetch', fetchMock);

  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/session', { credentials: 'same-origin' });
});

it('открывает /login сразу', () => {
  window.history.replaceState(null, '', '/login');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  render(<App />);

  expect(screen.getByRole('heading', { name: 'Вход' })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('загружает документ после проверки сеанса и открывает разметку', async () => {
  const document: DocumentInfo = {
    id: 'doc-1',
    name: 'Пример.pdf',
    sizeBytes: 512,
    pageCount: 1,
    pages: [{ width: 595, height: 842, rotation: 0 }],
    createdAt: '2026-11-20T00:00:00Z',
    signed: false,
  };
  window.history.replaceState(null, '', '/doc/doc-1');
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ authenticated: true }))
    .mockResolvedValueOnce(Response.json(document));
  vi.stubGlobal('fetch', fetchMock);

  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Разметка документа' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/session', { credentials: 'same-origin' });
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/documents/doc-1', { credentials: 'same-origin' });
});
