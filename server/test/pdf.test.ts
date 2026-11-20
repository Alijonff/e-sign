import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { SignatureBlock } from '@e-sign/shared';
import { CoreError, normalizeSignaturePng, readPageInfos, stampSignature, validateBlocks } from '../src/core/index.js';
import { makeSignaturePng } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const samples = join(here, '..', '..', 'samples');
const sample = (name: string) => new Uint8Array(readFileSync(join(samples, name)));

const block = (id: string, page: number, x = 0.1, y = 0.1, width = 0.4, height = 0.1): SignatureBlock => ({ id, page, x, y, width, height });

describe('readPageInfos', () => {
  it('читает размеры и поворот: Letter с повёрнутой страницей', async () => {
    const pages = await readPageInfos(sample('05-letter-s-povernutoy-stranicey.pdf'));
    expect(pages).toHaveLength(3);
    expect(pages[0]).toMatchObject({ width: 612, height: 792, rotation: 0 });
    // Повёрнутая на 90° страница видна «лёжа»: ширина и высота меняются местами.
    expect(pages[1]).toMatchObject({ width: 792, height: 612, rotation: 90 });
  });

  it('A4 на 2 страницы', async () => {
    const pages = await readPageInfos(sample('01-dogovor-uslug.pdf'));
    expect(pages).toHaveLength(2);
    expect(pages[0]!.width).toBeCloseTo(595.28, 2);
  });

  it('не PDF → pdf_invalid', async () => {
    await expect(readPageInfos(new TextEncoder().encode('hello'))).rejects.toMatchObject({ code: 'pdf_invalid' });
  });
});

describe('validateBlocks', () => {
  it('пустой список, страница вне документа, выход за край, дубль id, малый размер', () => {
    expect(() => validateBlocks([], 2)).toThrowError(CoreError);
    expect(() => validateBlocks([block('a', 2)], 2)).toThrowError(/страницы 2/);
    expect(() => validateBlocks([block('a', 0, 0.8, 0.1, 0.4, 0.1)], 2)).toThrowError(/границы/);
    expect(() => validateBlocks([block('a', 0), block('a', 1)], 2)).toThrowError(/Повторяется/);
    expect(() => validateBlocks([block('a', 0, 0.1, 0.1, 0.001, 0.1)], 2)).toThrowError(/маленький/);
    expect(() => validateBlocks([block('a', 0, Number.NaN)], 2)).toThrowError(/числами/);
    expect(() => validateBlocks([block('a', 0), block('b', 1, 0.5, 0.5, 0.5, 0.5)], 2)).not.toThrow();
  });
});

describe('normalizeSignaturePng', () => {
  it('делает белый фон прозрачным и обрезает поля', () => {
    const src = makeSignaturePng();
    const out = PNG.sync.read(Buffer.from(normalizeSignaturePng(src)));
    expect(out.width).toBeLessThan(600);
    expect(out.height).toBeLessThan(240);
    expect(out.data[3]).toBe(0); // угол — фон — прозрачен
    let ink = 0;
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i]! > 200) ink++;
    expect(ink).toBeGreaterThan(500);
  });

  it('прозрачный PNG только обрезается', () => {
    const out = PNG.sync.read(Buffer.from(normalizeSignaturePng(makeSignaturePng({ transparent: true }))));
    expect(out.width).toBeLessThan(600);
  });

  it('пустая картинка → invalid_signature', () => {
    const empty = new PNG({ width: 50, height: 20 });
    empty.data.fill(255);
    expect(() => normalizeSignaturePng(new Uint8Array(PNG.sync.write(empty)))).toThrowError(/нет подписи/);
    expect(() => normalizeSignaturePng(new Uint8Array([1, 2, 3]))).toThrowError(CoreError);
  });
});

describe('stampSignature', () => {
  const png = normalizeSignaturePng(makeSignaturePng());

  async function imageCount(bytes: Uint8Array, pageIndex: number): Promise<number> {
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPages()[pageIndex]!;
    const res = page.node.Resources();
    const xo = res?.lookup(PDFName.of('XObject'));
    // @ts-expect-error — у PDFDict есть keys()
    return xo ? xo.keys().length : 0;
  }

  it('ставит подпись в каждый блок, оригинал не меняется', async () => {
    const original = sample('01-dogovor-uslug.pdf');
    const copy = original.slice();
    const out = await stampSignature(original, [block('a', 0), block('b', 1, 0.5, 0.8, 0.4, 0.1), block('c', 1, 0.1, 0.8, 0.3, 0.08)], png);
    expect(original).toEqual(copy);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(await imageCount(out, 0)).toBeGreaterThan(0);
    expect(await imageCount(out, 1)).toBeGreaterThan(0);
  });

  it('блок вне документа → invalid_blocks', async () => {
    await expect(stampSignature(sample('03-zayavlenie.pdf'), [block('a', 5)], png)).rejects.toMatchObject({ code: 'invalid_blocks' });
  });

  it('битый PNG → invalid_signature', async () => {
    await expect(stampSignature(sample('03-zayavlenie.pdf'), [block('a', 0)], new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  // Визуальная проверка: VISUAL_OUT=/путь npm test -w server — сохраняет подписанные PDF для рендера.
  it.runIf(process.env.VISUAL_OUT)('сохраняет подписанные образцы для визуальной проверки', async () => {
    const dir = process.env.VISUAL_OUT!;
    mkdirSync(dir, { recursive: true });
    const jobs: [string, SignatureBlock[]][] = [
      ['01-dogovor-uslug.pdf', [block('a', 1, 0.14, 0.64, 0.3, 0.07), block('b', 1, 0.14, 0.78, 0.3, 0.07)]],
      ['05-letter-s-povernutoy-stranicey.pdf', [block('a', 0, 0.12, 0.28, 0.3, 0.07), block('b', 1, 0.08, 0.05, 0.3, 0.12), block('c', 2, 0.12, 0.8, 0.3, 0.07)]],
    ];
    for (const [name, blocks] of jobs) writeFileSync(join(dir, `signed-${name}`), await stampSignature(sample(name), blocks, png));
  });
});
