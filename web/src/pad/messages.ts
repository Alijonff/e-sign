import { PadError } from '@e-sign/shared';

/** Понятное пользователю сообщение об ошибке планшета (по-русски). Общий источник для сайта и модуля CRM. */
export function padErrorMessage(error: PadError): string {
  switch (error.code) {
    case 'service_unavailable':
      return 'Служба планшета не отвечает. Проверьте, что signoPAD-API/Web запущена на этом компьютере';
    case 'pad_not_found':
      return 'Планшет не найден. Проверьте подключение по USB';
    case 'timeout':
      return 'Подпись не получена вовремя';
    case 'cancelled':
      return 'Подпись отменена';
    default:
      return `Ошибка планшета: ${error.message}`;
  }
}

/** Техническая строка для поддержки: код ошибки, исходное сообщение драйвера и его код. */
export function padErrorDetails(error: PadError): string {
  const code = error.driverCode === undefined ? '' : `, код ${error.driverCode}`;
  return `${error.code}: ${error.message}${code}`;
}
