import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

interface PdfCanvasProps {
  pdf?: PDFDocumentProxy;
  pageNumber: number;
}

export function PdfCanvas({ pdf, pageNumber }: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setVisible(entry.isIntersecting);
    }, { rootMargin: '200px 0px' });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdf || !visible || !canvas) return;

    let active = true;
    let task: RenderTask | undefined;
    let observer: ResizeObserver | undefined;
    let draw: (() => void) | undefined;
    setStatus('pending');

    pdf.getPage(pageNumber).then((page) => {
      if (!active) return;
      const pageWidth = page.getViewport({ scale: 1 }).width;
      let lastWidth = 0;

      draw = () => {
        if (!active) return;
        const width = canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1);
        if (!width || width === lastWidth) return;

        lastWidth = width;
        task?.cancel();
        try {
          const viewport = page.getViewport({ scale: width / pageWidth });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const render = page.render({ canvas, viewport });
          task = render;
          render.promise.then(() => {
            if (active && task === render) setStatus('ready');
          }).catch(() => {
            if (active && task === render) setStatus('error');
          });
        } catch {
          setStatus('error');
        }
      };

      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(draw);
        observer.observe(canvas);
      }
      window.addEventListener('resize', draw);
      draw();
    }).catch(() => {
      if (active) setStatus('error');
    });

    return () => {
      active = false;
      observer?.disconnect();
      if (draw) window.removeEventListener('resize', draw);
      task?.cancel();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pdf, pageNumber, visible]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="mark-canvas"
        style={{ visibility: visible && status === 'ready' ? 'visible' : 'hidden' }}
        width={0}
        height={0}
        aria-hidden="true"
      />
      {visible && status === 'error' && (
        <p className="mark-canvas-error" role="alert">Не удалось показать страницу {pageNumber}.</p>
      )}
    </>
  );
}
