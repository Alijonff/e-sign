import type { DocumentInfo, SignatureBlock } from '@e-sign/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiClientError, getDocument } from '../api';
import { MarkStep } from '../steps/MarkStep';
import { ResultStep } from '../steps/ResultStep';
import { SignStep } from '../steps/SignStep';

type DocumentStep = 'mark' | 'sign' | 'result';

function DocumentFlow({ id }: { id: string }) {
  const navigate = useNavigate();
  const [document, setDocument] = useState<DocumentInfo>();
  const [blocks, setBlocks] = useState<SignatureBlock[]>([]);
  const [step, setStep] = useState<DocumentStep>('mark');
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    getDocument(id)
      .then((info) => {
        if (active) setDocument(info);
      })
      .catch((error: unknown) => {
        if (active) {
          setError(error instanceof ApiClientError ? error.message : 'Не удалось загрузить документ.');
        }
      });
    return () => { active = false; };
  }, [id]);

  if (error) return <p role="alert">{error}</p>;
  if (!document) return <p role="status">Загружаем документ…</p>;

  switch (step) {
    case 'mark':
      return (
        <MarkStep
          document={document}
          blocks={blocks}
          onBlocksChange={setBlocks}
          onNext={() => setStep('sign')}
        />
      );
    case 'sign':
      return (
        <SignStep
          document={document}
          blocks={blocks}
          onBack={() => setStep('mark')}
          onSigned={(result) => {
            setDocument(result.document);
            setStep('result');
          }}
        />
      );
    case 'result':
      return <ResultStep document={document} onAnother={() => { void navigate('/'); }} />;
  }
}

export function DocumentPage() {
  const { id } = useParams<'id'>();
  return id ? <DocumentFlow key={id} id={id} /> : null;
}
