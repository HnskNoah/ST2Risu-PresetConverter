// ST 变量卡 → Risu customPromptTemplateToggle。
//
// 背景(round11):ST 的"开关卡"机制 = 一组候选卡(prompt_order enabled 快照),每张卡
// `{{setvar::X::内容}}` 写同一变量 X 的一段内容,用户启用其一。模板消费点
// `{{getvar::X}}` 插入当前启用卡的内容(即"变量值即内容")。
// Risu toggle 只给 select 索引(存 globalChatVariables['toggle_X']),不含内容,故必须
// 把内容注入消费点:`{{getvar::X}}` → N 个 `{{#if {{? {{getglobalvar::toggle_X}}==i}}}}` 分支。
//
// 策略(round11 决策):完整保真——每个变量组 → select(保留全部候选选项),消费点改写
// 为多分支注入;当前 enabled 卡为默认项(未选=null 时命中默认分支)。
import type { ExtractedSetVar, Report, TavernPreset, STPrompt } from './types.js';
import { scanSetvarMacros } from './setvarParse.js';

export interface ToggleOption {
  /** 选项内容(setvar 值) */
  content: string;
  /** 来自的卡名(用于 select 选项标签) */
  label: string;
  /** 该卡当前是否启用(默认项) */
  enabled: boolean;
}

export interface ToggleDef {
  key: string;
  label: string;
  options: ToggleOption[];
  /** 默认选中索引(当前 enabled 的选项) */
  defaultIndex: number;
}



export interface ToggleMapResult {
  /** 生成的 customPromptTemplateToggle 定义(多行文本),空 = 无开关变量 */
  toggleTemplate: string;
  /** key -> 定义,供消费点改写 */
  defs: Map<string, ToggleDef>;
  /** 被 toggle 化的变量 key 集合(setvar 应从触发器排除) */
  toggleKeys: Set<string>;
}

// 从 ST 原始数据收集变量组。prompts 含所有卡(含 disabled),order 提供启用态与顺序。
export function mapToggles(
  preset: TavernPreset,
  prompts: STPrompt[],
  order: { identifier: string; enabled?: boolean }[],
  report: Report,
): ToggleMapResult {
  const byId = new Map(prompts.map((p) => [p.identifier, p]));
  // 变量 -> 选项列表(按 prompt_order 出现顺序)
  const groups = new Map<string, ToggleOption[]>();

  for (const item of order) {
    const p = byId.get(item.identifier);
    if (!p) continue;
    const content = p.content ?? '';
    for (const m of scanSetvarMacros(content)) {
      const key = m.name;
      if (!key) continue;
      const value = m.value;
      // 空值(初始化卡 {{setvar::x::}})不算选项,但保留 key 存在性以便识别"有卡但全空"
      if (!groups.has(key)) groups.set(key, []);
      if (value) {
        groups.get(key)!.push({ content: value, label: p.name ?? key, enabled: item.enabled !== false });
      }
    }
  }

  const defs = new Map<string, ToggleDef>();
  const toggleKeys = new Set<string>();

  for (const [key, options] of groups) {
    // 全空(纯初始化)不进 toggle
    if (options.length === 0) continue;
    const label = options.find((o) => o.enabled)?.label ?? options[0].label;
    const defaultIndex = options.findIndex((o) => o.enabled);
    const def: ToggleDef = { key, label, options, defaultIndex: defaultIndex === -1 ? 0 : defaultIndex };
    defs.set(key, def);
    toggleKeys.add(key);
    report.add('toggles', {
      key,
      action: 'converted',
      reason: `变量组 → select(${options.length} 选项,默认 "${options[def.defaultIndex].label}")`,
    });
  }

  return {
    toggleTemplate: renderToggleTemplate(defs),
    defs,
    toggleKeys,
  };
}

// label 与选项标签防护:parseToggleSyntax 用 line.split('=') 取 [key,value,type,option],
// option.split(',') 取选项——含 '=' 或 ',' 会破坏解析,必须剔除。选项另去 emoji。
const safeToggleToken = (s: string): string => s.replace(/[=,]/g, '').trim().replace(/\s+/g, ' ');
const cleanLabel = (label: string): string =>
  safeToggleToken(label.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')) || '选项';

export function renderToggleTemplate(defs: Map<string, ToggleDef>): string {
  const lines: string[] = [];
  for (const [key, def] of defs) {
    const options = def.options.map((o) => cleanLabel(o.label)).join(',');
    lines.push(`${safeToggleToken(key)}=${safeToggleToken(def.label)}=select=${options}`);
  }
  return lines.join('\n');
}

// 消费点改写:把 text 中 {{getvar::X}} 替换为多分支 if 注入(仅对 toggle 化的变量)。
// 未 toggle 化的 getvar 保持原样(触发器 setvar 会提供值)。
export function rewriteGetvar(text: string, defs: Map<string, ToggleDef>): string {
  if (!text || defs.size === 0) return text;
  return text.replace(/\{\{getvar::([^}]+)}}/g, (_full, rawKey: string) => {
    const key = rawKey.trim();
    const def = defs.get(key);
    if (!def) return _full;
    return renderOptionBranches(def);
  });
}

function renderOptionBranches(def: ToggleDef): string {
  const toggleRef = `{{getglobalvar::toggle_${def.key}}}`;
  const branches = def.options.map((opt, i) => {
    const isDefault = i === def.defaultIndex;
    // 默认项在"未选(null) 或 选中 i"时输出;其余项仅精确索引
    const cond = isDefault
      ? `{{or::{{? ${toggleRef}==${i}}}::{{? ${toggleRef}==null}}}}`
      : `{{? ${toggleRef}==${i}}}`;
    return `{{#if ${cond}}}${opt.content}{{/if}}`;
  });
  return branches.join('');
}

// 触发器侧:排除被 toggle 化的 setvar(否则 start 触发器每次重置变量,覆盖 toggle 选择)
export function filterSetvarsForTrigger(setvars: ExtractedSetVar[], toggleKeys: Set<string>): ExtractedSetVar[] {
  return setvars.filter((s) => !toggleKeys.has(s.name));
}
