// M6: 通用性不变量测试 —— 用合成变异预设验证转换器对任意 ST 形态不崩溃、不静默丢失。
// 原则:转换器是通用工具,不得绑定任何特定预设。fixtures/variation-st.json 覆盖
// 采样字段类型变异 / UUID 卡 / 非字符串 content / 空 content / 缺失引用 / 正则形态变异。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convert } from '../src/index.js';

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test', 'fixtures', 'variation-st.json'), 'utf8'));

test('通用不变量:任意形态变异预设转换不崩溃', () => {
  assert.doesNotThrow(() => convert(fixture, { source: 'variation-st.json' }));
});

test('通用不变量:非字符串 content(数字)不崩溃且转成字符串卡', () => {
  const { preset } = convert(fixture);
  const card = preset.promptTemplate.find((c: any) => c.name === 'Numeric Content');
  assert.ok(card, 'numeric content card present');
  assert.equal(typeof card.text, 'string');
  assert.equal(String(card.text).trim(), '12345');
});

test('通用不变量:无 role、无 content 的卡不崩溃,role 归 system', () => {
  const { preset, report } = convert(fixture);
  const card = preset.promptTemplate.find((c: any) => c.name === 'No Role');
  assert.ok(card, 'no-role card present');
  assert.equal(card.role, 'system');
});

test('通用不变量:prompt_order 引用缺失的 prompt 被报告(不静默)', () => {
  const { report } = convert(fixture);
  const missing = report.sections.prompts.filter((e) => e.action === 'manual' && /不存在/.test(e.reason));
  assert.equal(missing.length, 1, 'missing prompt ref reported once');
  assert.equal((missing[0] as any).identifier, 'missing-prompt-ref');
});

test('通用不变量:chatHistory/worldInfoBefore 自定义 content 报告 degraded(不静默丢)', () => {
  const { report } = convert(fixture);
  const degraded = report.sections.prompts.filter(
    (e) => e.action === 'degraded' && ['chatHistory', 'worldInfoBefore'].includes((e as any).identifier as string),
  );
  assert.equal(degraded.length, 2);
});

test('通用不变量:UUID 自定义卡报告 converted(不静默降级)', () => {
  const { report } = convert(fixture);
  const converted = report.sections.prompts.filter(
    (e) => e.action === 'converted' && (e as any).name === 'Custom Memo Block',
  );
  assert.equal(converted.length, 1);
});

test('通用不变量:disabled 卡 dropped 报告,不进模板', () => {
  const { preset, report } = convert(fixture);
  assert.ok(!preset.promptTemplate.some((c: any) => c.name === 'Jailbreak'));
  const dropped = report.sections.prompts.filter((e) => e.action === 'dropped' && (e as any).identifier === 'jailbreak');
  assert.equal(dropped.length, 1);
});

test('通用不变量:字符串 placement "1,2" 与字符串数组 ["2","1"] 都转成脚本(不静默丢)', () => {
  const { preset, report } = convert(fixture);
  const names = new Set(preset.regex.map((r: any) => r.comment));
  assert.ok([...names].some((n) => String(n).includes('str-placement')), 'str-placement converted');
  assert.ok([...names].some((n) => String(n).includes('str-placement-array')), 'str-placement-array converted');
  // 两个 placement 类型都产生 editinput
  assert.ok(preset.regex.some((r: any) => r.comment.includes('str-placement') && r.type === 'editinput'));
  assert.ok(preset.regex.some((r: any) => r.comment.includes('str-placement-array') && r.type === 'editinput'));
  // 字符串 substituteRegex "1" -> <cbs>
  const strSub = preset.regex.find((r: any) => r.comment.includes('str-placement'));
  assert.ok(strSub, 'str-placement script exists');
  assert.match((strSub as any).flag as string, /<cbs>/, 'string substituteRegex "1" adds <cbs>');
});

test('通用不变量:空 findRegex 脚本被丢弃(危险输出防护)', () => {
  const { preset, report } = convert(fixture);
  assert.ok(!preset.regex.some((r: any) => r.comment.includes('empty-regex')));
  const manual = report.sections.regex.filter((e) => e.action === 'manual' && (e as any).scriptName === 'empty-regex');
  assert.equal(manual.length, 1);
});

test('通用不变量:字符串 substituteRegex "2"(ESCAPED)报 manual', () => {
  const { report } = convert(fixture);
  const esc = report.sections.regex.filter(
    (e) => e.action === 'manual' && (e as any).scriptName === 'string-subregex',
  );
  assert.equal(esc.length, 1);
  assert.match(esc[0].reason, /ESCAPED/);
});

test('通用不变量:disabled 脚本保留为 type=disabled', () => {
  const { preset } = convert(fixture);
  const d = preset.regex.find((r: any) => r.comment.includes('disabled'));
  assert.ok(d);
  assert.equal(d.type, 'disabled');
});

test('通用不变量:未知顶层字段报告 manual(不静默忽略)', () => {
  const { report } = convert(fixture);
  const unknown = report.sections.topLevel.filter((e) => (e as any).field === 'unknown_custom_field');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].action, 'manual');
});

test('通用不变量:采样字段类型变异(字符串/布尔/null)不崩溃', () => {
  const { preset } = convert(fixture);
  assert.equal(typeof preset.temperature, 'number');
  assert.equal(typeof preset.top_a, 'number');
  assert.equal(typeof preset.maxResponse, 'number');
  // 布尔 min_p 应被拒绝(宽松强转陷阱),用默认值
  assert.equal(preset.min_p, 0);
});

test('通用不变量:toggle 化变量卡组保留全部候选(嵌套宏值注入消费点)', () => {
  const { preset, module } = convert(fixture);
  assert.equal(typeof preset.customPromptTemplateToggle, 'string');
  const lines = (preset.customPromptTemplateToggle as string).split('\n');
  const tone = lines.find((l: string) => l.startsWith('tone='));
  assert.ok(tone, 'tone toggle present');
  assert.match(tone as string, /Toggle Candidate/, 'candidate 1 in select options');
  assert.match(tone as string, /Toggle Candidate 2/, 'candidate 2 in select options');
  // round11 协调:tone 变量被 toggle 化,必须从触发器 setvar effect 排除
  const trigger = module?.trigger?.[0];
  const effectValues = trigger ? JSON.stringify(trigger.effect) : '';
  assert.ok(!effectValues.includes('tone'), 'toggle-ized variable excluded from trigger effects');
});

test('通用不变量:报告 summary 与 sections 一致(无条目被遗漏)', () => {
  const { report } = convert(fixture);
  for (const [action, count] of Object.entries(report.summary) as [string, number][]) {
    const actual = Object.values(report.sections).reduce(
      (acc: number, sec: any[]) => acc + sec.filter((e: any) => e.action === action).length,
      0,
    );
    assert.equal(actual, count, `summary.${action} matches sections`);
  }
});
