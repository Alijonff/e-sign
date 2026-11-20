import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function passwordHash(password: string): Buffer {
  return createHash('sha256').update(password).digest();
}

export function passwordsMatch(password: string, expected: string): boolean {
  return timingSafeEqual(passwordHash(password), passwordHash(expected));
}

function sessionMac(expiresAt: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(expiresAt).digest();
}

export function createSession(secret: string): string {
  const expiresAt = String(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  return `${expiresAt}.${sessionMac(expiresAt, secret).toString('hex')}`;
}

export function isSessionValid(value: string | undefined, secret: string): boolean {
  const [, expiresAt, mac] = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(value ?? '') ?? [];
  if (!expiresAt || !mac) return false;
  const expiresAtMs = Number(expiresAt);
  return Number.isSafeInteger(expiresAtMs) && expiresAtMs > Date.now()
    && timingSafeEqual(Buffer.from(mac, 'hex'), sessionMac(expiresAt, secret));
}
