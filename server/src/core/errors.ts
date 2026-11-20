import type { ApiErrorCode } from '@e-sign/shared';

/** Ошибка ядра: код совпадает с ApiErrorCode, чтобы сервер мог отдать её как есть. */
export class CoreError extends Error {
  readonly code: Extract<ApiErrorCode, 'pdf_encrypted' | 'pdf_invalid' | 'invalid_blocks' | 'invalid_signature'>;

  constructor(code: CoreError['code'], message: string) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
  }
}
