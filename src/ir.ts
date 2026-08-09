import type { ParsedIR, RegexScript, STPrompt, STPromptOrder, TavernPreset } from './types.js';

export function parseST(json: unknown): ParsedIR {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Invalid preset JSON: expected an object');
  }
  const obj = json as TavernPreset;
  const promptOrder = Array.isArray(obj.prompt_order) ? obj.prompt_order : [];
  const prompts = obj.prompts;
  const isST = Array.isArray(promptOrder[0]?.order) && Array.isArray(prompts);
  if (!isST) {
    throw new Error('Not a SillyTavern preset: missing prompts[] and prompt_order[0].order');
  }
  const regexScripts = Array.isArray(obj.extensions?.regex_scripts)
    ? (obj.extensions.regex_scripts as RegexScript[])
    : [];
  return {
    topLevel: obj,
    regexScripts,
    prompts: prompts as STPrompt[],
    promptOrder: promptOrder as STPromptOrder[],
    formats: {
      wiFormat: obj.wi_format,
      scenarioFormat: obj.scenario_format,
      personalityFormat: obj.personality_format,
    },
  };
}

export function normalizeRole(role: unknown): 'bot' | 'user' | 'system' {
  switch (String(role ?? '').toLowerCase()) {
    case 'assistant':
    case 'char':
    case 'bot':
      return 'bot';
    case 'user':
      return 'user';
    default:
      return 'system';
  }
}
