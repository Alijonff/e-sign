import type { PageInfo, SignatureBlock } from '@e-sign/shared';
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { createBlockFromDrag, moveBlock, resizeBlock, type BlockRect, type Point, type ResizeHandle } from './blocks';
import { PdfCanvas } from './PdfCanvas';

export interface NumberedBlock {
  block: SignatureBlock;
  number: number;
}

interface MarkPageProps {
  info: PageInfo;
  index: number;
  pdf?: PDFDocumentProxy;
  blocks: NumberedBlock[];
  selectedId?: string;
  canCreate: boolean;
  onSelect(id?: string): void;
  onRemove(id: string): void;
  onSave(block: SignatureBlock): void;
}

type Gesture = { pointerId: number; start: Point } & (
  | { kind: 'draw' }
  | { kind: 'move'; block: SignatureBlock }
  | { kind: 'resize'; block: SignatureBlock; handle: ResizeHandle }
);

const handles: ResizeHandle[] = ['nw', 'ne', 'sw', 'se'];

function blockStyle(rect: BlockRect): CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

function relativePointer(event: PointerEvent<HTMLDivElement>) {
  const page = event.currentTarget.getBoundingClientRect();
  return { point: { x: event.clientX - page.left, y: event.clientY - page.top }, size: page };
}

function dragRect({ point, size }: ReturnType<typeof relativePointer>, gesture: Gesture): BlockRect | undefined {
  if (gesture.kind === 'draw') return createBlockFromDrag(gesture.start, point, size);
  if (!size.width || !size.height) return undefined;

  const dx = (point.x - gesture.start.x) / size.width;
  const dy = (point.y - gesture.start.y) / size.height;
  return gesture.kind === 'move'
    ? moveBlock(gesture.block, dx, dy)
    : resizeBlock(gesture.block, gesture.handle, dx, dy);
}

export function MarkPage({
  info, index, pdf, blocks, selectedId, canCreate, onSelect, onRemove, onSave,
}: MarkPageProps) {
  const gestureRef = useRef<Gesture>(null);
  const [preview, setPreview] = useState<{ rect: BlockRect; id?: string }>();

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || gestureRef.current) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('button')) return;

    const id = target.closest<HTMLElement>('[data-mark-block]')?.dataset.markBlock;
    const block = blocks.find(({ block }) => block.id === id)?.block;
    onSelect(block?.id);
    if (!block && !canCreate) return;

    const { point } = relativePointer(event);
    const pointer = { pointerId: event.pointerId, start: point };
    const handle = handles.find((handle) => handle === target.getAttribute('data-handle'));
    if (block && handle) gestureRef.current = { ...pointer, kind: 'resize', block, handle };
    else if (block) gestureRef.current = { ...pointer, kind: 'move', block };
    else gestureRef.current = { ...pointer, kind: 'draw' };

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function update(event: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const rect = dragRect(relativePointer(event), gesture);
    setPreview(rect ? { rect, id: gesture.kind === 'draw' ? undefined : gesture.block.id } : undefined);
  }

  function clear(event: PointerEvent<HTMLDivElement>) {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setPreview(undefined);
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const position = relativePointer(event);
    clear(event);
    if (position.point.x === gesture.start.x && position.point.y === gesture.start.y) return;
    const rect = dragRect(position, gesture);
    if (!rect) return;

    if (gesture.kind === 'draw') {
      if (canCreate) onSave({ ...rect, page: index, id: crypto.randomUUID() });
    } else {
      onSave({ ...gesture.block, ...rect });
    }
  }

  return (
    <section className="mark-sheet" aria-label={`Страница ${index + 1}`}>
      <div className="mark-sheet-label">Стр. {index + 1}</div>
      <div
        className="mark-page"
        style={{ aspectRatio: `${info.width} / ${info.height}` }}
        onPointerDown={start}
        onPointerMove={update}
        onPointerUp={finish}
        onPointerCancel={clear}
        onLostPointerCapture={clear}
      >
        <PdfCanvas pdf={pdf} pageNumber={index + 1} />
        {blocks.map(({ block, number }) => {
          const selected = selectedId === block.id;
          const rect = preview?.id === block.id ? preview.rect : block;
          return (
            <div
              key={block.id}
              id={`mark-block-${block.id}`}
              data-mark-block={block.id}
              className={`mark-block${selected ? ' mark-block--selected' : ''}`}
              style={blockStyle(rect)}
            >
              <span className="mark-block-label"><strong>{number}</strong> Подпись</span>
              {selected && (
                <>
                  {handles.map((handle) => <span key={handle} className="mark-handle" data-handle={handle} />)}
                  <button
                    type="button"
                    className="mark-remove mark-remove--block"
                    aria-label={`Удалить блок ${number} со страницы`}
                    onClick={() => onRemove(block.id)}
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          );
        })}
        {preview && preview.id === undefined && (
          <div className="mark-block mark-block--preview" style={blockStyle(preview.rect)} />
        )}
      </div>
    </section>
  );
}
