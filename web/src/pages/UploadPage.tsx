import { useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiClientError, logout, uploadDocument } from '../api';

function uploadError(cause: unknown): string {
  if (!(cause instanceof ApiClientError)) return 'Не удалось загрузить файл. Попробуйте ещё раз.';

  switch (cause.code) {
    case 'not_pdf': return 'Это не PDF';
    case 'pdf_encrypted': return 'PDF защищён паролем';
    case 'file_too_large': {
      const details = cause.details;
      const limit = typeof details === 'object' && details !== null && 'maxUploadMb' in details
        ? details.maxUploadMb
        : undefined;
      const limitInMessage = cause.message.match(/\b(\d+(?:[.,]\d+)?)\s*(?:МБ|MiB|MB)(?![\p{L}])/iu)?.[1];
      const maxMb = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : (limitInMessage ?? 25);
      return `Файл больше ${maxMb} МБ`;
    }
    default: return cause.message;
  }
}

export function UploadPage() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<'upload' | 'logout'>();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();

  async function upload(file: File | undefined) {
    if (!file || pending) return;

    setPending('upload');
    setError(undefined);
    try {
      const { id } = await uploadDocument(file);
      await navigate(`/doc/${encodeURIComponent(id)}`);
    } catch (cause) {
      setError(uploadError(cause));
    } finally {
      setPending(undefined);
    }
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files[0]);
  }

  async function signOut() {
    if (pending) return;
    setPending('logout');
    setError(undefined);
    try {
      await logout();
      await navigate('/login', { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : 'Не удалось выйти. Попробуйте ещё раз.');
    } finally {
      setPending(undefined);
    }
  }

  return (
    <section className="upload-page">
      <header className="upload-header">
        <h1>Загрузка PDF</h1>
        <button className="esign-button" type="button" onClick={signOut} disabled={!!pending}>
          Выйти
        </button>
      </header>
      <label
        className={`upload-zone${dragging ? ' upload-zone--dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = pending ? 'none' : 'copy';
          setDragging(!pending);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <span>Перетащите PDF или нажмите, чтобы выбрать</span>
        <input
          type="file"
          accept="application/pdf"
          disabled={!!pending}
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            input.value = '';
            void upload(file);
          }}
        />
      </label>
      {pending === 'upload' && <p role="status">Загружаем PDF…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
