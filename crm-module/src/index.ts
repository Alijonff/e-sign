/**
 * Модуль подписи для CRM. Собирается в один файл esign-module.js и создаёт глобальный объект ESign:
 *   ESign.mountMarker(контейнер, параметры)    разметка блоков подписи на страницах PDF
 *   ESign.createPad(параметры)                 драйвер планшета (connect / capture / cancel / disconnect)
 *   ESign.captureSignature(параметры)          подпись одним вызовом
 *   ESign.buildPrompt(имяДокумента)            текст для экрана планшета
 *   ESign.describeError(ошибка)                сообщение по-русски и технические подробности
 */
import { MAX_BLOCKS, MIN_BLOCK_FRACTION, PadError } from '@e-sign/shared';
import { buildPromptFromName } from '../../web/src/sign/prompt';

export type { PadDriver, PadErrorCode, SignatureBlock, SignatureCapture } from '@e-sign/shared';
export { mountMarker, type MarkerHandle, type MarkerOptions } from './mount';
export { captureSignature, createPad, describeError, type CaptureSignatureOptions, type DescribedError, type PadOptions } from './pad';

export const version = '0.1.0';
/** Версия библиотеки signotec, вшитой в модуль. */
export const signotecLibraryVersion = '3.5.0';
export const limits = { maxBlocks: MAX_BLOCKS, minBlockFraction: MIN_BLOCK_FRACTION } as const;
export { PadError };
export const buildPrompt = buildPromptFromName;
