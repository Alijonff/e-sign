import { afterEach, expect, it, vi } from 'vitest';
import { SignotecPadDriver } from './signotec';
import type { SignotecCommons, SignotecDefault } from './signotec/vendor.d';

// Вымышленный штрих в PNG 319×147.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAT8AAACTAQAAAADQdCMnAAAASklEQVR4nO3OQQ3AIBQFQRIEYKUOah1JCOihDviPU5Nm5ryHbQ0AODDTcKXhk4Z3Go4Zht3knsmCyYLJPZMFk4UvJ+PwSkMA4P9eDk8mrW+VPa0AAAAASUVORK5CYII=';
const signData = 'dGVzdA==';
const options = { prompt: 'Подписываю тестовый документ № 1' };

function installVendor() {
  const calls: string[] = [];
  const response = { command: 'test', returnCode: 0 };
  function reply<T extends object>(command: string, data?: T) {
    return vi.fn(async (_params?: object) => {
      calls.push(command);
      return { ...response, ...data } as typeof response & T;
    });
  }

  const commons = {
    createConnection: vi.fn<SignotecCommons['createConnection']>((_url, onopen) => {
      calls.push('createConnection');
      onopen(new Event('open'));
    }),
    destroyConnection: vi.fn(() => { calls.push('destroyConnection'); }),
    handleDisconnect: undefined as SignotecCommons['handleDisconnect'],
  } satisfies SignotecCommons;

  const standard = {
    Params: {
      searchForPads: class {
        type?: string;
        setPadSubset(type: string) { this.type = type; }
      },
      openPad: class { constructor(public padIndex: number) {} },
      closePad: class { constructor(public padIndex: number) {} },
      startSignature: class {
        fieldName?: string;
        customText?: string;
        confirmationText?: string;
        setFieldName(fieldName: string) { this.fieldName = fieldName; }
        setCustomText(customText: string) { this.customText = customText; }
        setConfirmationText(confirmationText: string) { this.confirmationText = confirmationText; }
      },
      getSignatureImage: class {
        fileType?: number;
        penWidth?: number;
        setFileType(fileType: number) { this.fileType = fileType; }
        setPenWidth(penWidth: number) { this.penWidth = penWidth; }
      },
      getSignatureData: class {
        rsaScheme = 'NONE';
        setRsaScheme(rsaScheme: string) { this.rsaScheme = rsaScheme; }
      },
    },
    FileType: { PNG: 1 },
    searchForPads: reply('searchForPads', { foundPads: [{ index: 0 }] }),
    openPad: reply('openPad', { displayWidth: 320, displayHeight: 160 }),
    closePad: reply('closePad'),
    startSignature: reply('startSignature'),
    confirmSignature: reply('confirmSignature', { countedPoints: 64 }),
    retrySignature: reply('retrySignature'),
    cancelSignature: reply('cancelSignature'),
    getSignatureImage: reply('getSignatureImage', { file: `data:image/png;base64,${png}` }),
    getSignatureData: reply('getSignatureData', { signData }),
    handleConfirmSignature: undefined as SignotecDefault['handleConfirmSignature'],
    handleRetrySignature: undefined as SignotecDefault['handleRetrySignature'],
    handleCancelSignature: undefined as SignotecDefault['handleCancelSignature'],
    handleError: undefined as SignotecDefault['handleError'],
  } satisfies SignotecDefault;

  vi.stubGlobal('STPadServerLibCommons', commons);
  vi.stubGlobal('STPadServerLibDefault', standard);
  return { calls, commons, standard };
}

const drivers: SignotecPadDriver[] = [];
function createDriver() {
  const driver = new SignotecPadDriver();
  drivers.push(driver);
  return driver;
}

afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.disconnect()));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('открывает HID-планшет, ждёт подтверждения и считывает PNG и SignData в порядке API', async () => {
  const { calls, commons, standard } = installVendor();
  const driver = createDriver();

  await driver.connect();
  const result = driver.capture(options);
  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledOnce());
  expect(calls).toEqual(['createConnection', 'searchForPads', 'openPad', 'startSignature']);
  standard.handleConfirmSignature?.();
  await expect(result).resolves.toEqual({
    imagePngBase64: png, imageWidth: 319, imageHeight: 147, signDataBase64: signData,
  });
  await driver.disconnect();

  expect(commons.createConnection).toHaveBeenCalledWith(
    'wss://local.signotecwebsocket.de:49494', expect.any(Function), expect.any(Function), expect.any(Function),
  );
  expect(standard.searchForPads).toHaveBeenCalledWith(expect.objectContaining({ type: 'HID' }));
  expect(standard.openPad).toHaveBeenCalledWith(expect.objectContaining({ padIndex: 0 }));
  expect(standard.startSignature).toHaveBeenCalledWith(expect.objectContaining({
    fieldName: 'Подпись клиента', customText: options.prompt,
  }));
  expect(standard.getSignatureImage).toHaveBeenCalledWith(expect.objectContaining({ fileType: 1, penWidth: 3 }));
  expect(standard.getSignatureData).toHaveBeenCalledWith(expect.objectContaining({ rsaScheme: 'NONE' }));
  expect(standard.closePad).toHaveBeenCalledWith(expect.objectContaining({ padIndex: 0 }));
  expect(standard.handleConfirmSignature).toBeUndefined();
  expect(calls).toEqual([
    'createConnection', 'searchForPads', 'openPad', 'startSignature',
    'confirmSignature', 'getSignatureImage', 'getSignatureData', 'closePad', 'destroyConnection',
  ]);
});

