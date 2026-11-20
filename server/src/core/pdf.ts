import { degrees, PDFDocument, type PDFPage } from 'pdf-lib';
import { MAX_BLOCKS, MIN_BLOCK_FRACTION, type PageInfo, type SignatureBlock } from '@e-sign/shared';
import { CoreError } from './errors.js';
import { displaySize, normalizeRotation, placeImageInBlock, type PageGeometry } from './placement.js';

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) throw new CoreError('pdf_invalid', 'Файл не похож на PDF');
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(msg)) throw new CoreError('pdf_encrypted', 'PDF защищён паролем, такие файлы не поддерживаются');
    throw new CoreError('pdf_invalid', `PDF не удалось прочитать: ${msg}`);
  }
}

export function pageGeometry(page: PDFPage): PageGeometry {
  const box = page.getCropBox();
  return {
    boxX: box.x,
    boxY: box.y,
    boxWidth: box.width,
    boxHeight: box.height,
    rotation: normalizeRotation(page.getRotation().angle),
  };
}

export function pageInfos(doc: PDFDocument): PageInfo[] {
  return doc.getPages().map((page) => {
    const g = pageGeometry(page);
    const d = displaySize(g);
    return { width: d.width, height: d.height, rotation: g.rotation };
  });
}

/** Читает число страниц и их видимые размеры (для интерфейса разметки). */
export async function readPageInfos(bytes: Uint8Array): Promise<PageInfo[]> {
  return pageInfos(await loadPdf(bytes));
}

export function validateBlocks(blocks: SignatureBlock[], pageCount: number): void {
  if (blocks.length === 0) throw new CoreError('invalid_blocks', 'Не отмечено ни одного блока подписи');
  if (blocks.length > MAX_BLOCKS) throw new CoreError('invalid_blocks', `Блоков не больше ${MAX_BLOCKS}`);
  const ids = new Set<string>();
  const eps = 1e-9;
  for (const b of blocks) {
    if (ids.has(b.id)) throw new CoreError('invalid_blocks', `Повторяется идентификатор блока ${b.id}`);
    ids.add(b.id);
    if (!Number.isInteger(b.page) || b.page < 0 || b.page >= pageCount) {
      throw new CoreError('invalid_blocks', `Блок ${b.id}: страницы ${b.page} нет в документе (страниц: ${pageCount})`);
    }
    const nums = [b.x, b.y, b.width, b.height];
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new CoreError('invalid_blocks', `Блок ${b.id}: координаты должны быть числами`);
    }
    if (b.width < MIN_BLOCK_FRACTION || b.height < MIN_BLOCK_FRACTION) {
      throw new CoreError('invalid_blocks', `Блок ${b.id}: слишком маленький`);
    }
    if (b.x < -eps || b.y < -eps || b.x + b.width > 1 + eps || b.y + b.height > 1 + eps) {
      throw new CoreError('invalid_blocks', `Блок ${b.id}: выходит за границы страницы`);
    }
  }
}

/**
 * Рисует картинку подписи (PNG) во всех блоках и возвращает байты нового PDF.
 * Оригинал не меняется. Размеры и поворот страниц учитываются.
 */
export async function stampSignature(
  pdfBytes: Uint8Array,
  blocks: SignatureBlock[],
  signaturePng: Uint8Array,
): Promise<Uint8Array> {
  const doc = await loadPdf(pdfBytes);
  const pages = doc.getPages();
  validateBlocks(blocks, pages.length);

  let image;
  try {
    image = await doc.embedPng(signaturePng);
  } catch (err) {
    throw new CoreError('invalid_signature', `Картинка подписи не читается: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const block of blocks) {
    const page = pages[block.page]!;
    const p = placeImageInBlock(block, pageGeometry(page), image.width, image.height);
    page.drawImage(image, { x: p.x, y: p.y, width: p.width, height: p.height, rotate: degrees(p.rotateDegrees) });
  }
  return doc.save();
}
