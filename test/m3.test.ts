import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { translateMacros } from '../src/macroTable.js';
import { wrapDepthGuard, swallowTrailingNewline } from '../src/depthGuard.js';
import { mapRegexes } from '../src/mapRegexes.js';
import { mapPrompts } from '../src/mapPrompts.js';
import { createReport } from '../src/report.js';
import { parseST } from '../src/ir.js';
import type { RegexScript, TavernPreset } from '../src/types.js';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test', 'fixtures', 'minimal-st.json'), 'utf8'),
) as TavernPreset;

const base: RegexScript = {
  scriptName: 's',
  findRegex: '/x/g',
  replaceString: 'y',
  trimStrings: [],
  placement: [2],
  markdownOnly: false,
  promptOnly: false,
  runOnEdit: true,
  substituteRegex: 0,
  disabled: false,
};

function runRegex(scripts: RegexScript[]) {
  const report = createReport('t');
  const out = mapRegexes(scripts, report);
  return { out, report };
}

// ---------- depthGuard ----------

test('depthGuard: min=11 max=50 -> AND(GE last-50, LE last-11),GE 在前', () => {
  const out = wrapDepthGuard('$&', 11, 50);
  assert.equal(
    out,
    '{{#if {{and::{{greaterequal::{{chatindex}}::{{? {{lastmessageid}}-50}}}}::{{lessequal::{{chatindex}}::{{? {{lastmessageid}}-11}}}}}}}}$&{{/if}}',
  );
});

