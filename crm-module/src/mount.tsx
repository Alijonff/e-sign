import { createRoot } from 'react-dom/client';
import type { PageInfo, SignatureBlock } from '@e-sign/shared';
import markerCss from './marker.css?inline';
import { MarkerView } from './marker';
import { BlockStore } from './store';

export interface MarkerOptions {
  /** Адрес PDF. Должен открываться из браузера пользователя (с его cookie CRM, если нужно). */
  pdfUrl: string;
  /** Начальные блоки (например, из шаблона документа). */
  blocks?: SignatureBlock[];
  /** Вызывается при любом изменении списка блоков и получает копию списка. */
  onChange?: (blocks: SignatureBlock[]) => void;
  /** PDF открылся: число страниц и их видимые размеры в пунктах. */
  onLoad?: (info: { pageCount: number; pages: PageInfo[] }) => void;
  /** Не удалось открыть PDF. */
  onError?: (error: Error) => void;
  /** Адрес файла pdf.worker.min.mjs. Нужен, если политика безопасности CRM запрещает воркеры из blob:. */
  pdfWorkerUrl?: string;
}

export interface MarkerHandle {
  getBlocks(): SignatureBlock[];
  setBlocks(blocks: SignatureBlock[]): void;
  removeBlock(id: string): void;
  clear(): void;
  destroy(): void;
}

const STYLE_ID = 'esign-marker-css';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = markerCss;
  document.head.append(style);
}

/** Показывает страницы PDF в контейнере и даёт рисовать блоки подписи мышью или пальцем. */
export function mountMarker(container: HTMLElement, options: MarkerOptions): MarkerHandle {
  ensureStyles();
  const store = new BlockStore(options.blocks, options.onChange);
  const root = createRoot(container);
  root.render(
    <MarkerView
      store={store}
      pdfUrl={options.pdfUrl}
      pdfWorkerUrl={options.pdfWorkerUrl}
      onLoad={options.onLoad}
      onError={options.onError}
    />,
  );
  let destroyed = false;
  return {
    getBlocks: () => store.getBlocks(),
    setBlocks: (blocks) => store.setBlocks(blocks),
    removeBlock: (id) => store.remove(id),
    clear: () => store.clear(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
    },
  };
}
