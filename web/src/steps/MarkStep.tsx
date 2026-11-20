import type { DocumentInfo, SignatureBlock } from '@e-sign/shared';

export interface MarkStepProps {
  document: DocumentInfo;
  blocks: SignatureBlock[];
  onBlocksChange(blocks: SignatureBlock[]): void;
  onNext(): void;
}

export function MarkStep(_props: MarkStepProps) {
  return <h1>Разметка документа</h1>;
}
