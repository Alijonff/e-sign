import type { DocumentInfo } from '@e-sign/shared';

export interface ResultStepProps {
  document: DocumentInfo;
  onAnother(): void;
}

export function ResultStep(_props: ResultStepProps) {
  return <h1>Результат подписания</h1>;
}
