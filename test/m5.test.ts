import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapToggles, rewriteGetvar, renderToggleTemplate, filterSetvarsForTrigger } from '../src/mapToggles.js';
import { createReport } from '../src/report.js';
import { convert } from '../src/index.js';
import type { TavernPreset } from '../src/types.js';

function presetWith(options: { setvarCards: { identifier: string; name?: string; content: string; enabled?: boolean }[]; consumer?: string }) {
  const setvarCards = options.setvarCards.map((c) => ({
    identifier: c.identifier,
    name: c.name,
    role: 'system',
    content: c.content,
  }));
  return {
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          ...options.setvarCards.map((c) => ({ identifier: c.identifier, enabled: c.enabled ?? true })),
        ],
      },
    ],
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', content: options.consumer ?? 'hello' },
      ...setvarCards,
    ],
  } as unknown as TavernPreset;
}

// ---------- mapToggles ----------

test('mapToggles: 变量组 -> select 定义,enabled 卡为默认项', () => {
  const report = createReport('t');
  const r = mapToggles(
    {} as TavernPreset,
    [
      { identifier: 'a', name: '文风|真实感', role: 'system', content: '{{setvar::style::真}}' },
      { identifier: 'b', name: '文风|轻小说', role: 'system', content: '{{setvar::style::轻}}' },
    ],
    [
      { identifier: 'a', enabled: true },
      { identifier: 'b', enabled: false },
    ],
    report,
  );
  assert.ok(r.defs.has('style'));
  const def = r.defs.get('style')!;
  assert.equal(def.options.length, 2);
  assert.equal(def.defaultIndex, 0); // enabled 卡 'a' 是默认
  assert.equal(def.options[0].content, '真');
  assert.match(r.toggleTemplate, /^style=文风\|真实感=select=/m);
  assert.ok(r.toggleKeys.has('style'));
});

test('mapToggles: 全空值卡(纯初始化)不进 toggle', () => {
  const report = createReport('t');
  const r = mapToggles(
    {} as TavernPreset,
    [{ identifier: 'a', name: 'Init', role: 'system', content: '{{setvar::x::}}{{setvar::y::}}' }],
    [{ identifier: 'a', enabled: true }],
    report,
  );
  assert.equal(r.defs.size, 0);
  assert.equal(r.toggleTemplate, '');
  assert.equal(r.toggleKeys.size, 0);
});

test('mapToggles: 选项/标签含 = 或 , 被剔除(不破坏 parseToggleSyntax)', () => {
  const report = createReport('t');
  const r = mapToggles(
    {} as TavernPreset,
    [{ identifier: 'a', name: '模式A,增强', role: 'system', content: '{{setvar::m::1}}' }],
    [{ identifier: 'a', enabled: true }],
    report,
  );
  assert.ok(!r.toggleTemplate.includes(',')); // 选项不含 ,
  assert.ok(!r.toggleTemplate.split('\n')[0].split('=')[1]?.includes('=')); // label 不含 =
});

// ---------- rewriteGetvar ----------

test('rewriteGetvar: toggle 变量 -> 多分支 if 注入,默认项带 null 兜底', () => {
  const report = createReport('t');
  const r = mapToggles(
    {} as TavernPreset,
    [
      { identifier: 'a', name: '默认项', role: 'system', content: '{{setvar::style::默认内容}}' },
      { identifier: 'b', name: '备选', role: 'system', content: '{{setvar::style::备选内容}}' },
    ],
    [
      { identifier: 'a', enabled: true },
      { identifier: 'b', enabled: false },
    ],
    report,
  );
  const out = rewriteGetvar('前置 {{getvar::style}} 后置', r.defs);
  assert.match(out, /getglobalvar::toggle_style/);
  assert.match(out, /==null/); // 默认项有 null 兜底
  assert.ok(out.includes('默认内容'));
  assert.ok(out.includes('备选内容'));
  assert.ok(!out.includes('{{getvar::style}}'));
  assert.ok(out.startsWith('前置 '));
  assert.ok(out.endsWith(' 后置'));
});

test('rewriteGetvar: 非 toggle 变量保持原样', () => {
  const report = createReport('t');
  const r = mapToggles(
    {} as TavernPreset,
    [{ identifier: 'a', name: 'A', role: 'system', content: '{{setvar::x::1}}' }],
    [{ identifier: 'a', enabled: true }],
    report,
  );
  assert.equal(rewriteGetvar('{{getvar::y}}', r.defs), '{{getvar::y}}');
});

test('filterSetvarsForTrigger: 剔除 toggle 变量', () => {
  const toggles = new Set(['style']);
  const out = filterSetvarsForTrigger(
    [
      { name: 'style', operator: '=' as const, value: 'x' },
      { name: 'tmp', operator: '=' as const, value: '' },
    ],
    toggles,
  );
  assert.deepEqual(out, [{ name: 'tmp', operator: '=', value: '' }]);
});

// ---------- convert 集成 ----------

test('convert: 消费点 getvar 改写 + preset.customPromptTemplateToggle + 触发器排除 toggle 变量', () => {
  const json = presetWith({
    setvarCards: [
      { identifier: 'style-a', name: '风格A', content: '{{setvar::style::风格A内容}}' },
      { identifier: 'style-b', name: '风格B', content: '{{setvar::style::风格B内容}}' },
      { identifier: 'init', name: 'Init', content: '{{setvar::internal::}}' },
    ],
    consumer: '当前风格:{{getvar::style}};内部:{{getvar::internal}}',
  });
  const { preset, module } = convert(json, { source: 't.json' });
  // toggle 定义
  assert.ok(preset.customPromptTemplateToggle);
  assert.match(preset.customPromptTemplateToggle, /^style=风格A=select=/m);
  // 消费点改写
  const main = preset.promptTemplate.find((c) => (c as { name?: string }).name === 'Main') as unknown as { text: string };
  assert.match(main.text, /getglobalvar::toggle_style/);
  assert.ok(!main.text.includes('{{getvar::style}}'));
  assert.ok(main.text.includes('风格A内容'));
  assert.ok(main.text.includes('风格B内容'));
  // internal 未被 toggle 化,保持 getvar(触发器会设值)
  assert.ok(main.text.includes('{{getvar::internal}}'));
  // 触发器:排除 style,保留 internal
  assert.ok(module);
  const effect = module.trigger?.[0].effect as { var: string }[];
  assert.ok(effect.some((e) => e.var === 'internal'));
  assert.ok(!effect.some((e) => e.var === 'style'));
});

test('convert: 无开关变量时无 toggle 输出', () => {
  const json = presetWith({
    setvarCards: [{ identifier: 'init', name: 'Init', content: '{{setvar::x::}}' }],
    consumer: 'plain',
  });
  const { preset } = convert(json, { source: 't.json' });
  assert.equal(preset.customPromptTemplateToggle, undefined);
});
