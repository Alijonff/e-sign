import type { DocumentInfo } from '@e-sign/shared';

const MAX_PROMPT_LENGTH = 60;

/** Текст для экрана планшета по имени документа (до 60 символов). */
export function buildPromptFromName(name: string): string {
  const prompt = `Подписываю документ: ${name.replace(/\.pdf$/i, '')}`;
  const characters = Array.from(prompt);
  if (characters.length <= MAX_PROMPT_LENGTH) return prompt;
  return `${characters.slice(0, MAX_PROMPT_LENGTH - 1).join('')}…`;
}

export function buildPadPrompt(document: DocumentInfo): string {
  return buildPromptFromName(document.name);
}
