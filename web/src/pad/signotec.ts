import { PadError, type CaptureOptions, type PadDriver, type SignatureCapture } from '@e-sign/shared';
import { translateError } from './signotec/errors';
import { readSignaturePng } from './signotec/png';
import { SignotecVendor, untilAborted } from './signotec/vendor';

const CAPTURE_TIMEOUT_MS = 180_000;
const CLEANUP_TIMEOUT_MS = 8_000;
const FIELD_NAME = 'Подпись клиента';

interface PadSession {
  vendor: SignotecVendor;
  connection: Promise<void>;
  openingPad?: Promise<void>;
  padOpen: boolean;
}

interface CaptureAttempt {
  controller: AbortController;
  finished: Promise<SignatureCapture>;
}

function cancelled(): PadError {
  return new PadError('cancelled', 'Подпись отменена');
}

export class SignotecPadDriver implements PadDriver {
  readonly kind = 'signotec';
  private session?: PadSession;
  private attempt?: CaptureAttempt;
  private closing?: Promise<void>;

  async connect(): Promise<void> {
    try {
      const { ready } = this.preparePad();
      await ready;
    } catch (error) {
      throw translateError(error);
    }
  }

  async capture(options: CaptureOptions): Promise<SignatureCapture> {
    if (this.attempt) throw new PadError('unknown', 'Подпись уже идёт');
    if (options.signal?.aborted) throw cancelled();

    const controller = new AbortController();
    const finished = this.captureSignature(options, controller);
    this.attempt = { controller, finished };
    try {
      const signature = await finished;
      if (options.signal?.aborted) throw cancelled();
      return signature;
    } catch (error) {
      if (options.signal?.aborted) throw cancelled();
      throw translateError(error);
    } finally {
      this.attempt = undefined;
    }
  }

  async cancel(): Promise<void> {
    const attempt = this.attempt;
    if (!attempt) return;
    attempt.controller.abort(cancelled());
    try {
      await attempt.finished;
    } catch {
      // Ошибку получает только вызывающий capture().
    }
  }

  disconnect(): Promise<void> {
    this.closing ??= this.disconnectSession().finally(() => { this.closing = undefined; });
    return this.closing;
  }

  private preparePad(): { session: PadSession; ready: Promise<void> } {
    if (this.closing) throw new PadError('service_unavailable', 'Соединение с планшетом закрывается');
    if (!this.session || this.session.vendor.signal.aborted) {
      const vendor = new SignotecVendor();
      this.session = { vendor, connection: vendor.connect(), padOpen: false };
    }

    const session = this.session;
    session.openingPad ??= this.openPad(session);
    return { session, ready: session.openingPad };
  }

  private async openPad(session: PadSession): Promise<void> {
    try {
      await session.connection;
      await session.vendor.openPad();
      session.padOpen = true;
    } catch (error) {
      session.openingPad = undefined;
      throw translateError(error);
    }
  }

  private async captureSignature(options: CaptureOptions, controller: AbortController): Promise<SignatureCapture> {
    const { session, ready } = this.preparePad();
    const { vendor } = session;
    const { signal } = controller;
    const onAbort = () => { void this.cancel(); };
    const onDisconnect = () => controller.abort(vendor.signal.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    vendor.signal.addEventListener('abort', onDisconnect, { once: true });
    const timer = setTimeout(() => {
      controller.abort(new PadError('timeout', 'Подпись не получена за 3 минуты'));
    }, CAPTURE_TIMEOUT_MS);

    let started = false;
    let confirmed = false;
    let stopWatching = () => {};
    let signature: SignatureCapture;
    try {
      await untilAborted(ready, signal);

      let confirm: () => void = () => {};
      const confirmation = new Promise<void>((resolve) => { confirm = resolve; });
      let confirmPressed = false;
      stopWatching = vendor.watchCapture({
        confirm: () => {
          confirmPressed = true;
          confirm();
        },
        retry: () => {
          if (confirmPressed || signal.aborted) return;
          void vendor.retrySignature().catch((error: unknown) => controller.abort(translateError(error)));
        },
        cancel: () => controller.abort(cancelled()),
        error: (error) => controller.abort(error),
      });

      started = true;
      await untilAborted(vendor.startSignature(FIELD_NAME, options.prompt), signal);
      await untilAborted(confirmation, signal);
      await untilAborted(vendor.confirmSignature(), signal);
      confirmed = true;
      stopWatching();

      signature = readSignaturePng(await untilAborted(vendor.getSignatureImage(), signal));
      try {
        const signData = await untilAborted(vendor.getSignatureData(), signal);
        if (signData) signature.signDataBase64 = signData;
      } catch (error) {
        const failure = translateError(error);
        if (failure.code === 'cancelled') throw failure;
        console.warn('Не удалось получить SignData от signotec', failure.driverCode ?? failure.code);
      }
    } catch (error) {
      throw translateError(error);
    } finally {
      clearTimeout(timer);
      stopWatching();
      vendor.signal.removeEventListener('abort', onDisconnect);
      try {
        await this.releasePad(session, started && !confirmed);
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
      }
    }

    if (signal.aborted && translateError(signal.reason).code === 'cancelled') throw cancelled();
    return signature;
  }

  private async releasePad(session: PadSession, cancelSignature: boolean): Promise<void> {
    const { vendor } = session;
    if (!session.padOpen) {
      // destroyConnection также закрывает планшет, если openPad ещё в пути.
      vendor.destroy();
      return;
    }

    const timer = setTimeout(() => vendor.destroy(), CLEANUP_TIMEOUT_MS);
    try {
      if (cancelSignature) {
        try {
          await vendor.cancelSignature();
        } catch {
          // Даже если отмена не удалась, closePad завершает захват.
        }
      }
      await vendor.closePad();
    } catch {
      vendor.destroy();
    } finally {
      clearTimeout(timer);
      session.padOpen = false;
      session.openingPad = undefined;
    }
  }

  private async disconnectSession(): Promise<void> {
    try {
      await this.cancel();
      const session = this.session;
      this.session = undefined;
      if (!session) return;
      if (session.padOpen) await this.releasePad(session, false);
      session.vendor.destroy();
    } catch {
      // Отключение безопасно при уже закрытых службе и планшете.
    }
  }
}
