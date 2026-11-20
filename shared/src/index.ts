/**
 * Контракт между фронтендом и сервером и интерфейс планшета.
 * Файл пишет Claude; Codex его не меняет (если не хватает поля — state "question").
 */

// ───────────── Блок подписи ─────────────

/**
 * Блок подписи на странице документа.
 * Все четыре числа — доли ВИДИМОЙ страницы (с учётом поворота /Rotate), от 0 до 1.
 * Начало координат — левый верхний угол видимой страницы, ось y направлена вниз.
 * Так блок не зависит от масштаба просмотра и от поворота страницы.
 */
export interface SignatureBlock {
  /** Уникальный в пределах запроса идентификатор (задаёт фронтенд). */
  id: string;
  /** Номер страницы, считая с 0. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Минимальный размер блока: доля видимой страницы по каждой оси. */
export const MIN_BLOCK_FRACTION = 0.02;
/** Максимум блоков в одном документе. */
export const MAX_BLOCKS = 50;

// ───────────── Документ ─────────────

export interface PageInfo {
  /** Видимая ширина страницы в пунктах PDF (с учётом поворота). */
  width: number;
  /** Видимая высота страницы в пунктах PDF (с учётом поворота). */
  height: number;
  /** Поворот страницы по /Rotate: 0, 90, 180 или 270. */
  rotation: 0 | 90 | 180 | 270;
}

export interface DocumentInfo {
  id: string;
  name: string;
  sizeBytes: number;
  pageCount: number;
  pages: PageInfo[];
  createdAt: string;
  /** Есть ли подписанная версия. */
  signed: boolean;
}

// ───────────── API ─────────────
//
//  POST /api/login                    LoginRequest            → 204 + cookie «sid» (HttpOnly, Secure, SameSite=Lax)
//  POST /api/logout                                           → 204
//  GET  /api/session                                          → 200 {authenticated: boolean}
//  POST /api/documents                multipart, поле «file»  → 201 DocumentInfo
//  GET  /api/documents/:id                                    → 200 DocumentInfo
//  GET  /api/documents/:id/file                               → 200 application/pdf (оригинал)
//  POST /api/documents/:id/sign       SignRequest             → 200 SignResponse
//  GET  /api/documents/:id/signed                             → 200 application/pdf (подписанный)
//
// Ошибки — HTTP-статус и тело ApiError.

export interface LoginRequest {
  password: string;
}

export interface SessionResponse {
  authenticated: boolean;
}

export interface SignatureInput {
  /** PNG подписи в Base64 без префикса data:. */
  imagePngBase64: string;
  /** SignData планшета в Base64 (биометрия, для хранения), если драйвер её отдаёт. */
  signDataBase64?: string;
  /** Какой драйвер получил подпись. */
  padKind: PadKind;
}

export interface SignRequest {
  blocks: SignatureBlock[];
  signature: SignatureInput;
}

export interface SignResponse {
  document: DocumentInfo;
  /** Сколько блоков заполнено. */
  stampedBlocks: number;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_pdf'
  | 'pdf_encrypted'
  | 'pdf_invalid'
  | 'file_too_large'
  | 'document_not_found'
  | 'invalid_blocks'
  | 'invalid_signature'
  | 'internal';

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

// ───────────── Планшет ─────────────

export type PadKind = 'mock' | 'signotec';

export type PadErrorCode =
  /** Служба signoPAD-API/Web не отвечает (не установлена, не запущена, сертификат не доверен). */
  | 'service_unavailable'
  /** Служба работает, но планшет не найден или занят. */
  | 'pad_not_found'
  /** Клиент или сотрудник отменил подпись. */
  | 'cancelled'
  /** Не дождались подписи. */
  | 'timeout'
  | 'unknown';

export class PadError extends Error {
  readonly code: PadErrorCode;
  /** Исходный код ошибки драйвера (у signotec — отрицательное число errorCode). */
  readonly driverCode?: number;

  constructor(code: PadErrorCode, message: string, driverCode?: number) {
    super(message);
    this.name = 'PadError';
    this.code = code;
    if (driverCode !== undefined) this.driverCode = driverCode;
  }
}

export interface CaptureOptions {
  /** Короткий текст подтверждения для экрана планшета: «Подписываю документ № … от …». */
  prompt: string;
  /** Прервать ожидание подписи. */
  signal?: AbortSignal;
}

export interface SignatureCapture {
  /** PNG подписи в Base64 без префикса data:. */
  imagePngBase64: string;
  /** Ширина и высота PNG в пикселях. */
  imageWidth: number;
  imageHeight: number;
  /** SignData в Base64 (если драйвер её отдаёт). */
  signDataBase64?: string;
}

/**
 * Планшет подписи. Реализации: `mock` (рисование мышью, для разработки) и `signotec` (signoPAD-API/Web).
 * Порядок: connect → capture (можно много раз) → disconnect. Ошибки — только PadError.
 */
export interface PadDriver {
  readonly kind: PadKind;
  /** Подключиться к службе и открыть планшет. */
  connect(): Promise<void>;
  /** Показать запрос на планшете и дождаться подтверждённой подписи. Отмена → PadError('cancelled'). */
  capture(options: CaptureOptions): Promise<SignatureCapture>;
  /** Прервать текущую подпись (если идёт). Не бросает ошибок. */
  cancel(): Promise<void>;
  /** Закрыть планшет и соединение. Не бросает ошибок. */
  disconnect(): Promise<void>;
}
