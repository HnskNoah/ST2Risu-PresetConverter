import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildJinjaTemplate, mapInstruct, looksLikeInstruct } from '../src/mapInstruct.js';
import { convert } from '../src/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test', 'fixtures', 'minimal-st.json'), 'utf8'),
);

// ST instruct preset 常见形态(仿 Alpaca/ChatML 系)
const alpaca = {
  input_sequence: '### Instruction:',
  output_sequence: '### Response:',
  last_output_sequence: '',
  system_sequence: '### Input:',
  stop_sequence: '',
  first_output_sequence: '',
  output_suffix: '\n\n',
  input_suffix: '\n\n',
  system_suffix: '\n\n',
  system_same_as_user: false,
};

test('buildJinjaTemplate 生成标准三段循环(官方算法蓝本)', () => {
  const tpl = buildJinjaTemplate(alpaca);
  assert.match(tpl, /\{% for message in messages %\}/);
  assert.match(tpl, /\{% if message\.role == 'user' %\}### Instruction:\{\{ message\.content \}\}\n\n\{% endif %\}/);
  assert.match(tpl, /\{% if message\.role == 'assistant' %\}### Response:\{\{ message\.content \}\}\n\n\{% endif %\}/);
  assert.match(tpl, /\{% if message\.role == 'system' %\}### Input:\{\{ message\.content \}\}\n\n\{% endif %\}/);
  assert.match(tpl, /\{% endfor %\}/);
  // 收尾:last_output_sequence 为空,回退 output_sequence(生成提示/助手前缀)
  assert.ok(tpl.endsWith('### Response:'));
});

test('assistant 分支优先 first/last_output_sequence(官方丢弃的字段还原)', () => {
  const tpl = buildJinjaTemplate({ ...alpaca, first_output_sequence: '### First:', last_output_sequence: '### Final:' });
  assert.match(tpl, /\{% if loop\.first %\}### First:\{% elif loop\.last %\}### Final:\{% else %\}### Response:\{% endif %\}/);
});

test('system_same_as_user 时 system 消息按 user 序列包裹', () => {
  const tpl = buildJinjaTemplate({ ...alpaca, system_same_as_user: true });
  assert.match(tpl, /\{% if message\.role == 'system' %\}### Instruction:\{\{ message\.content \}\}### Response:\n\n\{% endif %\}/);
});

test('story_string 预处理:{{user}}->{{risu_user}}、{{system}} 替换、{{#if}} 块与残留花括号清除', () => {
  const tpl = buildJinjaTemplate({
    ...alpaca,
    story_string:
      '{{#if system}}{{system}}\n{{/if}}Hello {{user}}. {{system_prompt}} {{unresolved}}',
    system_prompt: 'SYS CONTENT',
  });
  assert.match(tpl, /Hello \{\{risu_user\}\}\. SYS CONTENT/);
  assert.ok(!tpl.includes('{{system}}'));
  assert.ok(!tpl.includes('{{#if system}}'));
  assert.ok(!tpl.includes('{{unresolved}}'));
});

test('story_string_prefix 附着 story_string 且 {{name}}->System;无 story_string 时不输出', () => {
  const withPrefix = buildJinjaTemplate({
    ...alpaca,
    story_string: 'CHAR: {{char}}',
    story_string_prefix: '### System: {{name}}',
    story_string_suffix: '[end]',
  });
  assert.ok(withPrefix.includes('### System: System'));
  assert.ok(withPrefix.includes('CHAR: '));
  assert.ok(!withPrefix.includes('{{char}}')); // ST 宏由官方算法清除(残留花括号),改由 promptTemplate 卡注入
  assert.ok(withPrefix.includes('[end]'));

  const noStory = buildJinjaTemplate({ ...alpaca, story_string_prefix: '### System:' });
  assert.ok(!noStory.includes('### System:'));
});

test('mapInstruct 兼容顶层直放与 {instruct:{...}} 嵌套', () => {
  const flat = mapInstruct(alpaca);
  assert.equal(flat.instructChatTemplate, 'jinja');
  assert.equal(flat.useInstructPrompt, true);
  assert.ok(flat.JinjaTemplate.includes('{% for message in messages %}'));

  const nested = mapInstruct({ instruct: alpaca, name: 'x' });
  assert.ok(nested.JinjaTemplate.includes('### Instruction:'));
  assert.equal(nested.JinjaTemplate, flat.JinjaTemplate);

  const empty = mapInstruct({});
  // 空 instruct:序列全为空串,但循环骨架完整(角色序列都是空包裹)
  assert.ok(empty.JinjaTemplate.includes('{% for message in messages %}'));
  assert.ok(empty.JinjaTemplate.includes('{% endfor %}'));
  assert.ok(!empty.JinjaTemplate.includes('### Instruction:'));
});

test('looksLikeInstruct 仅认含序列字段的对象', () => {
  assert.equal(looksLikeInstruct(alpaca), true);
  assert.equal(looksLikeInstruct({ instruct: alpaca }), false); // 嵌套不是 instruct 本体
  assert.equal(looksLikeInstruct(null), false);
  assert.equal(looksLikeInstruct([]), false);
  assert.equal(looksLikeInstruct({ name: 'x' }), false);
});

test('convert --instruct: 产物带 instruct 三件套 + 报告 converted', () => {
  const { preset, report } = convert(fixture, { source: 'minimal-st.json', instruct: alpaca });
  assert.equal(preset.useInstructPrompt, true);
  assert.equal(preset.instructChatTemplate, 'jinja');
  assert.ok((preset.JinjaTemplate as string).includes('### Instruction:'));
  const e = report.sections.topLevel.find((x) => x.field === 'instruct');
  assert.ok(e);
  assert.equal(e.action, 'converted');
  assert.match(e.reason as string, /JinjaTemplate\(\d+ 字符\)/);
});

test('convert 顶层 instruct 块自动识别(不需显式参数)', () => {
  const { preset, report } = convert({ ...fixture, instruct: alpaca });
  assert.equal(preset.useInstructPrompt, true);
  assert.ok((preset.JinjaTemplate as string).includes('### Instruction:'));
  assert.ok(report.sections.topLevel.some((x) => x.field === 'instruct'));
});

test('convert 无 instruct 时产物不含 instruct 三件套', () => {
  const { preset } = convert(fixture);
  assert.ok(!('useInstructPrompt' in preset));
  assert.ok(!('instructChatTemplate' in preset));
  assert.ok(!('JinjaTemplate' in preset));
});
