import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PageInfo } from '@e-sign/shared';
import { MAX_BLOCKS } from '@e-sign/shared';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker } from 'pdfjs-dist';
import pdfWorkerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import { sortBlocks } from '../../web/src/mark/blocks';
import { MarkPage } from '../../web/src/mark/MarkPage';
import type { BlockStore } from './store';

export interface MarkerViewProps {
  store: BlockStore;
  pdfUrl: string;
  /** Если задан, воркер pdf.js грузится по этому адресу, а не создаётся из вшитого текста (нужно при строгой CSP). */
  pdfWorkerUrl?: string | undefined;
  onLoad?: ((info: { pageCount: number; pages: PageInfo[] }) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
}

function inlineWorker(): Worker {
  const url = URL.createObjectURL(new Blob([pdfWorkerSource], { type: 'text/javascript' }));
  return new Worker(url, { type: 'module' });
}

export function MarkerView({ store, pdfUrl, pdfWorkerUrl, onLoad, onError }: MarkerViewProps) {
  const { blocks, selectedId } = useSyncExternalStore(store.subscribe, store.get);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let loading: PDFDocumentLoadingTask | undefined;
    let worker: PDFWorker | undefined;
    setPdf(undefined);
    setPages([]);
    setFailed(false);

    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      if (!active) return;
      if (pdfWorkerUrl) {
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      } else {
        // Типы pdf.js ошибочно запрещают port у PDFWorker, хотя параметр поддерживается.
        worker = new pdfjs.PDFWorker({ port: inlineWorker() } as unknown as ConstructorParameters<typeof pdfjs.PDFWorker>[0]);
      }
      loading = pdfjs.getDocument(worker ? { url: pdfUrl, worker } : { url: pdfUrl });
      const document = await loading.promise;
      const infos: PageInfo[] = [];
      for (let number = 1; number <= document.numPages; number += 1) {
        const page = await document.getPage(number);
        // Видимый размер уже учитывает /Rotate: это ровно то, что ждёт сервер.
        const viewport = page.getViewport({ scale: 1 });
        const rotation = (((page.rotate % 360) + 360) % 360) as PageInfo['rotation'];
        infos.push({ width: viewport.width, height: viewport.height, rotation });
      }
      if (!active) return;
      setPdf(document);
      setPages(infos);
      onLoad?.({ pageCount: infos.length, pages: infos });
    })().catch((error: unknown) => {
      if (!active) return;
      setFailed(true);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    });

    return () => {
      active = false;
      void loading?.destroy().catch(() => {});
      void worker?.destroy();
    };
    // onLoad и onError намеренно не в зависимостях: смена колбэков не должна перезагружать документ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, pdfWorkerUrl]);

  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      if (event.target instanceof HTMLElement && (
        event.target.isContentEditable || event.target.closest('input, textarea, select')
      )) return;
      event.preventDefault();
      store.remove(selectedId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, store]);

  const numbered = sortBlocks(blocks).map((block, index) => ({ block, number: index + 1 }));
  const canCreate = blocks.length < MAX_BLOCKS;

  return (
    <div className="esign-marker">
      {failed && <p className="esign-marker-message" role="alert">Не удалось открыть PDF.</p>}
      {!failed && pages.length === 0 && <p className="esign-marker-message" role="status">Загружаем документ…</p>}
      <div className="mark-strip">
        {pages.map((info, index) => (
          <MarkPage
            key={index}
            info={info}
            index={index}
            pdf={pdf}
            blocks={numbered.filter(({ block }) => block.page === index)}
            {...(selectedId ? { selectedId } : {})}
            canCreate={canCreate}
            onSelect={(id) => store.select(id)}
            onRemove={(id) => store.remove(id)}
            onSave={(block) => store.save(block)}
          />
        ))}
      </div>
    </div>
  );
}
