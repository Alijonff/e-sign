import { MIN_BLOCK_FRACTION, type SignatureBlock } from '@e-sign/shared';
import { describe, expect, it } from 'vitest';
import { clampBlock, createBlockFromDrag, moveBlock, resizeBlock, sortBlocks, type ResizeHandle } from './blocks';

const page = { width: 100, height: 200 };
const block: SignatureBlock = { id: 'example', page: 1, x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

describe('createBlockFromDrag', () => {
  it('возвращает одинаковые доли для прямого и обратного протягивания', () => {
    const start = { x: 25, y: 50 };
    const end = { x: 75, y: 150 };
    const expected = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    expect(createBlockFromDrag(start, end, page)).toEqual(expected);
    expect(createBlockFromDrag(end, start, page)).toEqual(expected);
  });

  it('обрезает координаты по видимой области', () => {
    expect(createBlockFromDrag({ x: -25, y: -50 }, { x: 125, y: 300 }, page))
      .toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(createBlockFromDrag({ x: 90, y: 180 }, { x: 120, y: 250 }, page))
      .toEqual({ x: 0.9, y: 0.9, width: 0.1, height: 0.1 });
  });

  it('проверяет минимальный размер по обеим осям', () => {
    const start = { x: 50, y: 100 };
    expect(createBlockFromDrag(start, { x: 51, y: 110 }, page)).toBeUndefined();
    expect(createBlockFromDrag(start, { x: 55, y: 103 }, page)).toBeUndefined();
    expect(createBlockFromDrag(start, { x: 52, y: 104 }, page))
      .toEqual({ x: 0.5, y: 0.5, width: MIN_BLOCK_FRACTION, height: MIN_BLOCK_FRACTION });
  });
});

it('clampBlock ограничивает размер и положение, сохраняя страницу и id', () => {
  expect(clampBlock({ ...block, width: 2, height: 0, x: -1, y: 2 })).toEqual({
    ...block, width: 1, height: MIN_BLOCK_FRACTION, x: 0, y: 1 - MIN_BLOCK_FRACTION,
  });
});

it('moveBlock упирается в края и сохраняет размер', () => {
  expect(moveBlock(block, 0.8, -0.8)).toEqual({ ...block, x: 0.5, y: 0 });
  expect(moveBlock(block, -0.8, 0.8)).toEqual({ ...block, x: 0, y: 0.5 });
});

const corners = [
  { handle: 'nw', dx: -1, dy: -1, x: 0, y: 0 },
  { handle: 'ne', dx: 1, dy: -1, x: 0.25, y: 0 },
  { handle: 'sw', dx: -1, dy: 1, x: 0, y: 0.25 },
  { handle: 'se', dx: 1, dy: 1, x: 0.25, y: 0.25 },
] satisfies { handle: ResizeHandle; dx: number; dy: number; x: number; y: number }[];

it.each(corners)('resizeBlock ограничивает угол $handle краями листа и минимальным размером', ({ handle, dx, dy, x, y }) => {
  expect(resizeBlock(block, handle, dx, dy)).toEqual({ ...block, x, y, width: 0.75, height: 0.75 });

  const resized = resizeBlock(block, handle, -dx, -dy);
  expect(resized.width).toBeCloseTo(MIN_BLOCK_FRACTION);
  expect(resized.height).toBeCloseTo(MIN_BLOCK_FRACTION);
  if (dx < 0) expect(resized.x + resized.width).toBeCloseTo(block.x + block.width);
  else expect(resized.x).toBe(block.x);
  if (dy < 0) expect(resized.y + resized.height).toBeCloseTo(block.y + block.height);
  else expect(resized.y).toBe(block.y);
});

it('sortBlocks упорядочивает блоки по странице, высоте и положению слева направо', () => {
  const blocks = [
    { ...block, id: 'right' },
    { ...block, id: 'first', page: 0, y: 0.9 },
    { ...block, id: 'top', y: 0.1 },
    { ...block, id: 'left', x: 0.1 },
  ];
  expect(sortBlocks(blocks).map(({ id }) => id)).toEqual(['first', 'top', 'left', 'right']);
  expect(blocks[0]?.id).toBe('right');
});
