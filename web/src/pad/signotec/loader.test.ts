import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const scripts = () => Array.from(document.head.querySelectorAll('script'));

beforeEach(() => vi.resetModules());

afterEach(() => {
  scripts().forEach((script) => script.remove());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('подключает один скрипт по умолчанию для параллельных запросов и переиспользует библиотеку', async () => {
  const { loadSignotec } = await import('./loader');
  const first = loadSignotec();
  expect(loadSignotec()).toBe(first);
  expect(scripts()).toHaveLength(1);
  const script = scripts()[0];
  expect(script?.getAttribute('src')).toBe('/vendor/STPadServerLib.js');

  const commons = {};
  const standard = {};
  vi.stubGlobal('STPadServerLibCommons', commons);
  vi.stubGlobal('STPadServerLibDefault', standard);
  script?.dispatchEvent(new Event('load'));
  await expect(first).resolves.toEqual({ commons, standard });
  await expect(loadSignotec()).resolves.toEqual({ commons, standard });
  expect(scripts()).toHaveLength(1);
});

it('находит библиотеку в объекте window.STPadServerLib, как её создаёт signotec 3.5.0', async () => {
  const { loadSignotec } = await import('./loader');
  const pending = loadSignotec();
  const commons = { name: 'commons' };
  const standard = { name: 'standard' };
  vi.stubGlobal('STPadServerLib', { STPadServerLibCommons: commons, STPadServerLibDefault: standard });
  scripts()[0]?.dispatchEvent(new Event('load'));
  await expect(pending).resolves.toEqual({ commons, standard });
});

it.each(['error', 'load'])('возвращает service_unavailable и позволяет повторить загрузку после %s без библиотеки', async (event) => {
  vi.stubEnv('VITE_SIGNOTEC_LIB_URL', '/vendor/signotec-3.5.js');
  const { loadSignotec } = await import('./loader');
  const failure = expect(loadSignotec()).rejects.toMatchObject({
    name: 'PadError',
    code: 'service_unavailable',
    message: 'Библиотека signotec не найдена: положите файл в web/public/vendor/',
  });
  const script = scripts()[0];
  expect(script?.getAttribute('src')).toBe('/vendor/signotec-3.5.js');
  script?.dispatchEvent(new Event(event));
  await failure;
  expect(scripts()).toHaveLength(0);

  const retry = expect(loadSignotec()).rejects.toMatchObject({ code: 'service_unavailable' });
  expect(scripts()).toHaveLength(1);
  scripts()[0]?.dispatchEvent(new Event('error'));
  await retry;
});
