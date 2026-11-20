import { PNG } from 'pngjs';
import { CoreError } from './errors.js';

export interface NormalizeOptions {
  /** Пиксели светлее этой яркости (0..255) считаются фоном. По умолчанию 235. */
  backgroundLuma?: number;
  /** Отступ вокруг подписи после обрезки, пикселей. По умолчанию 4. */
  marginPx?: number;
  /** Цвет чернил. По умолчанию синий, как у шариковой ручки. */
  inkColor?: { r: number; g: number; b: number };
}

/** Синий цвет шариковой ручки: достаточно тёмный, чтобы читаться на копиях и в чёрно-белой печати. */
export const BALLPOINT_BLUE = { r: 20, g: 40, b: 170 } as const;

/**
 * Готовит картинку подписи с планшета к вставке:
 * 1. если фон непрозрачный (белый), делает его прозрачным, штрих сохраняет;
 * 2. обрезает пустые поля, чтобы подпись заполняла блок;
 * 3. пустая картинка (нет штрихов) → CoreError('invalid_signature').
 */
export function normalizeSignaturePng(png: Uint8Array, options: NormalizeOptions = {}): Uint8Array {
  const bgLuma = options.backgroundLuma ?? 235;
  const margin = options.marginPx ?? 4;
  const ink = options.inkColor ?? BALLPOINT_BLUE;

  let src: PNG;
  try {
    src = PNG.sync.read(Buffer.from(png));
  } catch (err) {
    throw new CoreError('invalid_signature', `PNG подписи не читается: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { width, height, data } = src;
  const out = Buffer.from(data);

  let hasTransparency = false;
  for (let i = 3; i < out.length; i += 4) {
    if (out[i]! < 255) {
      hasTransparency = true;
      break;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!hasTransparency) {
        const luma = 0.299 * out[i]! + 0.587 * out[i + 1]! + 0.114 * out[i + 2]!;
        // Светлее порога — фон; от порога до чёрного альфа растёт линейно, штрих получается мягким.
        const alpha = luma >= bgLuma ? 0 : Math.round(((bgLuma - luma) / bgLuma) * 255 * 1.4);
        out[i + 3] = Math.min(255, alpha);
      }
      // Все чернила одного цвета; плавность линии даёт прозрачность.
      out[i] = ink.r;
      out[i + 1] = ink.g;
      out[i + 2] = ink.b;
      if (out[i + 3]! > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new CoreError('invalid_signature', 'На картинке нет подписи');

  const x0 = Math.max(minX - margin, 0);
  const y0 = Math.max(minY - margin, 0);
  const x1 = Math.min(maxX + margin, width - 1);
  const y1 = Math.min(maxY + margin, height - 1);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const cropped = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    out.copy(cropped.data, y * cw * 4, ((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + cw) * 4);
  }
  return new Uint8Array(PNG.sync.write(cropped));
}
