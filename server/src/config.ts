import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  host: string;
  appPassword: string;
  sessionSecret: string;
  dataDir: string;
  maxUploadMb: number;
  retentionDays: number;
  nodeEnv: string;
}

const processSessionSecret = randomBytes(32).toString('hex');

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = Number(env[name]?.trim() || fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} должен быть целым числом от ${min} до ${max}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV || 'development';
  const appPassword = env.APP_PASSWORD;
  if (!appPassword) {
    if (nodeEnv === 'production') {
      throw new Error('В production необходимо задать APP_PASSWORD');
    }
    console.warn('APP_PASSWORD не задан; используется пароль dev');
  }

  return {
    port: readInteger(env, 'PORT', 3000, 0, 65535),
    host: env.HOST || '0.0.0.0',
    appPassword: appPassword || 'dev',
    sessionSecret: env.SESSION_SECRET || processSessionSecret,
    dataDir: env.DATA_DIR || './data',
    maxUploadMb: readInteger(env, 'MAX_UPLOAD_MB', 25, 1),
    retentionDays: readInteger(env, 'RETENTION_DAYS', 7, 1),
    nodeEnv,
  };
}
