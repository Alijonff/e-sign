import { MAX_BLOCKS, type DocumentInfo, type SignatureBlock } from '@e-sign/shared';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkStep } from './MarkStep';

const pdf = vi.hoisted(() => {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const getViewport = vi.fn(({ scale }: { scale: number }) => ({ width: 800 * scale, height: 400 * scale }));
  const getPage = vi.fn(async (_number: number) => ({ getViewport, render }));
  const destroy = vi.fn(async () => {});
  const getDocument = vi.fn(() => ({ promise: Promise.resolve({ getPage }), destroy }));
  return { getDocument, getPage, render, destroy };
});

vi.mock('pdfjs-dist', () => ({ getDocument: pdf.getDocument, GlobalWorkerOptions: { workerSrc: '' } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const info: DocumentInfo = {
  id: 'doc-1',
  name: 'Пример.pdf',
  sizeBytes: 512,
  pageCount: 2,
  pages: [{ width: 400, height: 800, rotation: 0 }, { width: 800, height: 400, rotation: 90 }],
  createdAt: '2026-11-20T00:00:00Z',
  signed: false,
};
const first: SignatureBlock = { id: 'first', page: 0, x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
const second: SignatureBlock = { ...first, id: 'second', page: 1 };

async function renderMark(initialBlocks: SignatureBlock[] = []) {
  const onNext = vi.fn();
  const onChange = vi.fn();
  function Harness() {
    const [blocks, setBlocks] = useState(initialBlocks);
    return <MarkStep document={info} blocks={blocks} onNext={onNext} onBlocksChange={(value) => {
      onChange(value);
      setBlocks(value);
    }} />;
  }
  const result = render(<Harness />);
  await waitFor(() => expect(pdf.getDocument).toHaveBeenCalled());
  return { ...result, onNext, onChange };
}

function nextButton() {
  return screen.getByRole('button', { name: 'Далее: подпись' });
}

it('не даёт перейти к подписи без блоков', async () => {
  const { onNext } = await renderMark();
  expect(nextButton()).toBeDisabled();
  fireEvent.click(nextButton());
  expect(onNext).not.toHaveBeenCalled();
});

it('нумерует блоки по страницам, разрешает перейти дальше и удаляет из списка', async () => {
  const { onNext, onChange } = await renderMark([second, first]);
  expect(nextButton()).toBeEnabled();
  expect(screen.getAllByRole('button', { name: /Стр\./ }).map((button) => button.textContent))
    .toEqual(['Стр. 1 · блок 1', 'Стр. 2 · блок 2']);
  fireEvent.click(nextButton());
  expect(onNext).toHaveBeenCalledExactlyOnceWith();

  fireEvent.click(screen.getByRole('button', { name: 'Удалить блок 1 из списка' }));
  expect(onChange).toHaveBeenLastCalledWith([second]);
  expect(screen.getByText('Блоков: 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Стр. 2 · блок 1' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Удалить блок 1 из списка' }));
  expect(nextButton()).toBeDisabled();
});

it.each(['Delete', 'Backspace'])('прокручивает к блоку из списка и удаляет его по %s', async (key) => {
  const { container, onChange } = await renderMark([second]);
  const scrollIntoView = vi.fn();
  Object.defineProperty(container.querySelector('[data-mark-block="second"]'), 'scrollIntoView', { value: scrollIntoView });

  fireEvent.click(screen.getByRole('button', { name: 'Стр. 2 · блок 1' }));
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
  fireEvent.keyDown(window, { key });
  expect(onChange).toHaveBeenLastCalledWith([]);
});

function mockPointerArea(page: HTMLDivElement) {
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 50, 800, 400));
  Object.defineProperty(page, 'setPointerCapture', { value: vi.fn() });
}

function pointer(target: Element, action: string, x: number, y: number, pointerType = 'touch') {
  const event = new MouseEvent(`pointer${action}`, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: pointerType },
  });
  fireEvent(target, event);
}

it('рисует блок в долях видимой повёрнутой страницы и удаляет кнопкой на блоке', async () => {
  const { container, onChange } = await renderMark();
  const page = container.querySelectorAll<HTMLDivElement>('.mark-page')[1]!;
  mockPointerArea(page);

  pointer(page, 'down', 440, 250);
  pointer(page, 'move', 240, 150);
  expect(onChange).not.toHaveBeenCalled();
  pointer(page, 'up', 240, 150);
  expect(onChange).toHaveBeenCalledExactlyOnceWith([
    { id: expect.stringMatching(/^[0-9a-f-]{36}$/), page: 1, x: 0.25, y: 0.25, width: 0.25, height: 0.25 },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить блок 1 со страницы' }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});

it('двигает блок за тело, меняет размер за угол и отменяет прерванный жест', async () => {
  const { container, onChange } = await renderMark([second]);
  const page = container.querySelectorAll<HTMLDivElement>('.mark-page')[1]!;
  const block = page.querySelector('[data-mark-block="second"]')!;
  mockPointerArea(page);

  pointer(block, 'down', 160, 160, 'mouse');
  pointer(page, 'up', 960, 160, 'mouse');
  const moved = { ...second, x: 0.7 };
  expect(onChange).toHaveBeenLastCalledWith([moved]);

  const handle = block.querySelector('[data-handle="nw"]')!;
  pointer(handle, 'down', 600, 130, 'mouse');
  pointer(page, 'move', 520, 90, 'mouse');
  pointer(page, 'cancel', 520, 90, 'mouse');
  expect(onChange).toHaveBeenCalledTimes(1);

  pointer(handle, 'down', 600, 130, 'mouse');
  pointer(page, 'up', 520, 90, 'mouse');
  const resized: SignatureBlock = onChange.mock.lastCall?.[0][0];
  expect(resized).toMatchObject({ id: second.id, page: 1 });
  expect(resized.x).toBeCloseTo(0.6);
  expect(resized.y).toBeCloseTo(0.1);
  expect(resized.width).toBeCloseTo(0.4);
  expect(resized.height).toBeCloseTo(0.5);
});

it('подавляет новый жест рисования при достижении MAX_BLOCKS', async () => {
  const blocks = Array.from({ length: MAX_BLOCKS }, (_, index) => ({ ...first, id: String(index) }));
  const { container, onChange } = await renderMark(blocks);
  const page = container.querySelector<HTMLDivElement>('.mark-page')!;
  mockPointerArea(page);

  pointer(page, 'down', 500, 250, 'mouse');
  pointer(page, 'up', 610, 310, 'mouse');
  expect(screen.getByText(`Блоков: ${MAX_BLOCKS}`)).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it('использует размеры из метаданных, лениво рисует с DPR и освобождает canvas при прокрутке', async () => {
  const notify: IntersectionObserverCallback[] = [];
  class Observer {
    observe = vi.fn();
    disconnect = vi.fn();

    constructor(callback: IntersectionObserverCallback) {
      notify.push(callback);
    }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('devicePixelRatio', 2);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 450, 225));

  const { container, unmount } = await renderMark();
  const page = container.querySelectorAll<HTMLDivElement>('.mark-page')[1]!;
  const canvas = page.querySelector('canvas')!;
  expect(page.style.aspectRatio).toBe('800 / 400');
  expect(pdf.getDocument).toHaveBeenCalledWith({ url: '/api/documents/doc-1/file' });
  expect(pdf.getPage).not.toHaveBeenCalled();

  await act(async () => notify[1]!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  await waitFor(() => expect(canvas).toBeVisible());
  expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(2);
  expect([canvas.width, canvas.height]).toEqual([900, 450]);

  await act(async () => notify[1]!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(canvas).not.toBeVisible();
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
  unmount();
  expect(pdf.destroy).toHaveBeenCalledOnce();
});
