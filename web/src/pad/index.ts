import type { PadDriver, PadKind } from '@e-sign/shared';
import { MockPadDriver } from './mock';
import { SignotecPadDriver } from './signotec';

function parsePadKind(value: unknown): PadKind | undefined {
  if (value === 'mock' || value === 'signotec') return value;
}

export function createPadDriver(kind: PadKind): PadDriver {
  return kind === 'signotec' ? new SignotecPadDriver() : new MockPadDriver();
}

export function defaultPadKind(): PadKind {
  const queryPad = new URLSearchParams(window.location.search).get('pad');
  return parsePadKind(queryPad) ?? parsePadKind(import.meta.env.VITE_PAD_DRIVER) ?? 'mock';
}
