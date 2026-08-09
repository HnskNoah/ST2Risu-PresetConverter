// M3: 宏翻译表(数据驱动)+ translateMacros()。
// 依据 docs/research/round6-converter-spec.md §6(四类:A 直通/B 同名不同义/C 翻译/D 透传)。
import type { Report } from './types.js';

// A 直通:同名同义,不做改动,不报告
const A_DIRECT = new Set([
  'char',
  'user',
  'description',
  'personality',
  'scenario',
  'persona',
  'reverse',
  'pick',
  'roll',
  'model',
  'getvar',
  'setvar',
  'addvar',
  'getglobalvar',
  'maxcontext',
  'lastmessage',
  'lastmessageid',
  'chatindex',
  'prefillsupported', // 规范化形式(删下划线);prefill_supported 经 normalizeName 命中
  // Risu 槽位/控制宏(转换器自身生成的模板也用,避免误报)
  'slot',
  'wi',
  'wibefore',
  'wiafter',
  'wiinsert',
  'system',
  'instruction',
  // Risu 通用/算术/条件宏(深度守卫等自生成模板会用,避免误报)
  'data',
  'and',
  'or',
  'not',
  'greaterequal',
  'lessequal',
  'ge',
  'le',
  '?',
]);

// B 同名不同义:Risu 有同名宏但语义有差异,保留原名 + 报告
const B_SAME_NAME = new Map<string, string>([
  ['time', 'Tavern moment LT;Risu 24h 不补零/带参为格式串'],
  ['isotime', 'Tavern 本地 HH:mm;Risu UTC HH:MM:SS(含义相反)'],
  ['date', 'Tavern 长格式;Risu YYYY-M-D'],
  ['idleduration', '参照最后用户消息 vs 最后消息;humanized vs HH:MM:SS'],
  ['trim', '作用域式 vs 字符串函数'],
  ['random', 'Tavern 空=空;Risu 0~1 浮点'],
  ['ismobile', 'true/false vs 1/0(Risu 用 metadata::mobile)'],
  ['words', 'Tavern memory 扩展动态宏=整数;Risu 无此宏,透传'],
]);

// C 翻译:改写为 Risu 等价宏
const C_RENAME = new Map<string, string>([
  ['charprompt', 'mainprompt'],
  ['charinstruction', 'jb'],
  ['mesexamples', 'exampledialogue'],
  ['mesexamplesraw', 'exampledialogue'],
  ['weekday', 'date::dddd'],
  ['incvar', 'addvar::n::1'],
  ['decvar', 'addvar::n::-1'],
  ['newline', 'br'],
  ['noop', 'blank'],
]);

// C 带参翻译:name -> risu 名称,参数透传
const C_PARAM = new Map<string, string>([
  ['datetimeformat', 'date'],
  ['hasextension', 'moduleenabled'],
]);

// D 未知:透传 + 报告(kept-unknown)

// 规范化 name:Risu parser.svelte.ts:1055 小写 + 删空格/下划线/连字符
const normalizeName = (raw: string): string => raw.toLowerCase().replace(/[\s_-]/g, '');

const isControl = (inner: string): boolean => {
  const t = inner.trim();
  return t.startsWith('#') || t.startsWith('/') || t.startsWith(':else') || t.startsWith('//');
};

// 从 inner 提取 name(第一个 :: 或 空白 前的 token,小写)
const parseName = (inner: string): string => {
  const m = inner.trim().match(/^([^\s::]+)/);
  return m ? m[1].toLowerCase() : inner.trim().toLowerCase();
};

export function translateMacros(text: string, report?: Report, context?: string): string {
  if (!text) return text;
  const re = /\{\{([^{}]+)\}\}/g;
  return text.replace(re, (full, inner: string) => {
    if (isControl(inner)) return full; // {{#if}}/{{/if}}/{{//}} 等控制结构不翻译
    const name = parseName(inner);
    const norm = normalizeName(name);

    // {{random a,b}} 空格语法 -> {{random::a::b}}(round6 §6)
    if (name === 'random' && /\s/.test(inner)) {
      const args = inner.replace(/^random\s+/i, '').replace(/[,\s]+/g, '::');
      report?.add('macros', {
        macro: full,
        action: 'rewritten',
        reason: `空格语法改写为 :: 形式(random)`,
        ...(context ? { scriptName: context } : {}),
      });
      return `{{random::${args}}}`;
    }
    // random::a::b(带参)同义直通;仅无参 random 才是 B(空 vs 0~1 浮点)
    if (name === 'random' && inner.includes('::')) return full;

    if (A_DIRECT.has(norm)) return full;

    // setglobalvar:Risu 无此宏(round6 §11),透传会静默失效 -> 报告 manual
    if (name === 'setglobalvar') {
      report?.add('macros', {
        macro: full,
        action: 'manual',
        reason: 'Risu 无 setglobalvar 宏(全局变量只能经触发器/UI 写入),该变量初始化不生效',
        ...(context ? { scriptName: context } : {}),
      });
      return full;
    }

    if (B_SAME_NAME.has(norm)) {
      report?.add('macros', {
        macro: full,
        action: 'kept',
        reason: `同名不同义:${B_SAME_NAME.get(norm)}`,
        ...(context ? { scriptName: context } : {}),
      });
      return full;
    }

    const paramTarget = C_PARAM.get(norm);
    if (paramTarget) {
      const args = inner.split('::').slice(1).join('::');
      report?.add('macros', {
        macro: full,
        action: 'rewritten',
        reason: `翻译为 ${paramTarget}::${args}`,
        ...(context ? { scriptName: context } : {}),
      });
      return args ? `{{${paramTarget}::${args}}}` : `{{${paramTarget}}}`;
    }

    const target = C_RENAME.get(norm);
    if (target) {
      report?.add('macros', {
        macro: full,
        action: 'rewritten',
        reason: `翻译为 {{${target}}}`,
        ...(context ? { scriptName: context } : {}),
      });
      return `{{${target}}}`;
    }

    // D:未知宏,Risu 透传
    report?.add('macros', {
      macro: full,
      action: 'kept-unknown',
      reason: 'Risu 对未知宏透传,行为不保证',
      ...(context ? { scriptName: context } : {}),
    });
    return full;
  });
}
