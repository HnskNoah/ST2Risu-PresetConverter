// ST(输入)与 Risu(输出)的类型定义

export interface STPrompt {
  identifier: string;
  name?: string;
  role?: string;
  content?: string;
  [key: string]: unknown;
}

export interface STPromptOrderItem {
  identifier: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface STPromptOrder {
  character_id?: number | string;
  order: STPromptOrderItem[];
  [key: string]: unknown;
}

export interface RegexScript {
  id?: string;
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  trimStrings?: string[];
  placement?: number[] | string;
  markdownOnly?: boolean;
  promptOnly?: boolean;
  runOnEdit?: boolean;
  substituteRegex?: number | boolean;
  minDepth?: number | null;
  maxDepth?: number | null;
  disabled?: boolean;
  [key: string]: unknown;
}

export interface TavernPreset {
  name?: string;
  temperature?: number | string;
  top_p?: number | string;
  top_k?: number | string;
  top_a?: number | string;
  min_p?: number | string;
  presence_penalty?: number | string;
  frequency_penalty?: number | string;
  repetition_penalty?: number | string;
  openai_max_context?: number | string;
  openai_max_tokens?: number | string;
  assistant_prefill?: string;
  prompts?: STPrompt[];
  prompt_order?: STPromptOrder[];
  extensions?: { regex_scripts?: RegexScript[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ParsedIR {
  topLevel: TavernPreset;
  regexScripts: RegexScript[];
  prompts: STPrompt[];
  promptOrder: STPromptOrder[];
  formats: {
    wiFormat: unknown;
    scenarioFormat: unknown;
    personalityFormat: unknown;
  };
}

export type ReportAction = 'converted' | 'dropped' | 'degraded' | 'manual';
// macros 区专用动作(kept/rewritten/kept-unknown 不进 summary;例外:setglobalvar 报 manual 计入 summary)
export type MacroAction = 'kept' | 'rewritten' | 'kept-unknown';

export interface ReportEntry {
  action: ReportAction | MacroAction;
  reason: string;
  fields?: string[];
  suggestion?: string;
  [key: string]: unknown;
}

export type ReportSection = 'topLevel' | 'regex' | 'prompts' | 'macros' | 'toggles';

export interface Report {
  source: string;
  summary: Record<ReportAction, number>;
  sections: Record<ReportSection, ReportEntry[]>;
  add(section: ReportSection, entry: ReportEntry): void;
}

export interface RisuCustomScript {
  type: string;
  ableFlag: boolean;
  flag: string;
  in: string;
  out: string;
  comment: string;
}

export type RisuPromptCard = { type: string; [key: string]: unknown };

export interface MapFieldsResult {
  temperature: number;
  frequencyPenalty: number;
  PresensePenalty: number;
  top_p: number;
  top_k: number;
  top_a: number;
  min_p: number;
  repetition_penalty: number;
  maxContext: number;
  maxResponse: number;
  reasonEffort?: number;
  promptSettings?: { postEndInnerFormat?: string };
  name?: string;
}

export interface RisuPreset extends MapFieldsResult {
  promptTemplate: RisuPromptCard[];
  regex: RisuCustomScript[];
  customPromptTemplateToggle?: string;
}

// —— 触发器(ST setvar 宏 → Risu trigger)——

export interface ExtractedSetVar {
  name: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  value: string;
}

export interface TriggerScript {
  comment: string;
  type: 'start' | 'manual' | 'output' | 'input' | 'display' | 'request';
  conditions: unknown[];
  effect: unknown[];
  lowLevelAccess?: boolean;
}

export interface RisuModule {
  type: 'risuModule';
  name: string;
  description: string;
  id: string;
  trigger?: TriggerScript[];
}

// —— 变量 toggle(customPromptTemplateToggle)——
export interface ToggleOption {
  content: string;
  label: string;
  enabled: boolean;
}

export interface ToggleDef {
  key: string;
  label: string;
  options: ToggleOption[];
  defaultIndex: number;
}

export interface ConvertResult {
  preset: RisuPreset;
  module: RisuModule | null;
  report: Report;
}
