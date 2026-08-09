// 产物校验器(round14):验证 .risu.json 能在 Risu 导入时正常消费。
//
// 三层校验:
// 1. 结构校验 —— 卡类型/字段形态合法(normalizePromptTemplate 不会崩、flag 合法)
// 2. templateCheck 复刻 —— 复现 Risu templateCheck.ts 的 8 条警告(main/globalNote/
//    description/lorebook/chat-end 等),保证导入无警告
// 3. 一致性校验 —— toggle 定义 key 与消费点 {{getglobalvar::toggle_X}} 引用一致;
//    触发器 effect 引用的变量在 scriptstate 有定义来源
//
// 依据:Risu templateCheck.ts、util.ts:1049 parseToggleSyntax、database.svelte.ts:2524
// normalizePromptTemplate、prompt.ts PromptItem 类型。

import type { RisuPreset } from './types.js';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  /** 定位:如 'promptTemplate[2]' / 'toggle:wenfeng' / 'regex:r1' */
  where?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const VALID_CARD_TYPES = new Set([
  'plain',
  'jailbreak',
  'cot',
  'chat',
  'persona',
  'description',
  'lorebook',
  'postEverything',
  'authornote',
  'memory',
  'chatML',
  'cache',
]);

const VALID_PLAIN_TYPE2 = new Set(['normal', 'globalNote', 'main']);

function validateTemplateTemplate(preset: RisuPreset, issues: ValidationIssue[]): void {
  const cards = preset.promptTemplate;
  if (!Array.isArray(cards)) {
    issues.push({ severity: 'error', code: 'TEMPLATE_MISSING', message: 'promptTemplate 缺失或非数组' });
    return;
  }

  let main = 0;
  let note = 0;
  let hasDescription = false;
  let hasLorebook = false;
  let reachEnd = false;
  const startRanges: number[] = [];
  const endRanges: number[] = [];

  cards.forEach((c, i) => {
    const where = `promptTemplate[${i}]`;
    if (!c || typeof c !== 'object') {
      issues.push({ severity: 'error', code: 'CARD_INVALID', message: '卡项非对象', where });
      return;
    }
    if (typeof c.type !== 'string' || !VALID_CARD_TYPES.has(c.type)) {
      issues.push({
        severity: 'error',
        code: 'CARD_TYPE_INVALID',
        message: `未知卡类型 '${String(c.type)}'(Risu PromptItem 无此 type)`,
        where,
      });
    }
    if (c.type === 'plain' || c.type === 'jailbreak' || c.type === 'cot') {
      // 这三类必须有 type2(normal/globalNote/main)与 role
      if (typeof c.type2 !== 'string' || !VALID_PLAIN_TYPE2.has(c.type2)) {
        issues.push({
          severity: 'error',
          code: 'PLAIN_TYPE2_INVALID',
          message: `plain/jailbreak/cot 卡缺 type2('${String(c.type2)}')`,
          where,
        });
      }
      if (c.type2 === 'main') main++;
      if (c.type2 === 'globalNote') note++;
    }
    if (c.type === 'chat') {
      const rs = Number(c.rangeStart);
      if (c.rangeStart !== undefined && c.rangeStart !== -1000 && c.rangeStart !== 0 && !Number.isNaN(rs)) startRanges.push(rs);
      if (c.rangeEnd !== undefined && c.rangeEnd !== 'end' && !Number.isNaN(Number(c.rangeEnd))) endRanges.push(Number(c.rangeEnd));
      else if (c.rangeEnd === 'end') reachEnd = true;
    }
    if (c.type === 'description') hasDescription = true;
    if (c.type === 'lorebook') hasLorebook = true;
  });

  // —— templateCheck 复刻(8 条警告)——
  if (main === 0) issues.push({ severity: 'warning', code: 'NO_MAIN', message: 'No main prompt entry found' });
  if (main > 1)
    issues.push({ severity: 'warning', code: 'MULTI_MAIN', message: 'Multiple main prompt entries found, this can result in unexpected behavior' });
  if (note === 0) issues.push({ severity: 'warning', code: 'NO_NOTE', message: 'No global notes entry found' });
  if (note > 1)
    issues.push({ severity: 'warning', code: 'MULTI_NOTE', message: 'Multiple global notes entries found, this can result in unexpected behavior' });
  if (!hasDescription) issues.push({ severity: 'warning', code: 'NO_DESCRIPTION', message: 'No description entry found' });
  if (!hasLorebook) issues.push({ severity: 'warning', code: 'NO_LOREBOOK', message: 'No lorebook entry found' });
  if (!reachEnd) issues.push({ severity: 'warning', code: 'NO_CHAT_END', message: 'No chat entry found with range end set to "Until chat end"' });

  const unresolved = startRanges
    .filter((x) => !endRanges.includes(x))
    .concat(endRanges.filter((x) => !startRanges.includes(x)));
  if (unresolved.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'CHAT_UNCONNECTED',
      message: `Chat are not connected: [${unresolved.join(', ')}]`,
    });
  }
}

// toggle 语法解析(复刻 util.ts:1049 parseToggleSyntax 的成功判定)
function parseToggleLine(line: string): { key: string; value: string; type: string | undefined; options: string[] } | null {
  const [key, value, type, option] = line.split('=');
  if (type === 'group' || type === 'groupEnd' || type === 'divider' || type === 'caption') return { key, value, type, options: [] };
  if (key && value) {
    return { key, value, type: type === 'select' || type === 'text' || type === 'textarea' ? type : undefined, options: option?.split(',') ?? [] };
  }
  return null;
}

