import type { DocumentInfo } from '@e-sign/shared';
import { expect, it } from 'vitest';
import { buildPadPrompt } from './prompt';

function promptFor(name: string): string {
  const document: DocumentInfo = {
    id: 'doc-1', name, sizeBytes: 32, pageCount: 1, pages: [], createdAt: '', signed: false,
  };
  return buildPadPrompt(document);
}

it('убирает только конечное расширение PDF независимо от регистра', () => {
  expect(promptFor('Договор.pdf.v2.PDF')).toBe('Подписываю документ: Договор.pdf.v2');
  expect(promptFor('Договор')).toBe('Подписываю документ: Договор');
});

it('оставляет ровно 60 символов без многоточия', () => {
  expect(promptFor(`${'А'.repeat(39)}.pdf`)).toBe(`Подписываю документ: ${'А'.repeat(39)}`);
});

it('включает многоточие в лимит и не разрезает символы вне BMP', () => {
  const result = promptFor(`${'📄'.repeat(40)}.pdf`);
  expect(Array.from(result)).toHaveLength(60);
  expect(result).toBe(`Подписываю документ: ${'📄'.repeat(38)}…`);
});
