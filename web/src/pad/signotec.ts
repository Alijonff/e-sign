import { PadError, type CaptureOptions, type PadDriver, type SignatureCapture } from '@e-sign/shared';

export class SignotecPadDriver implements PadDriver {
  readonly kind = 'signotec';

  async connect(): Promise<void> {
    throw new PadError('unknown', 'Не реализовано');
  }

  async capture(_options: CaptureOptions): Promise<SignatureCapture> {
    throw new PadError('unknown', 'Не реализовано');
  }

  async cancel(): Promise<void> {
    throw new PadError('unknown', 'Не реализовано');
  }

  async disconnect(): Promise<void> {
    throw new PadError('unknown', 'Не реализовано');
  }
}
