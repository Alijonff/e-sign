import { MAX_BLOCKS, type SignatureBlock } from '@e-sign/shared';

export interface MarkerState {
  blocks: SignatureBlock[];
  selectedId?: string;
}

/** Состояние разметки: список блоков и выбранный блок. Неизменяемые снимки для useSyncExternalStore. */
export class BlockStore {
  private state: MarkerState;
  private readonly listeners = new Set<() => void>();

  constructor(
    initial: SignatureBlock[] = [],
    private readonly onChange?: (blocks: SignatureBlock[]) => void,
  ) {
    this.state = { blocks: initial.slice(0, MAX_BLOCKS).map((block) => ({ ...block })) };
  }

  /** Стабильные ссылки: подходят как аргументы useSyncExternalStore. */
  readonly get = (): MarkerState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getBlocks(): SignatureBlock[] {
    return this.state.blocks.map((block) => ({ ...block }));
  }

  private update(next: MarkerState, changedBlocks: boolean): void {
    this.state = next;
    for (const listener of this.listeners) listener();
    if (changedBlocks) this.onChange?.(this.getBlocks());
  }

  /** Заменяет все блоки (например, подставили блоки из шаблона). */
  setBlocks(blocks: SignatureBlock[]): void {
    const copy = blocks.slice(0, MAX_BLOCKS).map((block) => ({ ...block }));
    const selectedId = copy.some((block) => block.id === this.state.selectedId) ? this.state.selectedId : undefined;
    this.update({ blocks: copy, ...(selectedId ? { selectedId } : {}) }, true);
  }

  /** Добавляет блок или заменяет блок с тем же id. Новый блок сверх лимита не добавляется. */
  save(block: SignatureBlock): void {
    const exists = this.state.blocks.some(({ id }) => id === block.id);
    if (!exists && this.state.blocks.length >= MAX_BLOCKS) return;
    const blocks = exists
      ? this.state.blocks.map((existing) => existing.id === block.id ? { ...block } : existing)
      : [...this.state.blocks, { ...block }];
    this.update({ blocks, selectedId: block.id }, true);
  }

  remove(id: string): void {
    if (!this.state.blocks.some((block) => block.id === id)) return;
    const blocks = this.state.blocks.filter((block) => block.id !== id);
    const selectedId = this.state.selectedId === id ? undefined : this.state.selectedId;
    this.update({ blocks, ...(selectedId ? { selectedId } : {}) }, true);
  }

  clear(): void {
    if (this.state.blocks.length === 0) return;
    this.update({ blocks: [] }, true);
  }

  select(id?: string): void {
    if (this.state.selectedId === id) return;
    this.update({ blocks: this.state.blocks, ...(id ? { selectedId: id } : {}) }, false);
  }
}
