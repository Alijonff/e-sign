import { MIN_BLOCK_FRACTION, type SignatureBlock } from '@e-sign/shared';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type BlockRect = Pick<SignatureBlock, 'x' | 'y' | 'width' | 'height'>;
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

const min = MIN_BLOCK_FRACTION;

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper);
}

export function clampBlock<T extends BlockRect>(block: T): T {
  const width = clamp(block.width, min, 1);
  const height = clamp(block.height, min, 1);
  return {
    ...block,
    x: clamp(block.x, 0, 1 - width),
    y: clamp(block.y, 0, 1 - height),
    width,
    height,
  };
}

/** Точки указателя и размер области — в CSS-пикселях. Результат — в долях области. */
export function createBlockFromDrag(start: Point, end: Point, pageSize: Size): BlockRect | undefined {
  const { width: pageWidth, height: pageHeight } = pageSize;
  if (!(pageWidth > 0 && pageHeight > 0)) return undefined;

  const left = clamp(Math.min(start.x, end.x), 0, pageWidth);
  const top = clamp(Math.min(start.y, end.y), 0, pageHeight);
  const right = clamp(Math.max(start.x, end.x), 0, pageWidth);
  const bottom = clamp(Math.max(start.y, end.y), 0, pageHeight);
  const width = (right - left) / pageWidth;
  const height = (bottom - top) / pageHeight;
  if (width + Number.EPSILON < min || height + Number.EPSILON < min) return undefined;

  return clampBlock({ x: left / pageWidth, y: top / pageHeight, width, height });
}

export function moveBlock<T extends BlockRect>(block: T, dx: number, dy: number): T {
  return clampBlock({ ...block, x: block.x + dx, y: block.y + dy });
}

export function resizeBlock<T extends BlockRect>(block: T, handle: ResizeHandle, dx: number, dy: number): T {
  const right = block.x + block.width;
  const bottom = block.y + block.height;
  const west = handle === 'nw' || handle === 'sw';
  const north = handle === 'nw' || handle === 'ne';
  const left = west ? clamp(block.x + dx, 0, right - min) : block.x;
  const top = north ? clamp(block.y + dy, 0, bottom - min) : block.y;
  const newRight = west ? right : clamp(right + dx, left + min, 1);
  const newBottom = north ? bottom : clamp(bottom + dy, top + min, 1);

  return clampBlock({ ...block, x: left, y: top, width: newRight - left, height: newBottom - top });
}

export function sortBlocks(blocks: readonly SignatureBlock[]): SignatureBlock[] {
  return [...blocks].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}
