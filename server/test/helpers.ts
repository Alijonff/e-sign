import { PNG } from 'pngjs';

/**
 * Тестовая «подпись»: белый фон, чёрная волна и квадрат у левого края (по нему видно ориентацию),
 * вокруг широкие пустые поля — как у картинки с планшета.
 */
export function makeSignaturePng(opts: { width?: number; height?: number; transparent?: boolean } = {}): Uint8Array {
  const width = opts.width ?? 600;
  const height = opts.height ?? 240;
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = 255;
    png.data[i * 4 + 1] = 255;
    png.data[i * 4 + 2] = 255;
    png.data[i * 4 + 3] = opts.transparent ? 0 : 255;
  }
  const put = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 255;
  };
  // волна от x=120 до x=480, середина по высоте
  for (let x = 120; x <= 480; x++) {
    const y = Math.round(height / 2 + Math.sin((x - 120) / 28) * 40);
    for (let t = -3; t <= 3; t++) put(x, y + t);
  }
  // квадрат у левого края волны (метка ориентации), 26×26
  for (let y = height / 2 - 13; y < height / 2 + 13; y++) for (let x = 90; x < 116; x++) put(x, Math.round(y));
  return new Uint8Array(PNG.sync.write(png));
}
