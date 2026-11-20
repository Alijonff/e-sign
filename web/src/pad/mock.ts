import { PadError, type CaptureOptions, type PadDriver, type SignatureCapture } from '@e-sign/shared';

interface MockCapture {
  id: number;
  driver: MockPadDriver;
  prompt: string;
  confirm(signature: SignatureCapture): void;
  fail(error: PadError): void;
  cancel(): void;
}

let activeCapture: MockCapture | null = null;
let captureId = 0;
const listeners = new Set<() => void>();

export function subscribeMockCapture(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getMockCapture(): MockCapture | null {
  return activeCapture;
}

function setMockCapture(capture: MockCapture | null): void {
  activeCapture = capture;
  listeners.forEach((listener) => listener());
}

function cancelled(): PadError {
  return new PadError('cancelled', 'Подпись отменена');
}

export class MockPadDriver implements PadDriver {
  readonly kind = 'mock';

  async connect(): Promise<void> {}

  async capture({ prompt, signal }: CaptureOptions): Promise<SignatureCapture> {
    if (signal?.aborted) throw cancelled();
    if (activeCapture) throw new PadError('unknown', 'Подпись уже ожидается');

    return new Promise((resolve, reject) => {
      const close = (): boolean => {
        if (activeCapture !== request) return false;
        signal?.removeEventListener('abort', request.cancel);
        setMockCapture(null);
        return true;
      };

      const request: MockCapture = {
        id: ++captureId,
        driver: this,
        prompt,
        confirm(signature) {
          if (close()) resolve(signature);
        },
        fail(error) {
          if (close()) reject(error);
        },
        cancel() {
          request.fail(cancelled());
        },
      };

      signal?.addEventListener('abort', request.cancel, { once: true });
      setMockCapture(request);
    });
  }

  async cancel(): Promise<void> {
    if (activeCapture?.driver === this) activeCapture.cancel();
  }

  async disconnect(): Promise<void> {
    await this.cancel();
  }
}