test('depthGuard: 仅 min=51 -> 只有 LE(无 and)', () => {
  const out = wrapDepthGuard('$&', 51, null);
  assert.ok(!out.includes('{{and::'));
  assert.match(out, /\{\{lessequal::\{\{chatindex\}\}::\{\{\? \{\{lastmessageid\}\}-51\}\}\}/);
  assert.ok(!out.includes('greaterequal'));
});

test('depthGuard: 仅 max=5 -> 只有 GE(无 and)', () => {
  const out = wrapDepthGuard('$&', 0, 5);
  assert.ok(!out.includes('{{and::'));
  assert.match(out, /\{\{greaterequal::\{\{chatindex\}\}::\{\{\? \{\{lastmessageid\}\}-5\}\}\}/);
  assert.ok(!out.includes('lessequal'));
});

test('depthGuard: min=0 max=null -> 无守卫', () => {
  assert.equal(wrapDepthGuard('$&', 0, null), '$&');
});

test('swallowTrailingNewline: 追加 [\\s\\S]*、去 $、幂等', () => {
  assert.equal(swallowTrailingNewline('abc'), 'abc[\\s\\S]*');
  assert.equal(swallowTrailingNewline('abc[\\s\\S]*'), 'abc[\\s\\S]*');
  assert.equal(swallowTrailingNewline('abc$'), 'abc[\\s\\S]*');
});

test('mapRegexes: 深度脚本 -> 精确守卫 + <cbs> + in 吞换行 + 边界报告', () => {
  const { out, report } = runRegex([{ ...base, minDepth: 11, maxDepth: 50 }]);
  assert.equal(out.length, 1);
  assert.equal(
    out[0].out,
    '{{#if {{and::{{greaterequal::{{chatindex}}::{{? {{lastmessageid}}-50}}}}::{{lessequal::{{chatindex}}::{{? {{lastmessageid}}-11}}}}}}}}y{{/if}}',
  );
  assert.match(out[0].flag, /<cbs>/);
  assert.equal(out[0].in, 'x[\\s\\S]*');
  const depth = report.sections.regex.find((e) => e.fields?.includes('minDepth'));
  assert.ok(depth);
  assert.equal(depth.action, 'degraded');
  assert.match(depth.reason, /chatindex/);
});

test('mapRegexes: minDepth=0/maxDepth=null(无过滤)不触发深度分支', () => {
  const { out, report } = runRegex([{ ...base, minDepth: 0, maxDepth: null }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].out, 'y');
  assert.equal(out[0].in, 'x'); // in 不被吞换行
  assert.ok(!out[0].flag.includes('<cbs>'));
  assert.ok(!report.sections.regex.some((e) => e.fields?.includes('minDepth')));
});

// ---------- macroTable ----------

test('macros A 直通: 不变且不报告', () => {
  const report = createReport('t');
  const text = '{{char}} {{user}} {{setvar::Erde:: }} {{getvar::X}} {{//注}}';
  assert.equal(translateMacros(text, report), text);
  assert.equal(report.sections.macros.length, 0);
});

test('macros C 改写: 无参', () => {
  const report = createReport('t');
  const out = translateMacros(
    '{{charPrompt}}|{{charInstruction}}|{{mesExamplesRaw}}|{{weekday}}|{{incvar}}|{{decvar}}|{{newline}}|{{noop}}',
    report,
  );
  assert.equal(
    out,
    '{{mainprompt}}|{{jb}}|{{exampledialogue}}|{{date::dddd}}|{{addvar::n::1}}|{{addvar::n::-1}}|{{br}}|{{blank}}',
  );
  assert.ok(report.sections.macros.every((e) => e.action === 'rewritten'));
});

test('macros C 带参翻译', () => {
  const out = translateMacros('{{datetimeformat::YYYY-MM}} {{hasExtension::foo}}', createReport('t'));
  assert.equal(out, '{{date::YYYY-MM}} {{moduleenabled::foo}}');
});

test('macros random 空格语法 -> :: 形式;带参 :: 直通不报', () => {
  const report = createReport('t');
  assert.equal(translateMacros('{{random 3,7}}', report), '{{random::3::7}}');
  assert.equal(report.sections.macros.length, 1);
  assert.equal(translateMacros('{{random::3::7}}', report), '{{random::3::7}}'); // A 直通
  assert.equal(report.sections.macros.length, 1);
});

test('mapPrompts: prefill 卡 innerFormat 也过宏翻译', () => {
  const report = createReport('t');
  const ir = parseST({ ...fixture, assistant_prefill: 'continue {{charPrompt}} {{newline}}' });
  const cards = mapPrompts(ir, report);
  const post = cards.find((c) => c.type === 'postEverything');
  assert.ok(post);
  const fmt = post.innerFormat as string;
  assert.ok(fmt.startsWith('{{#if {{prefill_supported}}}}'), fmt);
  assert.ok(fmt.includes('continue {{mainprompt}} {{br}}'), fmt);
  assert.ok(fmt.endsWith('{{/if}}'), fmt);
  assert.ok(report.sections.macros.some((e) => e.action === 'rewritten'));
});

test('macros B 同名不同义: 保留原名 + kept 报告', () => {
  const report = createReport('t');
  assert.equal(translateMacros('{{time}} {{date}}', report), '{{time}} {{date}}');
  assert.ok(report.sections.macros.some((e) => e.action === 'kept' && /同名不同义/.test(e.reason)));
});

test('macros D 未知宏: 透传 + kept-unknown 报告', () => {
  const report = createReport('t');
  assert.equal(translateMacros('{{someUnknownMacro}}', report), '{{someUnknownMacro}}');
  assert.ok(report.sections.macros.some((e) => e.action === 'kept-unknown'));
});

test('macros 控制结构跳过: {{#if}}/{{/if}}/{{//}} 不动不报', () => {
  const report = createReport('t');
  const text = '{{#if x}}a{{/if}}';
  assert.equal(translateMacros(text, report), text);
  assert.equal(report.sections.macros.length, 0);
});

test('macros 嵌套 {{setvar::X::{{char}}}} 原样', () => {
  const text = '{{setvar::X::{{char}}}}';
  assert.equal(translateMacros(text, createReport('t')), text);
});

test('macros {{data}} 直通不报(深度/匹配宏)', () => {
  const report = createReport('t');
  assert.equal(translateMacros('{{data}} {{chatindex}} {{lastmessageid}}', report), '{{data}} {{chatindex}} {{lastmessageid}}');
  assert.equal(report.sections.macros.length, 0);
});

test('macros {{setglobalvar}} -> manual 报告(Risu 无此宏,初始化失效)', () => {
  const report = createReport('t');
  const text = '{{setglobalvar::sleep_var_x::值}}';
  assert.equal(translateMacros(text, report), text);
  const entry = report.sections.macros.find((e) => e.action === 'manual' && e.macro === text);
  assert.ok(entry);
  assert.match(entry.reason, /无 setglobalvar 宏/);
});

test('mapRegexes: replaceString 宏翻译({{charPrompt}} -> {{mainprompt}})', () => {
  const { out, report } = runRegex([{ ...base, replaceString: '{{charPrompt}} {{match}}' }]);
  assert.equal(out[0].out, '{{mainprompt}} {{data}}');
  assert.ok(report.sections.macros.some((e) => e.action === 'rewritten'));
});

test('mapRegexes: substituteRegex=1 时 in 宏翻译', () => {
  const { out } = runRegex([{ ...base, substituteRegex: 1, findRegex: '/{{char}}/g' }]);
  assert.equal(out[0].in, '{{char}}'); // char 为 A 直通
  assert.match(out[0].flag, /<cbs>/);
});

// ---------- mapPrompts 集成 ----------

test('mapPrompts: 卡文本宏翻译({{charInstruction}} -> {{jb}}, {{newline}} -> {{br}})', () => {
  const report = createReport('t');
  const ir = parseST({
    ...fixture,
    prompts: [
      ...(fixture.prompts ?? []),
      { identifier: 'main', name: 'Main', role: 'system', content: '{{charInstruction}} Hi {{newline}} {{char}}' },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  });
  const cards = mapPrompts(ir, report);
  const main = cards.find((c) => c.type2 === 'main');
  assert.ok(main);
  assert.equal(main.text, '{{jb}} Hi {{br}} {{char}}');
});

test('mapPrompts: 深度守卫自生成宏(A 类)不产生 macros 报告', () => {
  const report = createReport('t');
  const ir = parseST({
    ...fixture,
    assistant_prefill: 'continue {{data}}',
  });
  mapPrompts(ir, report);
  assert.equal(report.sections.macros.length, 0);
});
