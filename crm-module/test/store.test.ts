import { MAX_BLOCKS, type SignatureBlock } from '@e-sign/shared';
import { expect, it, vi } from 'vitest';
import { BlockStore } from '../src/store';

const block = (id: string, page = 0): SignatureBlock => ({ id, page, x: 0.1, y: 0.1, width: 0.3, height: 0.1 });

it('добавляет, заменяет и удаляет блоки, сообщая об изменениях копиями', () => {
  const onChange = vi.fn();
  const store = new BlockStore([], onChange);
  store.save(block('a'));
  store.save({ ...block('a'), x: 0.5 });
  store.save(block('b', 1));
  expect(store.getBlocks().map((b) => [b.id, b.x])).toEqual([['a', 0.5], ['b', 0.1]]);
  expect(store.get().selectedId).toBe('b');
  store.remove('b');
  expect(store.get().selectedId).toBeUndefined();
  expect(store.getBlocks()).toHaveLength(1);
  expect(onChange).toHaveBeenCalledTimes(4);

  const copy = onChange.mock.calls[3]![0] as SignatureBlock[];
  copy[0]!.x = 0.9;
  expect(store.getBlocks()[0]!.x).toBe(0.5);
});

it('не добавляет блоки сверх лимита, но разрешает править существующие', () => {
  const many = Array.from({ length: MAX_BLOCKS }, (_, i) => block(`b${i}`));
  const store = new BlockStore(many);
  store.save(block('extra'));
  expect(store.getBlocks()).toHaveLength(MAX_BLOCKS);
  store.save({ ...block('b0'), y: 0.5 });
  expect(store.getBlocks()[0]!.y).toBe(0.5);
});

it('setBlocks и clear заменяют список; выбор сохраняется только для существующего блока', () => {
  const store = new BlockStore([block('a')]);
  store.select('a');
  store.setBlocks([block('a'), block('c')]);
  expect(store.get().selectedId).toBe('a');
  store.setBlocks([block('c')]);
  expect(store.get().selectedId).toBeUndefined();
  store.clear();
  expect(store.getBlocks()).toEqual([]);
});

it('подписчики получают уведомления и могут отписаться', () => {
  const store = new BlockStore();
  const listener = vi.fn();
  const off = store.subscribe(listener);
  store.save(block('a'));
  store.select('a');
  expect(listener).toHaveBeenCalledTimes(1);
  store.select(undefined);
  expect(listener).toHaveBeenCalledTimes(2);
  off();
  store.clear();
  expect(listener).toHaveBeenCalledTimes(2);
});
