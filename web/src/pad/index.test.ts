import { afterEach, expect, it, vi } from 'vitest';
import { createPadDriver, defaultPadKind } from './index';
import { MockPadDriver } from './mock';
import { SignotecPadDriver } from './signotec';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
});

it('предпочитает параметр адреса переменной окружения', () => {
  vi.stubEnv('VITE_PAD_DRIVER', 'signotec');
  window.history.replaceState(null, '', '/doc/doc-1?pad=mock');

  expect(defaultPadKind()).toBe('mock');
});

it('использует переменную окружения при недопустимом параметре адреса', () => {
  vi.stubEnv('VITE_PAD_DRIVER', 'signotec');
  window.history.replaceState(null, '', '/?pad=other');

  expect(defaultPadKind()).toBe('signotec');
});

it('выбирает mock по умолчанию', () => {
  vi.stubEnv('VITE_PAD_DRIVER', undefined);

  expect(defaultPadKind()).toBe('mock');
});

it('создаёт запрошенную заглушку драйвера', async () => {
  expect(createPadDriver('mock')).toBeInstanceOf(MockPadDriver);
  const driver = createPadDriver('signotec');
  expect(driver).toBeInstanceOf(SignotecPadDriver);
  await expect(driver.connect()).rejects.toMatchObject({ code: 'unknown', message: 'Не реализовано' });
});
