import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mapDisabledToggles, collectDisabledCards } from '../src/mapDisabledToggles.js';
import { convert } from '../src/index.js';
import { createReport } from '../src/report.js';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test', 'fixtures', 'minimal-st.json'), 'utf8'),
);

// 构造含孤立 disabled 卡 + 变量组候选 disabled 卡的预设
const withDisabled = {
  ...fixture,
  prompts: [
    ...(fixture.prompts ?? []),
    // 孤立 disabled 卡(无 setvar):破限示例
    { identifier: 'leak-example', name: '老版破限 0-16', role: 'system', content: 'Understood. I will carry out your orders strictly.' },
    // 变量组候选 disabled 卡:走 mapToggles,不进孤立守卫
    { identifier: 'think1-opt2', name: '深思考', role: 'system', content: '{{setvar::think1::深层思考}}' },
    // 含 setvar 但非候选
    { identifier: 'init-var', name: '初始化', role: 'system', content: '{{setvar::initx::1}}' },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        ...(fixture.prompt_order?.[0]?.order ?? []),
        { identifier: 'leak-example', enabled: false },
        { identifier: 'think1-opt2', enabled: false },
        { identifier: 'init-var', enabled: false },
      ],
    },
  ],
};

test('collectDisabledCards 只收集孤立 disabled(无 setvar 宏)', () => {
  const prompts = withDisabled.prompts as any[];
  const order = withDisabled.prompt_order![0].order as any[];
  const collected = collectDisabledCards(prompts, order);
  // minimal fixture 的 jailbreak(disabled、无 setvar)也会被收集;leak-example 必在其中
  assert.ok(collected.length >= 1);
  assert.ok(collected.some((c) => c.prompt.identifier === 'leak-example'));
  const leak = collected.find((c) => c.prompt.identifier === 'leak-example')!;
  assert.ok(leak.key.startsWith('sw_'));
  // 变量组候选(含 setvar)不进守卫
  assert.ok(!collected.some((c) => c.prompt.identifier === 'think1-opt2'));
  assert.ok(!collected.some((c) => c.prompt.identifier === 'init-var'));
});

test('mapDisabledToggles 生成守卫卡 + toggle 行(默认关)', () => {
  const report = createReport('t');
  const prompts = withDisabled.prompts as any[];
  const order = withDisabled.prompt_order![0].order as any[];
  const r = mapDisabledToggles(prompts, order, report);
  assert.ok(r.guardCard);
  assert.equal(r.guardCard!.type, 'plain');
  assert.equal(r.guardCard!.type2, 'normal');
  assert.equal(r.guardCard!.role, 'system');
  // 守卫卡用 {{#if {{? {{getglobalvar::toggle_sw_...}}==1}}}} 包裹内容
  const text = String(r.guardCard!.text);
  assert.match(text, /\{\{#if \{\{\? \{\{getglobalvar::toggle_sw_/);
  assert.ok(text.includes('Understood. I will carry out your orders strictly.'));
  assert.ok(!text.includes('{{or::'), '守卫条件应为纯 ==1,不注入默认');
  // toggle 行:key=label=select=关闭,开启(cleanLabel 剔除了 ❌/✅ emoji)
  assert.match(r.toggleLines, /sw_\d+_老版破限 0-16=老版破限 0-16=select=关闭,开启/);
  // 报告含 converted
  assert.ok(report.sections.toggles.some((e) => e.action === 'converted' && String(e.key).startsWith('sw_')));
});

test('convert 集成:孤立 disabled 卡 → 守卫卡,变量组 disabled 候选不重复', () => {
  const { preset, report } = convert(withDisabled);
  // 守卫卡存在
  const guard = preset.promptTemplate.find((c) => (c as any).name === '🔒 已关闭提示(开关开启后生效)');
  assert.ok(guard, 'guard card present');
  assert.match(String((guard as any).text), /toggle_sw_\d+_老版破限 0-16/);
  // think1 变量组在 withDisabled 里仅 1 个候选 → 走触发器(dropped),不进 toggle
  const toggleText = preset.customPromptTemplateToggle as string;
  assert.ok(!toggleText.includes('think1'), '单候选变量组走触发器,不进 toggle');
  assert.ok(!toggleText.includes('initx'), '纯初始化卡不进 toggle(全空)');
  // 守卫卡内容不含 setvar 宏内容
  assert.ok(!String((guard as any).text).includes('深层思考'), '变量组候选内容不进守卫卡');
  // 孤立卡不再以 plain 卡出现
  assert.ok(!preset.promptTemplate.some((c) => (c as any).text === 'Understood. I will carry out your orders strictly.'));
});

test('convert 无孤立 disabled 卡时无守卫卡', () => {
  // minimal fixture 的 jailbreak 是 disabled 的,会产生守卫卡;构造全 enabled 预设验证缺省
  const allEnabled = JSON.parse(JSON.stringify(fixture));
  allEnabled.prompt_order[0].order = (allEnabled.prompt_order[0].order as any[]).map((o) => ({ ...o, enabled: true }));
  const { preset } = convert(allEnabled);
  assert.ok(!preset.promptTemplate.some((c) => (c as any).name === '🔒 已关闭提示(开关开启后生效)'));
  // 但 guard toggle 行也不存在
  assert.ok(!(preset.customPromptTemplateToggle as string)?.includes('sw_'));
});
