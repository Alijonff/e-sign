import { PadError, type SignatureCapture } from '@e-sign/shared';

const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';

export function readSignaturePng(file: string): SignatureCapture {
  try {
    const imagePngBase64 = file.trim().replace(/^data:image\/png;base64,/i, '');
    // 32 символа Base64 покрывают сигнатуру PNG, заголовок IHDR и два размера.
    const header = atob(imagePngBase64.slice(0, 32));
    if (header.length < 24 || !header.startsWith(PNG_SIGNATURE) ||
        header.slice(8, 16) !== '\x00\x00\x00\rIHDR') {
      throw new Error('Некорректный заголовок PNG');
    }

    const bytes = Uint8Array.from(header, (byte) => byte.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const imageWidth = view.getUint32(16);
    const imageHeight = view.getUint32(20);
    if (!imageWidth || !imageHeight || imageWidth > 0x7fffffff || imageHeight > 0x7fffffff) {
      throw new Error('Некорректные размеры PNG');
    }
    return { imagePngBase64, imageWidth, imageHeight };
  } catch {
    throw new PadError('unknown', 'Планшет signotec вернул некорректное PNG-изображение');
  }
}
