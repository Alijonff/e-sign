import type { DocumentInfo } from '@e-sign/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResultStep } from './ResultStep';

afterEach(cleanup);

it('показывает просмотр и скачивание подписанного PDF и позволяет выбрать другой документ', () => {
  const document: DocumentInfo = {
    id: 'doc-1', name: 'Договор.pdf', sizeBytes: 512, pageCount: 1, pages: [], createdAt: '', signed: true,
  };
  const onAnother = vi.fn();
  render(<ResultStep document={document} onAnother={onAnother} />);

  expect(screen.getByRole('heading', { name: 'Документ подписан' })).toBeInTheDocument();
  expect(screen.getByTitle('Подписанный PDF')).toHaveAttribute('src', '/api/documents/doc-1/signed');
  const download = screen.getByRole('link', { name: 'Скачать' });
  expect(download).toHaveAttribute('href', '/api/documents/doc-1/signed');
  expect(download).toHaveAttribute('download');
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить другой документ' }));
  expect(onAnother).toHaveBeenCalledOnce();
});
