// 孤立 disabled 卡 → 默认关闭的开关(round18)。
//
// 背景:ST 的 disabled prompt(无 setvar 变量,如破限示例卡/提示卡/教程卡)目前在
// mapPrompts 被丢弃——但 Risu prompt 卡没有 enabled 字段(PromptItem 无 ableFlag,
// 只有 customscript 有),无法"保留内容但默认不注入"。用户诉求:关掉的卡也要能
// 在 Risu 里开关选择使用。
//
// 方案:每张孤立 disabled 卡 → 一行 toggle(两个选项:关闭=空 / 开启=内容,默认关)+
// 一张守卫卡。守卫卡 type=plain,text 为每张卡的
//   `{{#if {{or::{{? {{getglobalvar::toggle_X}}==1}}::{{? {{getglobalvar::toggle_X}}==null}}}}}}<内容>{{/if}}`
// 即:默认(未选择,index=null)注入空,用户打开开关(index=1)才注入卡内容。
//
// 仅处理"未进 toggle 的 disabled 卡":已 toggle 化的变量组(setvar 候选)不进此逻辑,
// 否则内容重复注入。判定:卡 content 含 {{setvar:: 宏 → 归变量组,跳过。
import type { Report, RisuPromptCard, TavernPreset, STPrompt, ToggleDef } from './types.js';
import { renderToggleTemplate } from './mapToggles.js';
import { asString } from './util.js';

export interface DisabledToggleResult {
  /** 追加的 toggle 定义行(与现有 toggleTemplate 合并) */
  toggleLines: string;
  /** 守卫卡(0 或 1 张),追加到 promptTemplate 末尾 */
  guardCard: RisuPromptCard | null;
}

const safeToken = (s: string): string => s.replace(/[=,]/g, '').trim().replace(/\s+/g, ' ') || '选项';

// 收集孤立 disabled 卡(disabled 且不含 {{setvar:: 宏)。返回 { 卡, 生成的 key }
export function collectDisabledCards(
  prompts: STPrompt[],
  order: { identifier: string; enabled?: boolean }[],
): { prompt: STPrompt; key: string }[] {
  const byId = new Map(prompts.map((p) => [p.identifier, p]));
  const out: { prompt: STPrompt; key: string }[] = [];
  for (const item of order) {
    if (item.enabled !== false) continue; // 只看 disabled
    const p = byId.get(item.identifier);
    if (!p) continue;
    const content = asString(p.content);
    if (/\{\{setvar::/i.test(content)) continue; // 变量组候选,归 mapToggles
    const name = p.name || p.identifier;
    out.push({ prompt: p, key: `sw_${out.length + 1}_${safeToken(name)}` });
  }
  return out;
}

// 生成 toggle 定义行 + 守卫卡
export function mapDisabledToggles(
  prompts: STPrompt[],
  order: { identifier: string; enabled?: boolean }[],
  report: Report,
): DisabledToggleResult {
  const disabled = collectDisabledCards(prompts, order);
  if (disabled.length === 0) return { toggleLines: '', guardCard: null };

  const defs = new Map<string, ToggleDef>();
  for (const { key, prompt } of disabled) {
    // 两选项:关闭(默认,空内容)/ 开启(卡内容)。defaultIndex=0
    const name = prompt.name || prompt.identifier;
    defs.set(key, {
      key,
      label: name,
      options: [
        { content: '', label: '❌ 关闭', enabled: true },
        { content: asString(prompt.content), label: '✅ 开启', enabled: false },
      ],
      defaultIndex: 0,
    });
    report.add('toggles', {
      key,
      action: 'converted',
      reason: `disabled 卡 → 默认关闭的开关("${name}",开启才注入内容)`,
    });
  }

  const guardParts = disabled.map(({ key }) => {
    const ref = `{{getglobalvar::toggle_${key}}}`;
    const cond = `{{? ${ref}==1}}`;
    const content = asString(defs.get(key)!.options[1].content);
    return `{{#if ${cond}}}${content}{{/if}}`;
  });

  return {
    toggleLines: renderToggleTemplate(defs),
    guardCard: {
      type: 'plain',
      type2: 'normal',
      role: 'system',
      name: '🔒 已关闭提示(开关开启后生效)',
      text: guardParts.join(''),
    },
  };
}
