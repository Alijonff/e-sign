import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { UploadPage } from './UploadPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const zoneLabel = 'Перетащите PDF или нажмите, чтобы выбрать';

function renderPage() {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/doc/doc-1" element={<h1>Разметка документа</h1>} />
        <Route path="/login" element={<h1>Вход</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

it.each([
  { code: 'not_pdf', message: 'Bad content type', expected: 'Это не PDF' },
  { code: 'pdf_encrypted', message: 'Encrypted', expected: 'PDF защищён паролем' },
  { code: 'file_too_large', message: 'Лимит 32 МБ', expected: 'Файл больше 32 МБ' },
  { code: 'file_too_large', message: 'Лимит превышен', details: { maxUploadMb: 15 }, expected: 'Файл больше 15 МБ' },
  { code: 'file_too_large', message: 'Лимит превышен', expected: 'Файл больше 25 МБ' },
  { code: 'pdf_invalid', message: 'Документ повреждён', expected: 'Документ повреждён' },
])('показывает «$expected» для $code', async ({ code, message, expected, details }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    error: { code, message, details },
  }, { status: code === 'file_too_large' ? 413 : 422 })));
  renderPage();

  const input = screen.getByLabelText(zoneLabel);
  expect(input).toHaveAttribute('accept', 'application/pdf');
  fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'example.pdf', { type: 'application/pdf' })] } });
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем PDF…');
  expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  expect(input).toBeEnabled();
});

it('отправляет перетащенный PDF и открывает /doc/:id', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'doc-1' }, { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  renderPage();

  const file = new File(['%PDF-1.7'], 'example.pdf', { type: 'application/pdf' });
  fireEvent.drop(screen.getByText(zoneLabel), { dataTransfer: { files: [file] } });

  expect(await screen.findByRole('heading', { name: 'Разметка документа' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/documents', expect.objectContaining({ method: 'POST' }));
  expect(fetchMock.mock.calls[0]?.[1].body.get('file')).toBe(file);
});

it('завершает сеанс и открывает экран входа', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  renderPage();

  fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

  expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/logout', expect.objectContaining({ method: 'POST' }));
});
