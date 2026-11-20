import type { SignatureBlock } from '@e-sign/shared';

/**
 * Геометрия страницы в пользовательском пространстве PDF (до поворота):
 * начало координат — левый нижний угол, ось y вверх; (boxX, boxY) — угол видимого прямоугольника
 * (CropBox, иначе MediaBox); rotation — /Rotate страницы (по часовой стрелке при показе).
 */
export interface PageGeometry {
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  rotation: 0 | 90 | 180 | 270;
}

/** Куда и как нарисовать картинку подписи средствами pdf-lib (`drawImage`). */
export interface PdfPlacement {
  /** Левый нижний угол картинки в пространстве PDF. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Поворот против часовой стрелки в градусах (параметр `rotate` у drawImage). */
  rotateDegrees: number;
}

export function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(angle) % 360) + 360) % 360;
  if (r === 0 || r === 90 || r === 180 || r === 270) return r;
  throw new Error(`Поворот страницы ${angle} не кратен 90°`);
}

/** Размер страницы так, как её видит человек (с учётом поворота). */
export function displaySize(g: PageGeometry): { width: number; height: number } {
  return g.rotation === 90 || g.rotation === 270
    ? { width: g.boxHeight, height: g.boxWidth }
    : { width: g.boxWidth, height: g.boxHeight };
}

/** Точка видимой страницы (пункты, начало слева сверху, y вниз) → пространство PDF. */
export function displayToUser(g: PageGeometry, dx: number, dy: number): { x: number; y: number } {
  const { boxX, boxY, boxWidth: wu, boxHeight: hu } = g;
  switch (g.rotation) {
    case 0:
      return { x: boxX + dx, y: boxY + hu - dy };
    case 90:
      return { x: boxX + dy, y: boxY + dx };
    case 180:
      return { x: boxX + wu - dx, y: boxY + dy };
    case 270:
      return { x: boxX + wu - dy, y: boxY + hu - dx };
  }
}

export interface PlaceOptions {
  /** Внутренний отступ от края блока, доля меньшей стороны блока. По умолчанию 0.04. */
  paddingFraction?: number;
}

/**
 * Вписывает картинку подписи в блок: пропорции сохраняются, картинка по центру блока, стоит «прямо»
 * для человека, смотрящего на страницу (даже если страница повёрнута).
 */
export function placeImageInBlock(
  block: Pick<SignatureBlock, 'x' | 'y' | 'width' | 'height'>,
  g: PageGeometry,
  imageWidth: number,
  imageHeight: number,
  options: PlaceOptions = {},
): PdfPlacement {
  if (!(imageWidth > 0) || !(imageHeight > 0)) throw new Error('Размер картинки должен быть больше нуля');
  const disp = displaySize(g);
  const bx = block.x * disp.width;
  const by = block.y * disp.height;
  const bw = block.width * disp.width;
  const bh = block.height * disp.height;

  const pad = (options.paddingFraction ?? 0.04) * Math.min(bw, bh);
  const availW = Math.max(bw - 2 * pad, 0.001);
  const availH = Math.max(bh - 2 * pad, 0.001);
  const scale = Math.min(availW / imageWidth, availH / imageHeight);
  const w = imageWidth * scale;
  const h = imageHeight * scale;

  // Левый нижний угол картинки на видимой странице.
  const dx = bx + (bw - w) / 2;
  const dyBottom = by + (bh + h) / 2;
  const anchor = displayToUser(g, dx, dyBottom);
  return { x: anchor.x, y: anchor.y, width: w, height: h, rotateDegrees: g.rotation };
}
