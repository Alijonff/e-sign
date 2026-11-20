import { describe, expect, it } from 'vitest';
import { displaySize, displayToUser, normalizeRotation, placeImageInBlock, type PageGeometry } from '../src/core/index.js';

/** Независимая прямая карта «пространство PDF → видимая страница» (для проверки обратной в коде). */
function userToDisplay(g: PageGeometry, ux: number, uy: number): { dx: number; dy: number } {
  const x = ux - g.boxX;
  const y = uy - g.boxY;
  switch (g.rotation) {
    case 0:
      return { dx: x, dy: g.boxHeight - y };
    case 90:
      return { dx: y, dy: x };
    case 180:
      return { dx: g.boxWidth - x, dy: y };
    case 270:
      return { dx: g.boxHeight - y, dy: g.boxWidth - x };
  }
}

const rotations = [0, 90, 180, 270] as const;
const boxes = [
  { boxX: 0, boxY: 0, boxWidth: 595.28, boxHeight: 841.89 },
  { boxX: 12, boxY: -7, boxWidth: 612, boxHeight: 792 }, // CropBox со смещением
];

describe('placeImageInBlock', () => {
  for (const box of boxes) {
    for (const rotation of rotations) {
      it(`углы картинки совпадают с блоком: поворот ${rotation}°, начало (${box.boxX}, ${box.boxY})`, () => {
        const g: PageGeometry = { ...box, rotation };
        const disp = displaySize(g);
        const block = { x: 0.1, y: 0.7, width: 0.4, height: 0.12 };
        const p = placeImageInBlock(block, g, 600, 240, { paddingFraction: 0 });

        const th = (p.rotateDegrees * Math.PI) / 180;
        const bl = { x: p.x, y: p.y };
        const br = { x: p.x + p.width * Math.cos(th), y: p.y + p.width * Math.sin(th) };
        const tl = { x: p.x - p.height * Math.sin(th), y: p.y + p.height * Math.cos(th) };
        const dBl = userToDisplay(g, bl.x, bl.y);
        const dBr = userToDisplay(g, br.x, br.y);
        const dTl = userToDisplay(g, tl.x, tl.y);

        // На видимой странице картинка стоит прямо: низ слева, ширина вправо, высота вверх.
        expect(dBr.dy).toBeCloseTo(dBl.dy, 6);
        expect(dBr.dx - dBl.dx).toBeCloseTo(p.width, 6);
        expect(dTl.dx).toBeCloseTo(dBl.dx, 6);
        expect(dBl.dy - dTl.dy).toBeCloseTo(p.height, 6);

        // Картинка лежит внутри блока и касается его по ограничивающей стороне (600/240 = 2.5 > 0.4*W / 0.12*H?).
        const bx = block.x * disp.width;
        const by = block.y * disp.height;
        const bw = block.width * disp.width;
        const bh = block.height * disp.height;
        expect(dBl.dx).toBeGreaterThanOrEqual(bx - 1e-6);
        expect(dBr.dx).toBeLessThanOrEqual(bx + bw + 1e-6);
        expect(dTl.dy).toBeGreaterThanOrEqual(by - 1e-6);
        expect(dBl.dy).toBeLessThanOrEqual(by + bh + 1e-6);
        // Касание: по одной из осей заполняет блок целиком.
        const fillsW = Math.abs(p.width - bw) < 1e-6;
        const fillsH = Math.abs(p.height - bh) < 1e-6;
        expect(fillsW || fillsH).toBe(true);
        // Пропорции сохранены.
        expect(p.width / p.height).toBeCloseTo(600 / 240, 6);
      });
    }
  }

  it('поворот 0°, без смещения: числа проверены вручную', () => {
    // A4, блок в левом верхнем углу: x=0.1, y=0.1, w=0.5, h=0.1 → 59.528, 84.189, 297.64, 84.189 пт.
    const g: PageGeometry = { boxX: 0, boxY: 0, boxWidth: 595.28, boxHeight: 841.89, rotation: 0 };
    const p = placeImageInBlock({ x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, g, 100, 100, { paddingFraction: 0 });
    // Картинка 100×100 вписывается по высоте: сторона 84.189, по центру блока по x.
    expect(p.width).toBeCloseTo(84.189, 3);
    expect(p.height).toBeCloseTo(84.189, 3);
    expect(p.x).toBeCloseTo(59.528 + (297.64 - 84.189) / 2, 3);
    expect(p.y).toBeCloseTo(841.89 - (84.189 + 84.189), 3);
    expect(p.rotateDegrees).toBe(0);
  });

  it('отступ уменьшает картинку внутри блока', () => {
    const g: PageGeometry = { boxX: 0, boxY: 0, boxWidth: 600, boxHeight: 800, rotation: 0 };
    const tight = placeImageInBlock({ x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, g, 300, 100, { paddingFraction: 0 });
    const padded = placeImageInBlock({ x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, g, 300, 100);
    expect(padded.width).toBeLessThan(tight.width);
  });

  it('не принимает нулевой размер картинки', () => {
    const g: PageGeometry = { boxX: 0, boxY: 0, boxWidth: 600, boxHeight: 800, rotation: 0 };
    expect(() => placeImageInBlock({ x: 0, y: 0, width: 0.5, height: 0.5 }, g, 0, 10)).toThrow();
  });
});

describe('displayToUser / normalizeRotation', () => {
  it('обратные карты согласованы', () => {
    for (const box of boxes) {
      for (const rotation of rotations) {
        const g: PageGeometry = { ...box, rotation };
        const d = displaySize(g);
        for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.8]] as const) {
          const u = displayToUser(g, fx * d.width, fy * d.height);
          const back = userToDisplay(g, u.x, u.y);
          expect(back.dx).toBeCloseTo(fx * d.width, 6);
          expect(back.dy).toBeCloseTo(fy * d.height, 6);
        }
      }
    }
  });

  it('нормализует углы', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(0)).toBe(0);
    expect(() => normalizeRotation(45)).toThrow();
  });
});
