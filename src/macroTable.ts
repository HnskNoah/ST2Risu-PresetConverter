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
  'getglobalvar',
  'maxcontext',
  'lastmessage',
  'lastmessageid',
  'chatindex',
  'prefillsupported', // 规范化形式(删下划线);prefill_supported 经 normalizeName 命中
  // ST 宏名恰好是 Risu 宏的原生别名 → 直通
  'lastusermessage', // Risu previoususerchat 的别名
  'lastcharmessage', // Risu previouscharchat 的别名
  'systemprompt', // Risu mainprompt 的别名
  'chardesc', // Risu description 的别名
  'charpersona', // Risu personality 的别名
  'userpersona', // Risu persona 的别名
  // Risu 槽位宏(转换器自身生成的模板也用,避免误报)
  'slot',
  // Risu 通用/算术/条件宏(深度守卫等自生成模板会用,避免误报)
  'data', // regex 系统完整匹配 token(scripts.ts dreg),非 cbs 宏但有效
  'and',
  'or',
  'not',
  'greaterequal',
  'lessequal',
  '?',
]);

// ST 世界书宏:Risu 无等价(lorebook 内容由 Risu 系统填充),保留原名 + 报告,避免静默失效
const B_ST_WI = ['wi', 'wibefore', 'wiafter', 'wiinsert'] as const;

// ST 宏在 Risu 无等价:保留原名 + 报告(与世界书宏同类处理)
const B_NO_EQUIV: ReadonlyArray<[string, string]> = [
  ['words', 'Tavern memory 扩展动态宏,Risu 无此宏,透传不生效'],
];

// B 同名不同义:Risu 有同名宏但语义有差异,保留原名 + 报告
const B_SAME_NAME = new Map<string, string>([
  ['time', 'Tavern moment LT;Risu 24h 不补零/带参为格式串'],
  ['isotime', 'Tavern 本地 HH:mm;Risu UTC HH:MM:SS(含义相反)'],
  ['date', 'Tavern 长格式;Risu YYYY-M-D'],
  ['idleduration', '参照最后用户消息 vs 最后消息;humanized vs HH:MM:SS'],
  ['trim', '作用域式 vs 字符串函数'],
  ['random', 'Tavern 空=空;Risu 0~1 浮点'],
  ['isodate', 'Tavern 本地 YYYY-MM-DD(补零);Risu UTC YYYY-M-D(不补零)'],
]);

// 宏查表:name -> reason
const B_REASON = new Map<string, string>([
  ...B_SAME_NAME,
  ...B_NO_EQUIV,
  ...B_ST_WI.map((n) => [n, 'ST 世界书宏,Risu 无等价(lorebook 内容由 Risu 系统填充),透传不生效'] as [string, string]),
]);

// C 翻译:改写为 Risu 等价宏
const C_RENAME = new Map<string, string>([
  ['charprompt', 'mainprompt'],
  ['charinstruction', 'jb'],
  ['mesexamples', 'exampledialogue'],
  ['mesexamplesraw', 'exampledialogue'],
  ['weekday', 'date::dddd'],
  ['newline', 'br'],
  ['noop', 'blank'],
  ['ismobile', 'metadata::mobile'], // Tavern isMobile(true/false) -> Risu metadata::mobile(1/0)
  ['maxprompt', 'maxcontext'], // Tavern maxPrompt(=上下文尺寸) -> Risu maxcontext
  ['maxprompttokens', 'maxcontext'],
  ['maxcontexttokens', 'maxcontext'],
  // ST 角色字段宏 char- 前缀 -> Risu 无前缀宏(正常化后命中)
  ['chardescription', 'description'],
  ['charpersonality', 'personality'],
  ['charscenario', 'scenario'],
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

    // 变量写宏:Risu 无等价或仅 runVar=true 时执行(round9),透传会静默失效 -> 报告 manual
    const VAR_MANUAL_REASON = new Map<string, string>([
      ['setvar', 'Risu 中 setvar 仅 runVar=true(触发器)时执行,prompt 卡内 runVar=false → 字面量残留;建议用触发器 setvar effect 或 customPromptTemplateToggle 迁移'],
      ['addvar', 'Risu 中 addvar 仅 runVar=true 时执行,prompt 卡内 runVar=false → 不写入;建议用触发器 addvar effect 迁移'],
      ['setdefaultvar', 'Risu 中 setdefaultvar 仅 runVar=true 时执行,prompt 卡内 runVar=false → 不写入;建议用触发器迁移'],
      ['incvar', 'Risu 无 incvar 宏;等价 addvar::n::1 但仅 runVar=true 时执行,prompt 卡内不写入;建议用触发器迁移'],
      ['decvar', 'Risu 无 decvar 宏;等价 addvar::n::-1 但仅 runVar=true 时执行,prompt 卡内不写入;建议用触发器迁移'],
      ['setglobalvar', 'Risu 无 setglobalvar 宏(全局变量只能经触发器/UI 写入),该变量初始化不生效'],
      ['addglobalvar', 'Risu 无 addglobalvar 宏(全局变量只能经触发器/UI 写入)'],
      ['incglobalvar', 'Risu 无 incglobalvar 宏(全局变量只能经触发器/UI 写入)'],
      ['decglobalvar', 'Risu 无 decglobalvar 宏(全局变量只能经触发器/UI 写入)'],
      ['hasvar', 'Risu 无 hasvar 宏(可用 getvar 判空代替)'],
      ['deletevar', 'Risu 无 deletevar 宏(聊天变量删除无公开宏)'],
      ['hasglobalvar', 'Risu 无 hasglobalvar 宏(可用 getglobalvar 判空代替)'],
      ['deleteglobalvar', 'Risu 无 deleteglobalvar 宏(全局变量删除无公开宏)'],
    ]);
    const varManualReason = VAR_MANUAL_REASON.get(name);
    if (varManualReason) {
      report?.add('macros', {
        macro: full,
        action: 'manual',
        reason: varManualReason,
        ...(context ? { scriptName: context } : {}),
      });
      return full;
    }

    if (B_REASON.has(norm)) {
      const prefix = B_SAME_NAME.has(norm) ? '同名不同义' : 'Risu 无等价';
      report?.add('macros', {
        macro: full,
        action: 'kept',
        reason: `${prefix}:${B_REASON.get(norm)}`,
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
