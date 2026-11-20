import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const password = 'вымышленный пароль';
const secret = 'test-session-secret';
const sessionAgeSeconds = 12 * 60 * 60;
let dataDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'e-sign-auth-'));
  app = buildApp(loadConfig({ NODE_ENV: 'test', APP_PASSWORD: password, SESSION_SECRET: secret, DATA_DIR: dataDir }));
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function login(input: string, remoteAddress?: string) {
  return app.inject({ method: 'POST', url: '/api/login', payload: { password: input }, remoteAddress });
}

function hmac(expiresAt: string) {
  return createHmac('sha256', secret).update(expiresAt).digest('hex');
}

it('создаёт подписанную cookie на 12 часов и сбрасывает её при выходе', async () => {
  const before = Date.now();
  const response = await login(password);
  expect(response.statusCode).toBe(204);
  expect(response.cookies).toHaveLength(1);
  const sid = response.cookies[0]!;
  expect(sid).toMatchObject({
    name: 'sid', httpOnly: true, sameSite: 'Lax', path: '/', maxAge: sessionAgeSeconds,
  });
  expect(sid.secure).toBeFalsy();

  const [expiresAt, mac] = sid.value.split('.');
  expect(Number(expiresAt)).toBeGreaterThanOrEqual(before + sessionAgeSeconds * 1000);
  expect(Number(expiresAt)).toBeLessThanOrEqual(Date.now() + sessionAgeSeconds * 1000);
  expect(mac).toBe(hmac(expiresAt!));

  const session = await app.inject({ url: '/api/session', cookies: { sid: sid.value } });
  expect(session.json()).toEqual({ authenticated: true });

  const logout = await app.inject({ method: 'POST', url: '/api/logout', cookies: { sid: sid.value } });
  expect(logout.statusCode).toBe(204);
  expect(logout.cookies[0]).toMatchObject({ name: 'sid', value: '', path: '/', expires: new Date(0) });
  expect((await app.inject('/api/session')).json()).toEqual({ authenticated: false });
});

it('добавляет Secure к cookie в production', async () => {
  const production = buildApp(loadConfig({
    NODE_ENV: 'production', APP_PASSWORD: password, SESSION_SECRET: secret, DATA_DIR: dataDir,
  }));
  try {
    const response = await production.inject({ method: 'POST', url: '/api/login', payload: { password } });
    expect(response.statusCode).toBe(204);
    expect(response.cookies[0]).toMatchObject({ name: 'sid', secure: true });
  } finally {
    await production.close();
  }
});

it('возвращает 401 за неверный пароль и 400 при неверном формате запроса', async () => {
  const denied = await login('неверный');
  expect(denied.statusCode).toBe(401);
  expect(denied.json()).toMatchObject({ error: { code: 'unauthorized' } });
  expect(denied.cookies).toEqual([]);
  const invalid = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 123 } });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json()).toMatchObject({ error: { code: 'bad_request' } });
});

it('ограничивает вход десятью запросами в минуту с одного адреса', async () => {
  for (let i = 0; i < 10; i++) {
    expect((await login('неверный', '192.0.2.1')).statusCode).toBe(401);
  }
  const limited = await login(password, '192.0.2.1');
  expect(limited.statusCode).toBe(429);
  expect(limited.json()).toMatchObject({ error: { code: 'bad_request', message: expect.any(String) } });
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect((await login(password, '192.0.2.2')).statusCode).toBe(204);
  expect((await app.inject({ url: '/api/session', remoteAddress: '192.0.2.1' })).statusCode).toBe(200);
});

it('отклоняет защищённые запросы без cookie и с просроченной или изменённой cookie', async () => {
  const expired = String(Date.now() - 1000);
  const future = String(Date.now() + 1000);
  const id = randomUUID();
  const requests = [
    { method: 'POST' as const, url: '/api/documents' },
    { method: 'GET' as const, url: '/api/documents/' + id },
    { method: 'GET' as const, url: '/api/documents/' + id + '/file' },
    { method: 'GET' as const, url: '/api/documents/' + id + '/signed' },
    { method: 'POST' as const, url: '/api/documents/' + id + '/sign' },
    { method: 'GET' as const, url: '/api/unknown' },
  ];
  for (const request of requests) {
    const response = await app.inject(request);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'unauthorized' } });
  }
  for (const sid of [expired + '.' + hmac(expired), future + '.' + hmac(expired), 'invalid']) {
    const session = await app.inject({ url: '/api/session', cookies: { sid } });
    expect(session.json()).toEqual({ authenticated: false });
    expect((await app.inject({ url: '/api/documents/' + id, cookies: { sid } })).statusCode).toBe(401);
  }
  expect((await app.inject('/health')).statusCode).toBe(200);
});