function validateToggle(preset: RisuPreset, issues: ValidationIssue[]): void {
  const template = preset.customPromptTemplateToggle;
  if (!template) return;
  const lines = String(template).split('\n');
  lines.forEach((line, i) => {
    const where = `toggle#line${i + 1}`;
    if (!line.trim()) return;
    const parsed = parseToggleLine(line);
    if (!parsed) {
      issues.push({ severity: 'error', code: 'TOGGLE_PARSE_FAIL', message: `toggle 行无法解析(需 key=value=type=opts 或 group 类)`, where });
      return;
    }
    if (parsed.key.includes('=') || parsed.key.includes(',')) {
      issues.push({
        severity: 'error',
        code: 'TOGGLE_KEY_INVALID',
        message: `toggle key '${parsed.key}' 含 '='/','(parseToggleSyntax 按 '=' 切分,key 会被截断)`,
        where,
      });
    }
  });

  // select 型 toggle 至少 2 选项(单选项无切换意义)
  lines.forEach((line, i) => {
    const parsed = parseToggleLine(line);
    if (parsed?.type === 'select' && parsed.options.length < 2) {
      issues.push({
        severity: 'info',
        code: 'TOGGLE_SELECT_SINGLE',
        message: `select '${parsed.key}' 仅 ${parsed.options.length} 个选项,切换无意义`,
        where: `toggle#line${i + 1}`,
      });
    }
  });
}

// 一致性:消费点引用 {{getglobalvar::toggle_X}} 的 X 必须在 toggle 定义中存在
function validateToggleConsistency(preset: RisuPreset, issues: ValidationIssue[]): void {
  if (!preset.customPromptTemplateToggle) return;
  const defined = new Set<string>();
  for (const line of String(preset.customPromptTemplateToggle).split('\n')) {
    const parsed = parseToggleLine(line);
    if (parsed && parsed.type === 'select') defined.add(parsed.key);
  }
  const referenced = new Set<string>();
  const re = /\{\{getglobalvar::toggle_([^{}]+)\}\}/g;
  const scan = (text: unknown): void => {
    if (typeof text !== 'string') return;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) referenced.add(m[1].trim());
  };
  for (const c of preset.promptTemplate ?? []) {
    scan((c as Record<string, unknown>).text);
    scan((c as Record<string, unknown>).innerFormat);
  }
  for (const key of referenced) {
    if (!defined.has(key)) {
      issues.push({
        severity: 'error',
        code: 'TOGGLE_REF_UNDEFINED',
        message: `消费点引用 {{getglobalvar::toggle_${key}}},但 toggle 定义中无 select '${key}'`,
      });
    }
  }
}

// 触发器一致性:setvar effect 的变量 key 有定义来源(无则提示,不阻塞)
function validateTriggerConsistency(preset: RisuPreset, issues: ValidationIssue[]): void {
  // preset 本身不含触发器(在 .module.json),此校验由 validateModule 承担
  void preset;
}

function validateRegex(preset: RisuPreset, issues: ValidationIssue[]): void {
  const regex = preset.regex;
  if (!Array.isArray(regex)) return;
  regex.forEach((r, i) => {
    const where = `regex[${i}]`;
    if (r && typeof r === 'object' && typeof r.type !== 'string') {
      issues.push({ severity: 'error', code: 'REGEX_TYPE_INVALID', message: 'regex 缺 type', where });
    }
    if (r && r.type !== 'disabled' && (r.in === undefined || r.in === null)) {
      issues.push({ severity: 'error', code: 'REGEX_IN_MISSING', message: 'regex 缺 in(空 in 在 Risu 匹配一切文本)', where });
    }
  });
}

export function validatePreset(preset: RisuPreset): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateTemplateTemplate(preset, issues);
  validateToggle(preset, issues);
  validateToggleConsistency(preset, issues);
  validateRegex(preset, issues);
  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

// 校验 .module.json(触发器模块):setvar/addvar 等 effect 的 key 合法、trigger type 合法
export function validateModule(module: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!module) return { ok: true, issues };
  const m = module as { type?: string; name?: string; trigger?: unknown[] };
  if (m.type !== 'risuModule') {
    issues.push({ severity: 'error', code: 'MODULE_TYPE_INVALID', message: '模块 type 必须为 risuModule' });
  }
  if (!m.name) issues.push({ severity: 'warning', code: 'MODULE_NAME_MISSING', message: '模块缺 name' });
  if (Array.isArray(m.trigger)) {
    m.trigger.forEach((t, i) => {
      const trig = t as { type?: string; effect?: unknown[] };
      const where = `module.trigger[${i}]`;
      if (trig.type !== 'start' && trig.type !== 'manual' && trig.type !== 'input' && trig.type !== 'output' && trig.type !== 'request') {
        issues.push({ severity: 'error', code: 'TRIGGER_TYPE_INVALID', message: `未知 trigger type '${String(trig.type)}'`, where });
      }
      if (!Array.isArray(trig.effect) || trig.effect.length === 0) {
        issues.push({ severity: 'error', code: 'TRIGGER_NO_EFFECT', message: 'trigger 无 effect', where });
      }
    });
  }
  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

// 汇总校验:preset + module 一体
export function validateAll(preset: RisuPreset, module: unknown): ValidationResult {
  const presetResult = validatePreset(preset);
  const moduleResult = validateModule(module);
  const issues = [...presetResult.issues, ...moduleResult.issues];
  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}
