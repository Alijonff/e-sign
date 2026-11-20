import { PadError, type DocumentInfo, type PadDriver, type SignatureBlock, type SignResponse } from '@e-sign/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiClientError, signDocument } from '../api';
import { createPadDriver, defaultPadKind } from '../pad';
import { buildPadPrompt } from '../sign/prompt';

export interface SignStepProps {
  document: DocumentInfo;
  blocks: SignatureBlock[];
  onBack(): void;
  onSigned(result: SignResponse): void;
  driver?: PadDriver;
}

const phaseLabels = {
  connecting: 'Подключение…',
  capturing: 'Ждём подпись клиента…',
  sending: 'Отправка…',
  done: 'Готово',
};

type SignState = { phase: 'idle' | keyof typeof phaseLabels } | { phase: 'error'; message: string; details?: string };

/** Техническая строка для диагностики: исходное сообщение драйвера и его код. */
function padDetails(error: unknown): string | undefined {
  if (!(error instanceof PadError)) return undefined;
  const code = error.driverCode === undefined ? '' : `, код ${error.driverCode}`;
  return `${error.code}: ${error.message}${code}`;
}

function signingErrorMessage(error: unknown): string {
  if (error instanceof PadError) {
    switch (error.code) {
      case 'service_unavailable':
        return 'Служба планшета не отвечает. Проверьте, что signoPAD-API/Web запущена на этом компьютере';
      case 'pad_not_found':
        return 'Планшет не найден. Проверьте подключение по USB';
      case 'timeout':
        return 'Подпись не получена вовремя';
      default:
        return `Ошибка планшета: ${error.message}`;
    }
  }
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'invalid_blocks':
        return 'Блоки подписи не подходят к документу, вернитесь и проверьте разметку';
      case 'invalid_signature':
        return 'Подпись не распознана, попросите клиента подписать ещё раз';
      default:
        return error.message;
    }
  }
  return 'Не удалось отправить подпись. Повторите попытку';
}

export function SignStep({ document, blocks, onBack, onSigned, driver }: SignStepProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<SignState>({ phase: 'idle' });
  const padRef = useRef<PadDriver | undefined>(undefined);
  const connected = useRef(false);
  const attempt = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => {
    const currentAttempt = attempt.current;
    attempt.current = undefined;
    currentAttempt?.abort();
    void padRef.current?.disconnect();
  }, []);

  async function sign() {
    if (attempt.current) return;

    const controller = new AbortController();
    attempt.current = controller;

    try {
      const pad = padRef.current ??= driver ?? createPadDriver(defaultPadKind());
      if (!connected.current) {
        setState({ phase: 'connecting' });
        await pad.connect();
        if (controller.signal.aborted) {
          // Подключение могло завершиться уже после размонтирования экрана.
          await pad.disconnect();
          return;
        }
        connected.current = true;
      }

      setState({ phase: 'capturing' });
      const signature = await pad.capture({ prompt: buildPadPrompt(document), signal: controller.signal });
      if (controller.signal.aborted) {
        if (attempt.current === controller) setState({ phase: 'idle' });
        return;
      }

      setState({ phase: 'sending' });
      const result = await signDocument(document.id, {
        blocks,
        signature: {
          imagePngBase64: signature.imagePngBase64,
          signDataBase64: signature.signDataBase64,
          padKind: pad.kind,
        },
      });
      if (attempt.current !== controller) return;

      setState({ phase: 'done' });
      onSigned(result);
    } catch (error) {
      if (attempt.current !== controller) return;

      if (controller.signal.aborted || (error instanceof PadError && error.code === 'cancelled')) {
        setState({ phase: 'idle' });
      } else if (error instanceof ApiClientError && error.code === 'unauthorized') {
        void navigate('/login', { replace: true });
      } else {
        console.error('Ошибка подписи', error);
        const details = padDetails(error);
        setState({ phase: 'error', message: signingErrorMessage(error), ...(details ? { details } : {}) });
      }
    } finally {
      if (attempt.current === controller) attempt.current = undefined;
    }
  }

  const pageCount = new Set(blocks.map((block) => block.page)).size;
  const { phase } = state;

  return (
    <section className="signature-step">
      <h1>Подпись документа</h1>
      <p>Блоков для подписи: {blocks.length} на {pageCount} страницах</p>
      {phase === 'error' && <p role="alert">{state.message}</p>}
      {phase === 'error' && state.details && <p><small>Подробности: {state.details}</small></p>}
      {phase !== 'idle' && phase !== 'error' && <p role="status">{phaseLabels[phase]}</p>}
      <div className="signature-actions">
        <button type="button" onClick={onBack} disabled={phase === 'sending' || phase === 'done'}>Назад</button>
        {(phase === 'idle' || phase === 'error') && (
          <button type="button" className="signature-primary" onClick={() => void sign()}>
            {phase === 'idle' ? 'Подписать на планшете' : 'Повторить'}
          </button>
        )}
        {phase === 'capturing' && (
          <button type="button" onClick={() => attempt.current?.abort()}>Отменить</button>
        )}
      </div>
    </section>
  );
}
