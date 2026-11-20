import type { DocumentInfo } from '@e-sign/shared';

const MAX_PROMPT_LENGTH = 60;

export function buildPadPrompt(document: DocumentInfo): string {
  const prompt = `Подписываю документ: ${document.name.replace(/\.pdf$/i, '')}`;
  const characters = Array.from(prompt);
  if (characters.length <= MAX_PROMPT_LENGTH) return prompt;
  return `${characters.slice(0, MAX_PROMPT_LENGTH - 1).join('')}…`;
}
