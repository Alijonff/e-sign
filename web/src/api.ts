import type {
  ApiError,
  DocumentInfo,
  LoginRequest,
  SessionResponse,
  SignRequest,
  SignResponse,
} from '@e-sign/shared';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiError['error']['code'];
  readonly details?: unknown;

  constructor(status: number, error: ApiError['error']) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

async function request(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...options, credentials: 'same-origin' });
  if (response.ok) return response;

  const body: ApiError | undefined = await response.json().catch(() => undefined);
  const error = body?.error;
  if (typeof error?.code === 'string' && typeof error.message === 'string') {
    throw new ApiClientError(response.status, error);
  }

  throw new ApiClientError(response.status, {
    code: 'internal',
    message: `Запрос завершился ошибкой (HTTP ${response.status}).`,
  });
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  return (await request(url, options)).json();
}

function postJson(body: LoginRequest | SignRequest): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function documentUrl(id: string): string {
  return `/api/documents/${encodeURIComponent(id)}`;
}

export function getSession(): Promise<SessionResponse> {
  return requestJson('/api/session');
}

export async function login(input: LoginRequest): Promise<void> {
  await request('/api/login', postJson(input));
}

export async function logout(): Promise<void> {
  await request('/api/logout', { method: 'POST' });
}

export function uploadDocument(file: File): Promise<DocumentInfo> {
  const body = new FormData();
  body.append('file', file);
  return requestJson('/api/documents', { method: 'POST', body });
}

export function getDocument(id: string): Promise<DocumentInfo> {
  return requestJson(documentUrl(id));
}

export function signDocument(id: string, input: SignRequest): Promise<SignResponse> {
  return requestJson(`${documentUrl(id)}/sign`, postJson(input));
}

export function documentFileUrl(id: string): string {
  return `${documentUrl(id)}/file`;
}

export function signedFileUrl(id: string): string {
  return `${documentUrl(id)}/signed`;
}
