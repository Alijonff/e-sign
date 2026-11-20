import { MAX_BLOCKS, type DocumentInfo, type SignatureBlock } from '@e-sign/shared';
import { useCallback, useEffect, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { documentFileUrl } from '../api';
import { sortBlocks } from '../mark/blocks';
import { MarkPage } from '../mark/MarkPage';

export interface MarkStepProps {
  document: DocumentInfo;
  blocks: SignatureBlock[];
  onBlocksChange(blocks: SignatureBlock[]): void;
  onNext(): void;
}

export function MarkStep({ document: info, blocks, onBlocksChange, onNext }: MarkStepProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [pdfError, setPdfError] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const numbered = sortBlocks(blocks).map((block, index) => ({ block, number: index + 1 }));
  const canCreate = blocks.length < MAX_BLOCKS;

  useEffect(() => {
    let active = true;
    let loading: PDFDocumentLoadingTask | undefined;
    setPdf(undefined);
    setPdfError(false);

    void import('pdfjs-dist').then((pdfjs) => {
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
      loading = pdfjs.getDocument({ url: documentFileUrl(info.id) });
      return loading.promise;
    }).then((document) => {
      if (active && document) setPdf(document);
    }).catch(() => {
      if (active) setPdfError(true);
    });

    return () => {
      active = false;
      void loading?.destroy().catch(() => {});
    };
  }, [info.id]);

  const removeBlock = useCallback((id: string) => {
    onBlocksChange(blocks.filter((block) => block.id !== id));
    setSelectedId((selected) => selected === id ? undefined : selected);
  }, [blocks, onBlocksChange]);

  useEffect(() => {
    const id = selectedId;
    if (!id || !blocks.some((block) => block.id === id)) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      if (event.target instanceof HTMLElement && (
        event.target.isContentEditable || event.target.closest('input, textarea, select')
      )) return;
      event.preventDefault();
      removeBlock(id);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [blocks, removeBlock, selectedId]);

  function saveBlock(block: SignatureBlock) {
    if (blocks.some(({ id }) => id === block.id)) {
      onBlocksChange(blocks.map((existing) => existing.id === block.id ? block : existing));
    } else if (canCreate) {
      onBlocksChange([...blocks, block]);
    }
    setSelectedId(block.id);
  }

  function showBlock(id: string) {
    setSelectedId(id);
    document.getElementById(`mark-block-${id}`)?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }

  return (
    <section className="mark-step">
      <header className="mark-header">
        <h1>Разметка документа</h1>
        <p>Отметьте места, куда поставить подпись: проведите мышью по странице</p>
        {pdfError && <p role="alert">Не удалось открыть PDF. Обновите страницу и попробуйте ещё раз.</p>}
      </header>
      <div className="mark-layout">
        <div className="mark-strip">
          {info.pages.map((page, index) => (
            <MarkPage
              key={index}
              info={page}
              index={index}
              pdf={pdf}
              blocks={numbered.filter(({ block }) => block.page === index)}
              selectedId={selectedId}
              canCreate={canCreate}
              onSelect={setSelectedId}
              onRemove={removeBlock}
              onSave={saveBlock}
            />
          ))}
        </div>
        <aside className="mark-sidebar" aria-label="Блоки подписи">
          <p className="mark-count">Блоков: {blocks.length}</p>
          {numbered.length > 0 && (
            <ul className="mark-list">
              {numbered.map(({ block, number }) => (
                <li key={block.id} className={selectedId === block.id ? 'mark-list--selected' : undefined}>
                  <button type="button" className="mark-jump" onClick={() => showBlock(block.id)}>
                    Стр. {block.page + 1} · блок {number}
                  </button>
                  <button
                    type="button"
                    className="mark-remove"
                    aria-label={`Удалить блок ${number} из списка`}
                    onClick={() => removeBlock(block.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!canCreate && <p role="status">Достигнут лимит блоков ({MAX_BLOCKS})</p>}
          <button
            type="button"
            className="esign-button esign-button--primary"
            disabled={blocks.length === 0}
            onClick={() => onNext()}
          >
            Далее: подпись
          </button>
        </aside>
      </div>
    </section>
  );
}
