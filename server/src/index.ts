import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);
  await app.listen({ port: config.port, host: config.host });

  process.once('SIGTERM', () => {
    void app.close().catch((error: unknown) => {
      app.log.error(error, 'Не удалось завершить работу сервера');
      process.exitCode = 1;
    });
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
