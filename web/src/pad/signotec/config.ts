/**
 * Настройки драйвера signotec, которые можно менять во время работы (нужны модулю для CRM,
 * где адреса задаёт страница, а не сборка). Значения по умолчанию берутся из переменных сборки.
 */
export interface SignotecRuntimeConfig {
  /** Адрес службы signoPAD-API/Web, по умолчанию wss://local.signotecwebsocket.de:49494. */
  wsUrl?: string;
  /** Адрес файла библиотеки STPadServerLib.js. Если задан, библиотека грузится по нему. */
  libUrl?: string;
  /** Текст библиотеки, вшитый в модуль. Используется, когда libUrl не задан. */
  libSource?: string;
}

export const signotecConfig: SignotecRuntimeConfig = {};
