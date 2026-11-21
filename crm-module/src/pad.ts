import {
  PadError,
  type CaptureOptions,
  type PadDriver,
  type SignatureCapture,
} from '@e-sign/shared';
import { padErrorDetails, padErrorMessage } from '../../web/src/pad/messages';
import { SignotecPadDriver } from '../../web/src/pad/signotec';
import { signotecConfig } from '../../web/src/pad/signotec/config';

declare const __SIGNOTEC_LIB__: string;

export interface PadOptions {
  /** Адрес службы signotec. По умолчанию wss://local.signotecwebsocket.de:49494. */
  wsUrl?: string;
  /** Адрес файла STPadServerLib.js. Если не задан, используется библиотека, вшитая в модуль. */
  libUrl?: string;
}

function configure(options: PadOptions): void {
  signotecConfig.wsUrl = options.wsUrl;
  signotecConfig.libUrl = options.libUrl;
  signotecConfig.libSource = __SIGNOTEC_LIB__;
}

/** Создаёт драйвер планшета: connect() → capture() → disconnect(). Ошибки только типа PadError. */
export function createPad(options: PadOptions = {}): PadDriver {
  configure(options);
  return new SignotecPadDriver();
}

export interface CaptureSignatureOptions extends PadOptions {
  /** Текст для экрана планшета, например из buildPrompt(). */
  prompt: string;
  /** Прервать ожидание подписи. */
  signal?: AbortSignal;
}

/** Одним вызовом: подключиться, дождаться подписи, закрыть планшет. */
export async function captureSignature(options: CaptureSignatureOptions): Promise<SignatureCapture> {
  const pad = createPad(options);
  const captureOptions: CaptureOptions = options.signal
    ? { prompt: options.prompt, signal: options.signal }
    : { prompt: options.prompt };
  try {
    await pad.connect();
    return await pad.capture(captureOptions);
  } finally {
    await pad.disconnect();
  }
}

export interface DescribedError {
  code: string;
  /** Сообщение для пользователя по-русски. */
  message: string;
  /** Техническая строка для поддержки. */
  details: string;
}

/** Превращает любую ошибку в понятное сообщение и технические подробности. */
export function describeError(error: unknown): DescribedError {
  if (error instanceof PadError) {
    return { code: error.code, message: padErrorMessage(error), details: padErrorDetails(error) };
  }
  const text = error instanceof Error ? error.message : String(error);
  return { code: 'unknown', message: `Ошибка: ${text}`, details: text };
}
