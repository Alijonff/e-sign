import {
  PadError,
  type DocumentInfo,
  type PadDriver,
  type SignatureBlock,
  type SignatureCapture,
  type SignResponse,
} from '@e-sign/shared';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { SignStep } from './SignStep';

const document: DocumentInfo = {
  id: 'doc-1',
  name: 'Договор.pdf',
  sizeBytes: 512,
  pageCount: 2,
  pages: [],
  createdAt: '2026-11-20T00:00:00Z',
  signed: false,
};
const blocks: SignatureBlock[] = [0, 0, 1].map((page, index) => ({
  id: `block-${index}`, page, x: 0.1, y: 0.2, width: 0.2, height: 0.1,
}));
const capture: SignatureCapture = {
  imagePngBase64: 'iVBORw0KGgo=', signDataBase64: 'W10=', imageWidth: 640, imageHeight: 320,
};
const signed: SignResponse = { document: { ...document, signed: true }, stampedBlocks: blocks.length };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderStep() {
  const driver = {
    kind: 'mock',
    connect: vi.fn<PadDriver['connect']>().mockResolvedValue(undefined),
    capture: vi.fn<PadDriver['capture']>().mockResolvedValue(capture),
    cancel: vi.fn<PadDriver['cancel']>().mockResolvedValue(undefined),
    disconnect: vi.fn<PadDriver['disconnect']>().mockResolvedValue(undefined),
  } satisfies PadDriver;
  const onBack = vi.fn();
  const onSigned = vi.fn();
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(signed));
  vi.stubGlobal('fetch', fetchMock);
  const { unmount } = render(
    <MemoryRouter initialEntries={['/doc/doc-1']}>
      <Routes>
        <Route
          path="/doc/:id"
          element={<SignStep document={document} blocks={blocks} onBack={onBack} onSigned={onSigned} driver={driver} />}
        />
        <Route path="/login" element={<h1>Вход</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  const start = () => fireEvent.click(screen.getByRole('button', { name: 'Подписать на планшете' }));
  return { driver, onBack, onSigned, fetchMock, unmount, start };
}

it('подключает драйвер по нажатию, показывает этапы и отправляет подпись по контракту', async () => {
  const { driver, onBack, onSigned, fetchMock, unmount, start } = renderStep();
  let confirm!: (value: SignatureCapture) => void;
  driver.capture.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));
  let respond!: (value: Response) => void;
  fetchMock.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));

  expect(screen.getByText('Блоков для подписи: 3 на 2 страницах')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
  expect(onBack).toHaveBeenCalledOnce();
  expect(driver.connect).not.toHaveBeenCalled();
  start();
  expect(screen.getByRole('status')).toHaveTextContent('Подключение');
  expect(await screen.findByText('Ждём подпись клиента…')).toBeInTheDocument();
  expect(driver.connect).toHaveBeenCalledOnce();
  expect(driver.capture).toHaveBeenCalledExactlyOnceWith({
    prompt: 'Подписываю документ: Договор', signal: expect.any(AbortSignal),
  });
  expect(fetchMock).not.toHaveBeenCalled();

  await act(async () => { confirm(capture); });
  expect(screen.getByRole('status')).toHaveTextContent('Отправка');
  expect(screen.queryByRole('button', { name: 'Отменить' })).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/documents/doc-1/sign', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks,
      signature: { imagePngBase64: capture.imagePngBase64, signDataBase64: capture.signDataBase64, padKind: 'mock' },
    }),
  });

  await act(async () => { respond(Response.json(signed)); });
  expect(screen.getByRole('status')).toHaveTextContent('Готово');
  expect(onSigned).toHaveBeenCalledExactlyOnceWith(signed);
  unmount();
  expect(driver.disconnect).toHaveBeenCalledOnce();
});

it('показывает, что планшет не найден, и повторяет подключение', async () => {
  const { driver, onSigned, start } = renderStep();
  driver.connect.mockRejectedValueOnce(new PadError('pad_not_found', 'Driver error'));

  start();
  expect(await screen.findByRole('alert')).toHaveTextContent('Планшет не найден. Проверьте подключение по USB');
  expect(driver.capture).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('Готово')).toBeInTheDocument();
  expect(driver.connect).toHaveBeenCalledTimes(2);
  expect(onSigned).toHaveBeenCalledOnce();
});

it.each([
  ['service_unavailable', 'Служба планшета не отвечает. Проверьте, что signoPAD-API/Web запущена на этом компьютере'],
  ['timeout', 'Подпись не получена вовремя'],
  ['unknown', 'Ошибка планшета: Подробности драйвера'],
] as const)('показывает сообщение планшета для %s', async (code, message) => {
  const { driver, fetchMock, start } = renderStep();
  driver.capture.mockRejectedValueOnce(new PadError(code, 'Подробности драйвера'));

  start();
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('возвращает кнопку подписи при отмене на планшете', async () => {
  const { driver, fetchMock, start } = renderStep();
  driver.capture.mockRejectedValueOnce(new PadError('cancelled', 'Отмена на планшете'));

  start();
  expect(await screen.findByRole('button', { name: 'Подписать на планшете' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('прерывает ожидание по кнопке «Отменить» и использует подключение повторно', async () => {
  const { driver, onSigned, fetchMock, start } = renderStep();
  driver.capture.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new PadError('cancelled', 'Отменено')), { once: true });
  }));

  start();
  fireEvent.click(await screen.findByRole('button', { name: 'Отменить' }));
  expect(await screen.findByRole('button', { name: 'Подписать на планшете' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  start();
  expect(await screen.findByText('Готово')).toBeInTheDocument();
  expect(driver.connect).toHaveBeenCalledOnce();
  expect(onSigned).toHaveBeenCalledOnce();
});

it.each([
  ['invalid_blocks', 'Блоки подписи не подходят к документу, вернитесь и проверьте разметку'],
  ['invalid_signature', 'Подпись не распознана, попросите клиента подписать ещё раз'],
  ['internal', 'Текст ошибки сервера'],
])('показывает сообщение API для %s', async (code, message) => {
  const { fetchMock, onSigned, start } = renderStep();
  fetchMock.mockResolvedValueOnce(Response.json({ error: { code, message: 'Текст ошибки сервера' } }, { status: 422 }));

  start();
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();
  expect(onSigned).not.toHaveBeenCalled();
});

it('переходит на /login при истёкшем сеансе', async () => {
  const { driver, fetchMock, onSigned, start } = renderStep();
  fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'unauthorized', message: 'Сеанс истёк' } }, { status: 401 }));

  start();
  expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
  expect(driver.disconnect).toHaveBeenCalledOnce();
  expect(onSigned).not.toHaveBeenCalled();
});

it('прерывает ожидание при уходе с экрана и не отправляет запоздавшую подпись', async () => {
  const { driver, fetchMock, onSigned, unmount, start } = renderStep();
  let confirm!: (value: SignatureCapture) => void;
  driver.capture.mockImplementation(() => new Promise((resolve) => { confirm = resolve; }));

  start();
  await screen.findByRole('button', { name: 'Отменить' });
  unmount();
  expect(driver.capture.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  expect(driver.disconnect).toHaveBeenCalledOnce();
  await act(async () => { confirm(capture); });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onSigned).not.toHaveBeenCalled();
});
