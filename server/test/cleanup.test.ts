import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { cleanupExpired } from '../src/cleanup.js';
import { loadConfig } from '../src/config.js';

const now = new Date('2026-11-20T12:00:00.000Z');
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const old = new Date(now.getTime() - 2 * day);
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'e-sign-cleanup-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dataDir, { recursive: true, force: true });
});

async function createDocument(mtime: Date, meta?: string, id: string = randomUUID()): Promise<string> {
  const directory = join(dataDir, id);
  await mkdir(directory);
  if (meta !== undefined) await writeFile(join(directory, 'meta.json'), meta);
  await utimes(directory, mtime, mtime);
  return id;
}

function metaCreatedAt(createdAt: Date): string {
  return JSON.stringify({ createdAt, signedAt: now });
}

it('удаляет по дате создания, а при недоступной дате использует возраст каталога', async () => {
  const expired = await createDocument(now, metaCreatedAt(old));
  const current = await createDocument(old, metaCreatedAt(now));
  const boundary = await createDocument(now, metaCreatedAt(new Date(now.getTime() - day)));
  const expiredWithoutMeta = await createDocument(old);
  const expiredBrokenMeta = await createDocument(old, 'broken');
  const newBrokenMeta = await createDocument(now, '{}');
  const unrelated = await createDocument(old, undefined, 'other-directory');

  await cleanupExpired(dataDir, 1, now);
  const remaining = await readdir(dataDir);
  expect(remaining).toHaveLength(4);
  expect(remaining).toContain(current);
  expect(remaining).toContain(boundary);
  expect(remaining).toContain(newBrokenMeta);
  expect(remaining).toContain(unrelated);
  for (const id of [expired, expiredWithoutMeta, expiredBrokenMeta]) expect(remaining).not.toContain(id);
});

it('переносит отсутствующий каталог данных', async () => {
  await expect(cleanupExpired(join(dataDir, 'missing'), 1, now)).resolves.toBeUndefined();
});

it('запускает очистку при старте и каждый час, а при закрытии останавливает таймер', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(now);
  await createDocument(now, metaCreatedAt(old));
  const expiresSoon = await createDocument(now, metaCreatedAt(new Date(now.getTime() - day + hour / 2)));
  const app = buildApp(loadConfig({
    NODE_ENV: 'test', APP_PASSWORD: 'test', DATA_DIR: dataDir, RETENTION_DAYS: '1',
  }));
  try {
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect(await readdir(dataDir)).toEqual([expiresSoon]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(hour);
  } finally {
    await app.close();
  }
  expect(await readdir(dataDir)).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
