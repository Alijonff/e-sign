import type { DocumentInfo, SignatureBlock, SignResponse } from '@e-sign/shared';

export interface SignStepProps {
  document: DocumentInfo;
  blocks: SignatureBlock[];
  onBack(): void;
  onSigned(result: SignResponse): void;
}

export function SignStep(_props: SignStepProps) {
  return <h1>Подпись документа</h1>;
}
