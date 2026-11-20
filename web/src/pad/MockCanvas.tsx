import { PadError, type SignatureCapture } from '@e-sign/shared';
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';

interface Point {
  x: number;
  y: number;
  t: number;
}

interface Stroke {
  pointerId: number;
  points: Point[];
  cursor: Pick<Point, 'x' | 'y'>;
}

interface MockCanvasProps {
  prompt: string;
  onConfirm(signature: SignatureCapture): void;
  onCancel(): void;
  onError(error: PadError): void;
}

function paintBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#000';
}

function getPoint(event: PointerEvent<HTMLCanvasElement>): Point {
  const canvas = event.currentTarget;
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)),
    t: event.timeStamp,
  };
}

export function MockCanvas({ prompt, onConfirm, onCancel, onError }: MockCanvasProps) {
  const promptId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const context = useRef<CanvasRenderingContext2D>(null);
  const strokes = useRef<Point[][]>([]);
  const activeStroke = useRef<Stroke | null>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d', { alpha: false });
    if (!ctx) {
      onError(new PadError('unknown', 'Не удалось открыть холст для подписи'));
      return;
    }
    paintBackground(ctx);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    context.current = ctx;

    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      context.current = null;
      dialog.close();
    };
  }, [onError]);

  function startStroke(event: PointerEvent<HTMLCanvasElement>) {
    const ctx = context.current;
    if (!ctx || activeStroke.current || event.button !== 0) return;

    const point = getPoint(event);
    const points = [point];
    strokes.current.push(points);
    activeStroke.current = { pointerId: event.pointerId, points, cursor: point };
    event.currentTarget.setPointerCapture(event.pointerId);

    ctx.beginPath();
    ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, 2 * Math.PI);
    ctx.fill();
    setHasInk(true);
  }

  function drawStroke(event: PointerEvent<HTMLCanvasElement>) {
    const ctx = context.current;
    const stroke = activeStroke.current;
    if (!ctx || !stroke || stroke.pointerId !== event.pointerId) return;

    const previous = stroke.points[stroke.points.length - 1]!;
    const point = getPoint(event);
    if (point.x === previous.x && point.y === previous.y) return;

    const midpoint = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(stroke.cursor.x, stroke.cursor.y);
    ctx.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y);
    ctx.stroke();
    stroke.points.push(point);
    stroke.cursor = midpoint;
  }

  function finishStroke() {
    const ctx = context.current;
    const stroke = activeStroke.current;
    if (!ctx || !stroke) return;

    if (stroke.points.length > 1) {
      const last = stroke.points[stroke.points.length - 1]!;
      ctx.beginPath();
      ctx.moveTo(stroke.cursor.x, stroke.cursor.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    activeStroke.current = null;
  }

  function endStroke(event: PointerEvent<HTMLCanvasElement>) {
    if (activeStroke.current?.pointerId !== event.pointerId) return;
    if (event.type === 'pointerup') drawStroke(event);
    finishStroke();
  }

  function clearCanvas() {
    const pointerId = activeStroke.current?.pointerId;
    activeStroke.current = null;
    const canvas = canvasRef.current;
    if (pointerId !== undefined && canvas?.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
    strokes.current = [];
    if (context.current) paintBackground(context.current);
    setHasInk(false);
  }

  function confirmSignature() {
    const canvas = canvasRef.current;
    if (!canvas || !strokes.current.length) return;

    finishStroke();
    const prefix = 'data:image/png;base64,';
    let png: string;
    try {
      png = canvas.toDataURL('image/png');
    } catch {
      onError(new PadError('unknown', 'Не удалось сохранить изображение подписи'));
      return;
    }
    if (!png.startsWith(prefix) || png.length === prefix.length) {
      onError(new PadError('unknown', 'Не удалось сохранить изображение подписи'));
      return;
    }

    onConfirm({
      imagePngBase64: png.slice(prefix.length),
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      signDataBase64: btoa(JSON.stringify(strokes.current)),
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="mock-pad-dialog"
      aria-labelledby={promptId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <p id={promptId} className="mock-pad-prompt">{prompt}</p>
      <canvas
        ref={canvasRef}
        className="mock-pad-canvas"
        aria-label="Поле для подписи"
        width={640}
        height={320}
        onPointerDown={startStroke}
        onPointerMove={drawStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
      />
      <div className="signature-actions">
        <button type="button" className="signature-primary" disabled={!hasInk} onClick={confirmSignature}>
          Подтвердить
        </button>
        <button type="button" onClick={clearCanvas}>Очистить</button>
        <button type="button" onClick={onCancel}>Отмена</button>
      </div>
    </dialog>
  );
}
