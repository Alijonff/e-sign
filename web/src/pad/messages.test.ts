import { PadError } from '@e-sign/shared';
import { expect, it } from 'vitest';
import { padErrorDetails, padErrorMessage } from './messages';

it('сообщения по кодам ошибок планшета', () => {
  expect(padErrorMessage(new PadError('service_unavailable', 'x'))).toContain('signoPAD-API/Web');
  expect(padErrorMessage(new PadError('pad_not_found', 'x'))).toBe('Планшет не найден. Проверьте подключение по USB');
  expect(padErrorMessage(new PadError('timeout', 'x'))).toBe('Подпись не получена вовремя');
  expect(padErrorMessage(new PadError('cancelled', 'x'))).toBe('Подпись отменена');
  expect(padErrorMessage(new PadError('unknown', 'сбой'))).toBe('Ошибка планшета: сбой');
});

it('технические подробности содержат код драйвера, если он есть', () => {
  expect(padErrorDetails(new PadError('pad_not_found', 'занят', -4))).toBe('pad_not_found: занят, код -4');
  expect(padErrorDetails(new PadError('timeout', 'долго'))).toBe('timeout: долго');
});
