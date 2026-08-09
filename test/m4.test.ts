import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractSetVars, buildStartTrigger, buildModule } from '../src/mapTriggers.js';
import { createReport } from '../src/report.js';
import { convert } from '../src/index.js';
import { parseST } from '../src/ir.js';
import { mapPrompts } from '../src/mapPrompts.js';
import type { TavernPreset } from '../src/types.js';

// ---------- extractSetVars ----------

test('extractSetVars: setvar/addvar/incvar/decvar -> effect,从文本剔除', () => {
  const { text, setvars } = extractSetVars('{{setvar::foo::1}} A {{addvar::bar::2}} {{incvar::count}} {{decvar::down}}');
  assert.equal(text, ' A   ');
  assert.deepEqual(
    setvars.map((s) => ({ name: s.name, operator: s.operator, value: s.value })),
    [
      { name: 'foo', operator: '=', value: '1' },
      { name: 'bar', operator: '+=', value: '2' },
      { name: 'count', operator: '+=', value: '1' },
      { name: 'down', operator: '-=', value: '1' },
    ],
  );
});

test('extractSetVars: setvar 值为空串({{setvar::x::}}) 保留空 value', () => {
  const { setvars } = extractSetVars('{{setvar::x::}}');
  assert.deepEqual(setvars, [{ name: 'x', operator: '=', value: '' }]);
});

test('extractSetVars: 空文本/无宏 原样返回且无报告', () => {
  const report = createReport('t');
  const r1 = extractSetVars('', report);
  assert.equal(r1.text, '');
  assert.equal(r1.setvars.length, 0);
  const r2 = extractSetVars('plain {{char}} text', report);
  assert.equal(r2.text, 'plain {{char}} text');
  assert.equal(report.sections.macros.length, 0);
});

test('extractSetVars: 嵌套宏值不提取,报告 manual', () => {
  const report = createReport('t');
  const { text, setvars } = extractSetVars('{{setvar::X::{{char}}}}', report);
  assert.equal(text, '{{setvar::X::{{char}}}}'); // 保留原文
  assert.equal(setvars.length, 0);
  const manual = report.sections.macros.find((e) => e.action === 'manual');
  assert.ok(manual);
  assert.match(manual.reason as string, /嵌套宏/);
});

// ---------- buildStartTrigger / buildModule ----------

test('buildStartTrigger: 空 setvars -> null', () => {
  assert.equal(buildStartTrigger({ setvars: [], source: 'x' }), null);
});

test('buildStartTrigger: start 触发器 + setvar effect,value 过宏翻译', () => {
  const t = buildStartTrigger({
    setvars: [
      { name: 'foo', operator: '=', value: '{{charInstruction}}' },
      { name: 'n', operator: '+=', value: '2' },
    ],
    source: 'p.json',
  });
  assert.ok(t);
  assert.equal(t.type, 'start');
  assert.equal(t.comment, 'ST setvar 初始化(来自 p.json)');
  assert.deepEqual(t.conditions, []);
  assert.deepEqual(t.effect, [
    { type: 'setvar', operator: '=', var: 'foo', value: '{{jb}}' },
    { type: 'setvar', operator: '+=', var: 'n', value: '2' },
  ]);
});

test('buildModule: 含 trigger 数组与 type/id,无 setvar 时 null', () => {
  const m = buildModule({
    setvars: [{ name: 'k', operator: '=', value: 'v' }],
    source: 'My Preset.json',
  });
  assert.ok(m);
  assert.equal(m.module.type, 'risuModule');
  assert.equal(m.module.id, 'st2risu-setvar-my-preset-json');
  assert.equal(m.module.trigger?.length, 1);
  assert.equal(m.module.trigger?.[0].effect.length, 1);
  assert.equal(buildModule({ setvars: [], source: 'x' }), null);
});

// ---------- convert 集成 ----------

test('convert: setvar 卡 -> 模块输出 + 卡文本已剔除', () => {
  const presetJson = {
    name: 'with-setvar',
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'init', enabled: true },
        ],
      },
    ],
    prompts: [
      { identifier: 'main', role: 'system', content: 'hello' },
      { identifier: 'init', name: 'Init', role: 'system', content: '{{setvar::hp::100}}{{setvar::gold::50}}' },
    ],
  } as unknown as TavernPreset;
  const { preset, module, report } = convert(presetJson, { source: 'setvar-test.json' });
  assert.ok(module);
  assert.equal(module.trigger?.length, 1);
  const effect = module.trigger?.[0].effect as { type: string; var: string; value: string }[];
  assert.deepEqual(
    effect.map((e) => ({ var: e.var, value: e.value })),
    [
      { var: 'hp', value: '100' },
      { var: 'gold', value: '50' },
    ],
  );
  const initCard = preset.promptTemplate.find((c) => (c as { name?: string }).name === 'Init');
  assert.ok(initCard);
  assert.equal(String(initCard.text).includes('setvar'), false);
  const conv = report.sections.macros.find((e) => e.action === 'converted');
  assert.ok(conv);
  assert.match(conv.reason as string, /hp, gold/);
});

test('convert: 无 setvar 时 module 为 null', () => {
  const { module } = convert(
    {
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      prompts: [{ identifier: 'main', role: 'system', content: 'hello' }],
    },
    { source: 'plain.json' },
  );
  assert.equal(module, null);
});

test('mapPrompts: 返回 setvars 供外部使用', () => {
  const report = createReport('t');
  const ir = parseST({
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    prompts: [{ identifier: 'main', role: 'system', content: '{{addvar::score::5}} hi' }],
  } as unknown as TavernPreset);
  const { setvars } = mapPrompts(ir, report);
  assert.deepEqual(
    setvars.map((s) => ({ name: s.name, operator: s.operator })),
    [{ name: 'score', operator: '+=' }],
  );
});
