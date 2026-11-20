import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { isDocumentId, isMissing } from './storage.js';

const HOUR_MS = 60 * 60 * 1000;

async function documentCreatedAt(directory: string): Promise<number> {
  try {
    const meta = JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8')) as
      { createdAt?: unknown } | null;
    if (typeof meta?.createdAt === 'string') {
      const createdAt = Date.parse(meta.createdAt);
      if (Number.isFinite(createdAt)) return createdAt;
    }
  } catch {
    // При нечитаемых метаданных используем возраст каталога.
  }
  return (await stat(directory)).mtimeMs;
}

export async function cleanupExpired(
  dataDir: string,
  retentionDays: number,
  now: Date | number = Date.now(),
): Promise<void> {
  const cutoff = Number(now) - retentionDays * 24 * HOUR_MS;
  try {
    const entries = await readdir(dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !isDocumentId(entry.name)) continue;
      const directory = join(dataDir, entry.name);
      try {
        if (await documentCreatedAt(directory) < cutoff) {
          await rm(directory, { recursive: true, force: true });
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export function registerCleanup(app: FastifyInstance, dataDir: string, retentionDays: number): void {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;

  function run(): Promise<void> {
    running ??= cleanupExpired(dataDir, retentionDays)
      .catch((error: unknown) => app.log.error({ err: error }, 'Ошибка очистки документов'))
      .finally(() => { running = undefined; });
    return running;
  }

  app.addHook('onReady', async () => {
    await run();
    timer = setInterval(() => { void run(); }, HOUR_MS).unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await running;
  });
}
