import { PadError } from '@e-sign/shared';
import { translateError } from './errors';
import { loadSignotec } from './loader';
import type { SignotecDefault, SignotecLibrary } from './vendor.d';

const PAD_INDEX = 0;
const PEN_WIDTH_PX = 3;
const CONNECTION_TIMEOUT_MS = 8_000;

// У пространства имён библиотеки один WebSocket и один набор обработчиков на страницу.
let activeConnection: AbortSignal | undefined;

export async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: (() => void) | undefined;
  const interruption = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([interruption, work]);
    signal.throwIfAborted();
    return result;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

interface CaptureEvents {
  confirm(): void;
  retry(): void;
  cancel(): void;
  error(error: PadError): void;
}

export class SignotecVendor {
  private readonly lifetime = new AbortController();
  readonly signal = this.lifetime.signal;
  private library?: SignotecLibrary;
  private restoreDisconnect?: () => void;

  async connect(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const library = await untilAborted(loadSignotec(), this.signal);
      this.signal.throwIfAborted();
      if (activeConnection) throw new PadError('pad_not_found', 'Планшет signotec уже используется');
      activeConnection = this.signal;
      this.library = library;
      const { commons } = library;
      const previous = commons.handleDisconnect;
      commons.handleDisconnect = (padIndex) => {
        if (padIndex === PAD_INDEX) this.destroy(new PadError('pad_not_found', 'Планшет signotec отключён'));
      };
      this.restoreDisconnect = () => { commons.handleDisconnect = previous; };

      const onSocketFailure = () => {
        this.destroy(new PadError('service_unavailable', 'Служба signoPAD-API/Web недоступна'));
      };
      const opening = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.destroy(new PadError('service_unavailable', 'Служба signoPAD-API/Web не ответила за 8 секунд'));
        }, CONNECTION_TIMEOUT_MS);
        const url = import.meta.env.VITE_SIGNOTEC_WS_URL || 'wss://local.signotecwebsocket.de:49494';
        commons.createConnection(url, () => resolve(), onSocketFailure, onSocketFailure);
      });
      await untilAborted(opening, this.signal);
    } catch (error) {
      const failure = translateError(error, 'service_unavailable');
      this.destroy(failure);
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }

  destroy(reason = new PadError('service_unavailable', 'Соединение со службой signotec закрыто')): void {
    if (this.signal.aborted) return;
    this.lifetime.abort(reason);
    if (activeConnection !== this.signal) return;

    try {
      this.restoreDisconnect?.();
      this.library?.commons.destroyConnection();
    } catch {
      // WebSocket мог уже закрыться.
    } finally {
      activeConnection = undefined;
      this.library = undefined;
    }
  }

  async openPad(): Promise<void> {
    try {
      const { foundPads } = await this.call((standard) => {
        const params = new standard.Params.searchForPads();
        params.setPadSubset('HID');
        return standard.searchForPads(params);
      });
      console.info('signotec: searchForPads', foundPads);
      if (!foundPads.some((pad) => pad.index === PAD_INDEX)) {
        throw new PadError('pad_not_found', `Служба signotec не видит планшет (найдено устройств: ${foundPads.length})`);
      }
      await this.call((standard) => standard.openPad(new standard.Params.openPad(PAD_INDEX)));
    } catch (error) {
      throw translateError(error);
    }
  }

  watchCapture(events: CaptureEvents): () => void {
    const standard = this.standardMode();
    const confirm = standard.handleConfirmSignature;
    const retry = standard.handleRetrySignature;
    const cancel = standard.handleCancelSignature;
    const error = standard.handleError;
    const onError: NonNullable<SignotecDefault['handleError']> = (_context, errorCode, errorMessage) => {
      events.error(translateError({ errorCode, errorMessage }));
    };

    standard.handleConfirmSignature = events.confirm;
    standard.handleRetrySignature = events.retry;
    standard.handleCancelSignature = events.cancel;
    standard.handleError = onError;

    return () => {
      if (standard.handleConfirmSignature === events.confirm) standard.handleConfirmSignature = confirm;
      if (standard.handleRetrySignature === events.retry) standard.handleRetrySignature = retry;
      if (standard.handleCancelSignature === events.cancel) standard.handleCancelSignature = cancel;
      if (standard.handleError === onError) standard.handleError = error;
    };
  }

  startSignature(fieldName: string, prompt: string): Promise<unknown> {
    return this.call((standard) => {
      const params = new standard.Params.startSignature();
      params.setFieldName(fieldName);
      params.setCustomText(prompt);
      return standard.startSignature(params);
    });
  }

  confirmSignature(): Promise<unknown> {
    return this.call((standard) => standard.confirmSignature());
  }

  retrySignature(): Promise<unknown> {
    return this.call((standard) => standard.retrySignature());
  }

  cancelSignature(): Promise<unknown> {
    return this.call((standard) => standard.cancelSignature());
  }

  getSignatureImage(): Promise<string> {
    return this.call((standard) => {
      const params = new standard.Params.getSignatureImage();
      params.setFileType(standard.FileType.PNG);
      params.setPenWidth(PEN_WIDTH_PX);
      return standard.getSignatureImage(params);
    }).then(({ file }) => file);
  }

  getSignatureData(): Promise<string> {
    return this.call((standard) => {
      const params = new standard.Params.getSignatureData();
      return standard.getSignatureData(params);
    }).then(({ signData }) => signData);
  }

  closePad(): Promise<unknown> {
    return this.call((standard) => standard.closePad(new standard.Params.closePad(PAD_INDEX)));
  }

  private standardMode(): SignotecDefault {
    this.signal.throwIfAborted();
    if (!this.library) throw new PadError('service_unavailable', 'Библиотека signotec не подключена');
    return this.library.standard;
  }

  private async call<T>(invoke: (standard: SignotecDefault) => Promise<T>): Promise<T> {
    try {
      return await untilAborted(invoke(this.standardMode()), this.signal);
    } catch (error) {
      throw translateError(error);
    }
  }
}
