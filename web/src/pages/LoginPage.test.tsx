import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function submit() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<h1>Загрузка PDF</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
}

it('после входа открывает /', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  submit();

  expect(await screen.findByRole('heading', { name: 'Загрузка PDF' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/login', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ password: 'example' }),
  }));
});

it.each([
  [401, 'Неверный пароль'],
  [429, 'Слишком много попыток, подождите минуту'],
])('показывает понятную ошибку HTTP %s', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    error: { code: 'unauthorized', message: 'Служебный текст' },
  }, { status })));
  submit();

  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled();
});
