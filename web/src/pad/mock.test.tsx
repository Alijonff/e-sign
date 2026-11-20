import type { CaptureOptions, SignatureCapture } from '@e-sign/shared';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockPadHost } from './MockPadHost';
import { MockPadDriver } from './mock';

const prompt = 'Подписываю документ: Договор';
const pngBase64 = 'iVBORw0KGgo=';

beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;

    constructor(type: string, options: PointerEventInit) {
      super(type, options);
      this.pointerId = options.pointerId ?? 0;
      this.pointerType = options.pointerType ?? '';
    }
  });
  Object.assign(HTMLCanvasElement.prototype, { setPointerCapture() {} });
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) { this.open = true; },
    close(this: HTMLDialogElement) { this.open = false; },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'setPointerCapture');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

async function openMockPad(options: Partial<CaptureOptions> = {}) {
  const context = {
    canvas: { width: 640, height: 320 },
    fillStyle: '',
    fillRect: vi.fn(function (this: { fillStyle: string }) { return this.fillStyle; }),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValue(`data:image/png;base64,${pngBase64}`);
  const driver = new MockPadDriver();
  const { container } = render(<MockPadHost />);
  await driver.connect();
  let result!: Promise<SignatureCapture>;
  act(() => { result = driver.capture({ prompt, ...options }); });
  const dialog = screen.getByRole('dialog', { name: prompt });
  expect(container).not.toContainElement(dialog);
  const canvas = within(dialog).getByLabelText('Поле для подписи');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 320, 160));
  return { driver, result, dialog, canvas, getContext, context, toDataURL };
}

it('записывает отдельные штрихи мыши и пальца и экспортирует подпись на белом фоне', async () => {
  const { result, dialog, canvas, context, getContext, toDataURL } = await openMockPad();
  const confirm = within(dialog).getByRole('button', { name: 'Подтвердить' });
  expect(confirm).toBeDisabled();
  expect(getContext).toHaveBeenCalledWith('2d', { alpha: false });
  expect(context.fillRect).toHaveBeenCalledWith(0, 0, 640, 320);
  expect(context.fillRect).toHaveReturnedWith('#fff');
  expect(context).toMatchObject({ lineWidth: 3, lineCap: 'round', lineJoin: 'round' });

  fireEvent.pointerDown(canvas, { clientX: 20, clientY: 30, pointerId: 1, pointerType: 'mouse' });
  fireEvent.pointerMove(canvas, { clientX: 35, clientY: 50, pointerId: 1, pointerType: 'mouse' });
  fireEvent.pointerUp(canvas, { clientX: 45, clientY: 60, pointerId: 1, pointerType: 'mouse' });
  expect(context.quadraticCurveTo).toHaveBeenCalled();
  expect(context.stroke).toHaveBeenCalled();

  fireEvent.pointerDown(canvas, { clientX: 70, clientY: 90, pointerId: 2, pointerType: 'touch' });
  fireEvent.pointerUp(canvas, { clientX: 70, clientY: 90, pointerId: 2, pointerType: 'touch' });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);

  const signature = await result;
  expect(toDataURL).toHaveBeenCalledWith('image/png');
  expect(signature).toMatchObject({ imagePngBase64: pngBase64, imageWidth: 640, imageHeight: 320 });
  expect(JSON.parse(atob(signature.signDataBase64!))).toEqual([
    [{ x: 20, y: 20, t: expect.any(Number) }, { x: 50, y: 60, t: expect.any(Number) },
      { x: 70, y: 80, t: expect.any(Number) }],
    [{ x: 120, y: 140, t: expect.any(Number) }],
  ]);
  expect(dialog).not.toBeInTheDocument();
});

it('очищает холст и данные штрихов', async () => {
  const { result, dialog, canvas, context } = await openMockPad();
  const confirm = within(dialog).getByRole('button', { name: 'Подтвердить' });
  fireEvent.pointerDown(canvas, { clientX: 20, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: 20, clientY: 30, pointerId: 1 });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Очистить' }));
  expect(confirm).toBeDisabled();
  expect(context.fillRect).toHaveBeenCalledTimes(2);
  expect(context.fillRect).toHaveLastReturnedWith('#fff');

  fireEvent.pointerDown(canvas, { clientX: 70, clientY: 90, pointerId: 2 });
  fireEvent.click(confirm);
  const { signDataBase64 } = await result;
  expect(JSON.parse(atob(signDataBase64!))).toEqual([[{ x: 120, y: 140, t: expect.any(Number) }]]);
});

it('закрывает окно по кнопке «Отмена» и отклоняет захват с PadError', async () => {
  const { result, dialog } = await openMockPad();
  const rejection = expect(result).rejects.toMatchObject({ name: 'PadError', code: 'cancelled' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
  await rejection;
  expect(dialog).not.toBeInTheDocument();
});

it('закрывает окно, если сигнал прерывает ожидание', async () => {
  const controller = new AbortController();
  const { result, dialog } = await openMockPad({ signal: controller.signal });
  const rejection = expect(result).rejects.toMatchObject({ name: 'PadError', code: 'cancelled' });
  act(() => { controller.abort(); });
  await rejection;
  expect(dialog).not.toBeInTheDocument();
});

it('не открывает окно с уже прерванным сигналом', async () => {
  render(<MockPadHost />);
  await expect(new MockPadDriver().capture({ prompt, signal: AbortSignal.abort() }))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('cancel завершает вызов без ошибки и закрывает окно', async () => {
  const { driver, result, dialog } = await openMockPad();
  const rejection = expect(result).rejects.toMatchObject({ code: 'cancelled' });
  await act(async () => {
    await expect(driver.cancel()).resolves.toBeUndefined();
  });
  await rejection;
  expect(dialog).not.toBeInTheDocument();
  await expect(driver.cancel()).resolves.toBeUndefined();
});