it('прерывает подключение через восемь секунд и позволяет подключиться заново', async () => {
  vi.useFakeTimers();
  const { commons, standard } = installVendor();
  commons.createConnection.mockImplementationOnce(() => {});
  const driver = createDriver();

  const failure = expect(driver.connect()).rejects.toMatchObject({ code: 'service_unavailable' });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(7_999);
  expect(commons.destroyConnection).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await failure;
  expect(commons.destroyConnection).toHaveBeenCalledOnce();
  expect(standard.searchForPads).not.toHaveBeenCalled();

  await driver.connect();
  expect(standard.openPad).toHaveBeenCalledOnce();
});

it('использует настроенный URL и переводит onerror WebSocket в service_unavailable', async () => {
  vi.stubEnv('VITE_SIGNOTEC_WS_URL', 'wss://localhost:49495');
  const { commons } = installVendor();
  commons.createConnection.mockImplementationOnce((_url, _onopen, _onclose, onerror) => {
    onerror(new Event('error'));
  });

  await expect(createDriver().connect()).rejects.toMatchObject({ code: 'service_unavailable' });
  expect(commons.createConnection.mock.calls[0]?.[0]).toBe('wss://localhost:49495');
  expect(commons.destroyConnection).toHaveBeenCalledOnce();
});

it('отключается в ходе подключения и игнорирует запоздалое открытие WebSocket', async () => {
  const { commons, standard } = installVendor();
  commons.createConnection.mockImplementationOnce(() => {});
  const driver = createDriver();
  const failure = expect(driver.connect()).rejects.toMatchObject({ code: 'service_unavailable' });

  await vi.waitFor(() => expect(commons.createConnection).toHaveBeenCalledOnce());
  await driver.disconnect();
  commons.createConnection.mock.calls[0]?.[1](new Event('open'));
  await failure;
  expect(standard.searchForPads).not.toHaveBeenCalled();

  await driver.connect();
  expect(standard.openPad).toHaveBeenCalledOnce();
});

it.each([
  [-4, 'pad_not_found'],
  [-46, 'service_unavailable'],
  [-3, 'unknown'],
])('переводит отказ openPad %i в %s и сохраняет исходный код', async (errorCode, code) => {
  const { standard } = installVendor();
  standard.openPad.mockRejectedValueOnce({ errorCode, errorMessage: 'test detail' });

  await expect(createDriver().connect()).rejects.toMatchObject({
    code, driverCode: errorCode, message: 'test detail',
  });
  expect(standard.startSignature).not.toHaveBeenCalled();
});

it('возвращает pad_not_found при пустом результате поиска', async () => {
  const { standard } = installVendor();
  standard.searchForPads.mockResolvedValueOnce({ command: 'test', returnCode: 0, foundPads: [] });

  await expect(createDriver().connect()).rejects.toMatchObject({ code: 'pad_not_found' });
  expect(standard.openPad).not.toHaveBeenCalled();
});

it('очищает подпись по событию повтора и остаётся в том же захвате', async () => {
  const { standard } = installVendor();
  const driver = createDriver();
  await driver.connect();
  const result = driver.capture(options);

  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledOnce());
  standard.handleRetrySignature?.();
  expect(standard.retrySignature).toHaveBeenCalledOnce();
  expect(standard.getSignatureImage).not.toHaveBeenCalled();
  standard.handleConfirmSignature?.();

  await expect(result).resolves.toMatchObject({ imagePngBase64: png });
  expect(standard.startSignature).toHaveBeenCalledOnce();
});

it('отменяет захват по кнопке планшета и открывает планшет повторно без нового WebSocket', async () => {
  const { calls, standard } = installVendor();
  const driver = createDriver();
  await driver.connect();
  const failure = expect(driver.capture(options)).rejects.toMatchObject({ code: 'cancelled' });

  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledOnce());
  standard.handleCancelSignature?.();
  await failure;
  expect(calls.slice(-2)).toEqual(['cancelSignature', 'closePad']);
  expect(standard.getSignatureImage).not.toHaveBeenCalled();

  const result = driver.capture(options);
  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledTimes(2));
  standard.handleConfirmSignature?.();
  await expect(result).resolves.toMatchObject({ imagePngBase64: png });
  expect(calls.filter((call) => call === 'createConnection')).toHaveLength(1);
  expect(standard.openPad).toHaveBeenCalledTimes(2);
});

