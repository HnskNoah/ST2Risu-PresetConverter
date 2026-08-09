// ST {{setvar}}/{{addvar}}/{{incvar}}/{{decvar}} 宏 → Risu start 触发器(setvar effect)。
// 依据:
//  - ST variables.js:232-246(prompt 构建时执行,setvar 返回空串写变量)
//  - Risu triggers.ts:runTrigger 'start'(index.svelte.ts:888 每次 sendChat 时执行)、
//    case 'setvar'(triggers.ts:1334)静默写 chat.scriptstate;
//  - round9 调研:setvar 在 prompt 卡内 runVar=false 不执行,故必须转触发器。
import type { ExtractedSetVar, Report, TriggerScript } from './types.js';
import { translateMacros } from './macroTable.js';

// value 用 [^{}] 限制:嵌套宏(如 {{setvar::X::{{char}}}})不提取、保持原样,交给人工迁移。
// ST 侧正则([^}]* 截断)会破坏嵌套文本,这里选择更安全的保守行为。
const SETVAR_RE = /\{\{setvar::([^:]+)::([^{}]*)\}\}/gi;
const ADDVAR_RE = /\{\{addvar::([^:]+)::([^{}]+)\}\}/gi;
const INCVAR_RE = /\{\{incvar::([^}]+)\}\}/gi;
const DECVAR_RE = /\{\{decvar::([^}]+)\}\}/gi;

export interface ExtractResult {
  /** 剔除 setvar 宏后的文本(宏被移除,避免 Risu 渲染 runVar=false 字面量) */
  text: string;
  setvars: ExtractedSetVar[];
}

export function extractSetVars(text: string, report?: Report): ExtractResult {
  if (!text) return { text, setvars: [] };
  let setvars: ExtractedSetVar[] = [];
  let cleaned = text;

  cleaned = cleaned.replace(SETVAR_RE, (_full, name: string, value: string) => {
    setvars.push({ name: name.trim(), operator: '=', value });
    return '';
  });
  cleaned = cleaned.replace(ADDVAR_RE, (_full, name: string, value: string) => {
    setvars.push({ name: name.trim(), operator: '+=', value });
    return '';
  });
  cleaned = cleaned.replace(INCVAR_RE, (_full, name: string) => {
    setvars.push({ name: name.trim(), operator: '+=', value: '1' });
    return '';
  });
  cleaned = cleaned.replace(DECVAR_RE, (_full, name: string) => {
    setvars.push({ name: name.trim(), operator: '-=', value: '1' });
    return '';
  });

  // 嵌套形式(如 {{setvar::X::{{char}}}})未被上方正则匹配,仍留在文本;翻译宏后做残留检测
  const leftovers = cleaned.match(/\{\{setvar::[^{}]*\{\{[^}]*\}\}/gi);
  if (leftovers && report) {
    report.add('macros', {
      macro: leftovers[0],
      action: 'manual',
      reason: 'setvar 值含嵌套宏,静态无法可靠提取,需人工迁移为触发器',
    });
  }

  if (setvars.length > 0 && report) {
    const names = [...new Set(setvars.map((s) => s.name))];
    report.add('macros', {
      action: 'converted',
      reason: `提取 ${setvars.length} 个 setvar 类宏(变量:${names.join(', ')})为 start 触发器 effect`,
    });
  }
  return { text: cleaned, setvars };
}

export interface TriggerBuildInput {
  setvars: ExtractedSetVar[];
  source: string;
}

export function buildStartTrigger(input: TriggerBuildInput): TriggerScript | null {
  if (input.setvars.length === 0) return null;
  return {
    comment: `ST setvar 初始化(来自 ${input.source})`,
    type: 'start',
    conditions: [],
    effect: input.setvars.map((s) => ({
      type: 'setvar',
      operator: s.operator,
      var: s.name,
      value: translateMacros(s.value),
    })),
  };
}

export function buildModule(input: TriggerBuildInput): { module: { type: 'risuModule'; name: string; description: string; id: string; trigger: TriggerScript[] } } | null {
  const trigger = buildStartTrigger(input);
  if (!trigger) return null;
  return {
    module: {
      type: 'risuModule',
      name: `${input.source} setvar 触发器`,
      description: '由 ST2Risu 转换器生成:ST prompt 卡中的 {{setvar}}/{{addvar}}/{{incvar}}/{{decvar}} 转成的 start 触发器。导入后在"模块"页启用即可生效。',
      id: `st2risu-setvar-${input.source.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      trigger: [trigger],
    },
  };
}
