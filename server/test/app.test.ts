import { expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

it('GET /health возвращает состояние сервера', async () => {
  const config = loadConfig({ NODE_ENV: 'test', APP_PASSWORD: 'test' });
  const app = buildApp(config);

  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  } finally {
    await app.close();
  }
});