it('обрабатывает abort даже пока startSignature ждёт ответа', async () => {
  const { standard } = installVendor();
  const controller = new AbortController();
  const driver = createDriver();
  await driver.connect();
  standard.startSignature.mockReturnValueOnce(new Promise(() => {}));
  const failure = expect(driver.capture({ ...options, signal: controller.signal })).rejects.toMatchObject({
    code: 'cancelled',
  });

  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledOnce());
  controller.abort();
  await failure;
  expect(standard.cancelSignature).toHaveBeenCalledOnce();
  expect(standard.closePad).toHaveBeenCalledOnce();
  expect(standard.confirmSignature).not.toHaveBeenCalled();
});

it('не начинает захват с уже прерванным сигналом', async () => {
  const { calls } = installVendor();

  await expect(createDriver().capture({ ...options, signal: AbortSignal.abort() }))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(calls).toEqual([]);
});

it('прерывает ожидание подписи через три минуты', async () => {
  vi.useFakeTimers();
  const { standard } = installVendor();
  const driver = createDriver();
  await driver.connect();
  const failure = expect(driver.capture(options)).rejects.toMatchObject({ code: 'timeout' });

  await vi.advanceTimersByTimeAsync(179_999);
  expect(standard.cancelSignature).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await failure;
  expect(standard.cancelSignature).toHaveBeenCalledOnce();
  expect(standard.closePad).toHaveBeenCalledOnce();
});

it('возвращает PNG при отказе getSignatureData и пишет предупреждение без содержимого подписи', async () => {
  const { standard } = installVendor();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  standard.getSignatureData.mockRejectedValueOnce({ errorCode: -25, errorMessage: 'no SignData' });
  const driver = createDriver();
  await driver.connect();
  const result = driver.capture(options);

  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledOnce());
  standard.handleConfirmSignature?.();
  await expect(result).resolves.toEqual({ imagePngBase64: png, imageWidth: 319, imageHeight: 147 });
  expect(warn).toHaveBeenCalledWith('Не удалось получить SignData от signotec', -25);
  expect(standard.closePad).toHaveBeenCalledOnce();
});

it('отклоняет картинку с неверной сигнатурой PNG и закрывает планшет', async () => {
  const { standard } = installVendor();
  standard.getSignatureImage.mockResolvedValueOnce({ command: 'test', returnCode: 0, file: signData });
  const driver = createDriver();
  await driver.connect();
  const failure = expect(driver.capture(options)).rejects.toMatchObject({
    code: 'unknown', message: 'Планшет signotec вернул некорректное PNG-изображение',
  });

  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledOnce());
  standard.handleConfirmSignature?.();
  await failure;
  expect(standard.getSignatureData).not.toHaveBeenCalled();
  expect(standard.closePad).toHaveBeenCalledOnce();
});

it('отклоняет параллельный захват и позволяет отменить первый через cancel()', async () => {
  const { standard } = installVendor();
  const driver = createDriver();
  await driver.connect();
  const first = expect(driver.capture(options)).rejects.toMatchObject({ code: 'cancelled' });

  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledOnce());
  await expect(driver.capture(options)).rejects.toMatchObject({ code: 'unknown', message: 'Подпись уже идёт' });
  await expect(driver.cancel()).resolves.toBeUndefined();
  await first;
  expect(standard.startSignature).toHaveBeenCalledOnce();
  expect(standard.cancelSignature).toHaveBeenCalledOnce();
});

it('закрывает планшет и WebSocket при disconnect() даже при ошибках очистки', async () => {
  const { commons, standard } = installVendor();
  const driver = createDriver();
  await driver.connect();
  const failure = expect(driver.capture(options)).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledOnce());
  standard.cancelSignature.mockRejectedValueOnce(new Error('cancel failed'));
  standard.closePad.mockRejectedValueOnce(new Error('close failed'));
  commons.destroyConnection.mockImplementationOnce(() => { throw new Error('already disconnected'); });

  await expect(driver.disconnect()).resolves.toBeUndefined();
  await failure;
  expect(standard.cancelSignature).toHaveBeenCalledOnce();
  expect(standard.closePad).toHaveBeenCalledOnce();
  expect(commons.destroyConnection).toHaveBeenCalledOnce();
});

it('завершает ожидание при отключении планшета от USB и подключается заново', async () => {
  const { commons, standard } = installVendor();
  const driver = createDriver();
  await driver.connect();
  const failure = expect(driver.capture(options)).rejects.toMatchObject({ code: 'pad_not_found' });
  await vi.waitFor(() => expect(standard.startSignature).toHaveBeenCalledOnce());
  commons.handleDisconnect?.(0);
  await failure;
  await driver.connect();

  expect(commons.createConnection).toHaveBeenCalledTimes(2);
  expect(standard.openPad).toHaveBeenCalledTimes(2);
});

it('открывает первый найденный планшет, даже если индекс начинается не с нуля или пришёл строкой', async () => {
  const { standard } = installVendor();
  standard.searchForPads = vi.fn(async () => ({
    command: 'test', returnCode: 0, foundPads: [{ index: '1' as unknown as number }],
  }));
  const driver = new SignotecPadDriver();
  await driver.connect();
  expect(standard.openPad).toHaveBeenCalledWith(expect.objectContaining({ padIndex: 1 }));
  await driver.disconnect();
  expect(standard.closePad).toHaveBeenCalledWith(expect.objectContaining({ padIndex: 1 }));
});
