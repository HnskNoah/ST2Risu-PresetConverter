// ST {{setvar}}/{{addvar}}/{{incvar}}/{{decvar}} 宏 → Risu start 触发器(setvar effect)。
// 依据:
//  - ST variables.js:232-246(prompt 构建时执行,setvar 返回空串写变量)
//  - Risu triggers.ts:runTrigger 'start'(index.svelte.ts:888 每次 sendChat 时执行)、
//    case 'setvar'(triggers.ts:1334)静默写 chat.scriptstate;
//  - round9 调研:setvar 在 prompt 卡内 runVar=false 不执行,故必须转触发器。
//  - round11:值含嵌套宏(如 {{user}})的 setvar 用平衡解析(scanSetvarMacros),不再漏转。
import type { ExtractedSetVar, Report, TriggerScript } from './types.js';
import { translateMacros } from './macroTable.js';
import { scanSetvarMacros, stripSetvarMacros } from './setvarParse.js';

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

  // setvar/addvar:平衡解析(支持嵌套宏值),剔除并收集
  const macros = scanSetvarMacros(text);
  let cleaned = stripSetvarMacros(text, macros);
  for (const m of macros) {
    setvars.push({
      name: m.name,
      operator: m.kind === 'addvar' ? '+=' : '=',
      value: m.value,
    });
  }

  // incvar/decvar:简单正则(值即固定 1/-1,无嵌套问题)
  cleaned = cleaned.replace(INCVAR_RE, (_full, name: string) => {
    setvars.push({ name: name.trim(), operator: '+=', value: '1' });
    return '';
  });
  cleaned = cleaned.replace(DECVAR_RE, (_full, name: string) => {
    setvars.push({ name: name.trim(), operator: '-=', value: '1' });
    return '';
  });

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
