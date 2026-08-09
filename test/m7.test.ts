// M7: 产物校验器测试 —— 验证校验器能复刻 Risu 导入消费点、抓出真实缺陷。
// 依据:Risu templateCheck.ts(8 条警告)、util.ts:1049 parseToggleSyntax、
// prompt.ts PromptItem 类型。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAll, validatePreset, validateModule } from '../src/validate.js';
import type { RisuPreset } from '../src/types.js';

// —— 合法产物:通过所有校验 ——
function okPreset(): RisuPreset {
  return {
    temperature: 80,
    frequencyPenalty: 70,
    PresensePenalty: 0,
    top_p: 1,
    top_k: 0,
    top_a: 0,
    min_p: 0,
    repetition_penalty: 1,
    maxContext: 4000,
    maxResponse: 300,
    promptTemplate: [
      { type: 'plain', type2: 'main', text: 'You are {{char}}', role: 'system' },
      { type: 'description' },
      { type: 'persona' },
      { type: 'lorebook' },
      { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
      { type: 'plain', type2: 'globalNote', text: '', role: 'system' },
    ],
    regex: [{ type: 'editoutput', ableFlag: true, flag: 'g<order 1>', in: 'x', out: 'y', comment: '[s]' }],
    customPromptTemplateToggle: 'tone=语气=select=dark,light\nlabel=标题=caption=标题\n',
  };
}

test('合法产物通过所有校验(无 error/warning)', () => {
  const r = validatePreset(okPreset());
  assert.equal(r.ok, true);
  assert.equal(r.issues.filter((i) => i.severity !== 'info').length, 0);
});

test('缺 main/globalNote/description/lorebook/chat-end 时报告 templateCheck 警告', () => {
  const p = okPreset();
  p.promptTemplate = [{ type: 'plain', type2: 'normal', text: 'x', role: 'system' }]; // 全缺
  const r = validatePreset(p);
  const codes = r.issues.map((i) => i.code);
  assert.ok(codes.includes('NO_MAIN'));
  assert.ok(codes.includes('NO_NOTE'));
  assert.ok(codes.includes('NO_DESCRIPTION'));
  assert.ok(codes.includes('NO_LOREBOOK'));
  assert.ok(codes.includes('NO_CHAT_END'));
  // 缺 main 等是 warning,不是 error(用户主动关闭 main 时合法)
  assert.equal(r.ok, true);
});

test('未知卡类型 -> error', () => {
  const p = okPreset();
  (p.promptTemplate[0] as any).type = 'bogus';
  const r = validatePreset(p);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'CARD_TYPE_INVALID'));
});

test('plain 卡缺 type2 -> error', () => {
  const p = okPreset();
  delete (p.promptTemplate[0] as any).type2;
  const r = validatePreset(p);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'PLAIN_TYPE2_INVALID'));
});

test('多张 main 卡 -> MULTI_MAIN 警告', () => {
  const p = okPreset();
  p.promptTemplate.push({ type: 'plain', type2: 'main', text: 'second', role: 'system' });
  const r = validatePreset(p);
  assert.ok(r.issues.some((i) => i.code === 'MULTI_MAIN'));
});

test('toggle 行无法解析 -> TOGGLE_PARSE_FAIL error', () => {
  const p = okPreset();
  p.customPromptTemplateToggle = 'this-line-has-no-equals';
  const r = validatePreset(p);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'TOGGLE_PARSE_FAIL'));
});

test('toggle key 含 = 或 , -> TOGGLE_KEY_INVALID error', () => {
  const p = okPreset();
  // key 'bad,key' 含 ',' → parseToggleSyntax 用 '=' 切,key 段本身含非法字符
  p.customPromptTemplateToggle = 'bad,key=label=select=a,b\n';
  const r = validatePreset(p);
  assert.ok(r.issues.some((i) => i.code === 'TOGGLE_KEY_INVALID'));
});

test('消费点引用未定义的 toggle -> TOGGLE_REF_UNDEFINED error', () => {
  const p = okPreset();
  (p.promptTemplate[0] as any).text = '{{#if {{? {{getglobalvar::toggle_ghost}}==0}}}}x{{/if}}';
  const r = validatePreset(p);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'TOGGLE_REF_UNDEFINED'));
});

test('单选项 select -> info(不阻塞),非 error', () => {
  const p = okPreset();
  p.customPromptTemplateToggle = 'solo=单选项=select=only\n';
  const r = validatePreset(p);
  assert.equal(r.ok, true);
  assert.ok(r.issues.some((i) => i.code === 'TOGGLE_SELECT_SINGLE' && i.severity === 'info'));
});

test('regex 缺 in(disabled 除外)-> REGEX_IN_MISSING error', () => {
  const p = okPreset();
  p.regex.push({ type: 'editoutput', ableFlag: true, flag: 'g', out: 'y' } as any);
  const r = validatePreset(p);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'REGEX_IN_MISSING'));
  // disabled 类型允许无 in
  const p2 = okPreset();
  p2.regex.push({ type: 'disabled', ableFlag: true, flag: 'g', out: 'y' } as any);
  assert.equal(validatePreset(p2).ok, true);
});

test('module:非法 trigger type / 空 effect -> error;合法模块通过', () => {
  const ok = validateModule({ type: 'risuModule', name: 'm', trigger: [{ type: 'start', conditions: [], effect: [{ setvar: 'x' }] }] });
  assert.equal(ok.ok, true);
  const badType = validateModule({ type: 'risuModule', name: 'm', trigger: [{ type: 'bogus', conditions: [], effect: [] }] });
  assert.equal(badType.ok, false);
  assert.ok(badType.issues.some((i) => i.code === 'TRIGGER_TYPE_INVALID'));
  const noEffect = validateModule({ type: 'risuModule', name: 'm', trigger: [{ type: 'start', conditions: [] }] });
  assert.equal(noEffect.ok, false);
  assert.ok(noEffect.issues.some((i) => i.code === 'TRIGGER_NO_EFFECT'));
});

test('validateAll:preset error + module error 合并', () => {
  const p = okPreset();
  (p.promptTemplate[0] as any).type = 'bogus';
  const r = validateAll(p, { type: 'risuModule', trigger: [{ type: 'bad' }] });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'CARD_TYPE_INVALID'));
  assert.ok(r.issues.some((i) => i.code === 'TRIGGER_TYPE_INVALID'));
});
