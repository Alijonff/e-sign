import { PadError, type PadErrorCode } from '@e-sign/shared';

// signoPAD-API/Web 3.5.0, §9.1. Неоднозначные коды остаются unknown.
const errorCodes: ReadonlyMap<number, PadErrorCode> = new Map([
  [-4, 'pad_not_found'], // Планшет занят другим приложением.
  [-5, 'pad_not_found'], // Связь с выбранным планшетом не открыта.
  [-8, 'pad_not_found'], // Нет устройства с этим индексом.
  [-22, 'pad_not_found'], // Нет совместимых устройств или планшет отключён.
  [-46, 'service_unavailable'], // Сертификат просрочен или ещё не действует.
  [-47, 'service_unavailable'], // Сертификат отозван.
  [-48, 'service_unavailable'], // Некорректная подпись сертификата.
]);

export function translateError(error: unknown, fallback: PadErrorCode = 'unknown'): PadError {
  if (error instanceof PadError) return error;
  if (error && typeof error === 'object' && 'errorCode' in error &&
      typeof error.errorCode === 'number' && error.errorCode < 0) {
    const message = 'errorMessage' in error && typeof error.errorMessage === 'string'
      ? error.errorMessage : 'Ошибка планшета signotec';
    return new PadError(errorCodes.get(error.errorCode) ?? 'unknown', message, error.errorCode);
  }
  return new PadError(fallback, error instanceof Error ? error.message : 'Ошибка планшета signotec');
}
