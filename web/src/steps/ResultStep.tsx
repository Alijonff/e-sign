import type { DocumentInfo } from '@e-sign/shared';
import { signedFileUrl } from '../api';

export interface ResultStepProps {
  document: DocumentInfo;
  onAnother(): void;
}

export function ResultStep({ document, onAnother }: ResultStepProps) {
  const url = signedFileUrl(document.id);

  return (
    <section className="signature-step">
      <h1>Документ подписан</h1>
      <iframe className="signed-file-preview" title="Подписанный PDF" src={url} />
      <div className="signature-actions">
        <a className="signature-primary" href={url} download>Скачать</a>
        <button type="button" onClick={onAnother}>Загрузить другой документ</button>
      </div>
    </section>
  );
}
