import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapRegexes } from '../src/mapRegexes.js';
import { createReport } from '../src/report.js';
import type { RegexScript } from '../src/types.js';

const base: RegexScript = {
  id: 'ignore-me',
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

function run(scripts: RegexScript[]) {
  const report = createReport('t');
  const out = mapRegexes(scripts, report);
  return { out, report };
}

test('三分法: markdownOnly -> editdisplay', () => {
  const { out } = run([{ ...base, markdownOnly: true }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'editdisplay');
  assert.equal(out[0].ableFlag, true);
  assert.equal(out[0].in, 'x');
  assert.equal(out[0].out, 'y');
  assert.equal(out[0].comment, '[s]');
});

test('三分法: promptOnly -> editprocess', () => {
  const { out } = run([{ ...base, promptOnly: true }]);
  assert.equal(out[0].type, 'editprocess');
});

test('三分法: 默认路径 -> editoutput', () => {
  const { out } = run([{ ...base }]);
  assert.equal(out[0].type, 'editoutput');
});

test('三分法: 双开 (markdownOnly && promptOnly) 拆成两个脚本,同 order', () => {
  const { out } = run([{ ...base, markdownOnly: true, promptOnly: true }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.type), ['editprocess', 'editdisplay']);
  assert.equal(out[0].flag.includes('<order 1>'), true);
  assert.equal(out[1].flag.includes('<order 1>'), true);
  assert.equal(out[0].comment, '[s (editprocess)]');
  assert.equal(out[1].comment, '[s (editdisplay)]');
});

test('placement 仅 USER_INPUT(1) -> editinput', () => {
  const { out } = run([{ ...base, placement: [1] }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'editinput');
});

test('placement [1,2] -> 主类型 + editinput', () => {
  const { out } = run([{ ...base, placement: [1, 2], markdownOnly: true }]);
  assert.deepEqual(out.map((s) => s.type).sort(), ['editdisplay', 'editinput']);
});

test('substituteRegex=1 -> flag 含 <cbs>, ableFlag=true', () => {
  const { out } = run([{ ...base, substituteRegex: 1 }]);
  assert.match(out[0].flag, /<cbs>/);
  assert.equal(out[0].ableFlag, true);
});

test('replaceString 尾部 > -> 去掉 > 且 flag 含 <no_end_nl>', () => {
  const { out } = run([{ ...base, replaceString: 'y>' }]);
  assert.equal(out[0].out, 'y');
  assert.match(out[0].flag, /<no_end_nl>/);
});

test('disabled -> type=disabled 保留脚本(内容在,永不执行,可重新启用)', () => {
  const { out, report } = run([{ ...base, disabled: true }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'disabled');
  assert.equal(out[0].in, 'x');
  assert.equal(out[0].out, 'y');
  assert.ok(report.sections.regex.some((e) => e.action === 'converted' && e.type === 'disabled'));
});

test('placement SLASH_COMMAND(3) -> dropped', () => {
  const { out, report } = run([{ ...base, placement: [3] }]);
  assert.equal(out.length, 0);
  assert.equal(report.sections.regex[0].action, 'dropped');
});

test('placement REASONING(6) -> dropped', () => {
  const { out, report } = run([{ ...base, placement: [6] }]);
  assert.equal(out.length, 0);
  assert.equal(report.sections.regex[0].action, 'dropped');
});

test('placement WORLD_INFO(5) 单独 -> degraded,无脚本;与 [5,2] -> 仍转换', () => {
  const { out: out1, report: r1 } = run([{ ...base, placement: [5] }]);
  assert.equal(out1.length, 0);
  assert.equal(r1.sections.regex.some((e) => e.action === 'degraded'), true);

  const { out: out2 } = run([{ ...base, placement: [5, 2] }]);
  assert.equal(out2.length, 1);
  assert.equal(out2[0].type, 'editoutput');
});

test('trimStrings 非空 -> degraded 报告', () => {
  const { out, report } = run([{ ...base, trimStrings: ['<', '>'] }]);
  assert.equal(out.length, 1); // 主体仍转换
  assert.equal(report.sections.regex.some((e) => e.action === 'degraded' && e.fields?.includes('trimStrings')), true);
});

test('runOnEdit=false -> degraded 报告', () => {
  const { report } = run([{ ...base, runOnEdit: false }]);
  assert.equal(report.sections.regex.some((e) => e.action === 'degraded' && e.fields?.includes('runOnEdit')), true);
});

test('minDepth/maxDepth -> degraded(M3),主体仍转换', () => {
  const { out, report } = run([{ ...base, minDepth: 11, maxDepth: 50 }]);
  assert.equal(out.length, 1);
  assert.equal(report.sections.regex.some((e) => e.action === 'degraded' && e.fields?.includes('minDepth')), true);
});

test('substituteRegex=2 -> manual 报告', () => {
  const { out, report } = run([{ ...base, substituteRegex: 2 }]);
  assert.equal(out.length, 1);
  assert.equal(report.sections.regex.some((e) => e.action === 'manual' && e.fields?.includes('substituteRegex')), true);
});

test('parseFindRegex: /a/b/c/g -> pattern a/b/c, flags g', () => {
  const { out } = run([{ ...base, findRegex: '/a/b/c/g' }]);
  assert.equal(out[0].in, 'a/b/c');
  assert.match(out[0].flag, /g/);
});

test('findRegex 纯 pattern 无尾 flag -> 原样,flag 默认 g', () => {
  const { out } = run([{ ...base, findRegex: 'foo bar' }]);
  assert.equal(out[0].in, 'foo bar');
  assert.equal(out[0].flag, 'g<order 1>');
});

test('不支持的正则 flag 剔除并报告(如 x/A)', () => {
  const { out, report } = run([{ ...base, findRegex: '/x/gx' }]);
  assert.equal(out[0].flag, 'g<order 1>'); // x 被剔除
  assert.equal(report.sections.regex.some((e) => e.action === 'degraded' && /'x'/.test(e.reason)), true);
});

test('顺序: 先执行者获更大 order(降序)', () => {
  const { out } = run([
    { ...base, scriptName: 'a', findRegex: '/1/g' },
    { ...base, scriptName: 'b', findRegex: '/2/g' },
    { ...base, scriptName: 'c', findRegex: '/3/g' },
  ]);
  assert.match(out[0].flag, /<order 3>/);
  assert.match(out[1].flag, /<order 2>/);
  assert.match(out[2].flag, /<order 1>/);
});

test('flag 内容组装: 正则 flag + <cbs> + <no_end_nl> + <order>', () => {
  const { out } = run([{ ...base, findRegex: '/x/gim', replaceString: 'y>', substituteRegex: 1 }]);
  const flag = out[0].flag;
  assert.match(flag, /g/);
  assert.match(flag, /i/);
  assert.match(flag, /m/);
  assert.match(flag, /<cbs>/);
  assert.match(flag, /<no_end_nl>/);
  assert.match(flag, /<order 1>/);
  assert.equal(out[0].ableFlag, true);
});

test('空脚本数组 -> 空输出,无报告', () => {
  const { out, report } = run([]);
  assert.equal(out.length, 0);
  assert.equal(report.sections.regex.length, 0);
});

test('findRegex 为空 -> manual 报告', () => {
  const { out, report } = run([{ ...base, findRegex: '' }]);
  assert.equal(out.length, 0); // 丢弃,避免 Risu 空 pattern 匹配一切文本
  assert.equal(report.sections.regex.some((e) => e.action === 'manual' && e.fields?.includes('findRegex')), true);
});

test('placement [1,2] + 双开 -> 3 个脚本 editprocess/editdisplay/editinput', () => {
  const { out } = run([{ ...base, placement: [1, 2], markdownOnly: true, promptOnly: true }]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((s) => s.type).sort(), ['editdisplay', 'editinput', 'editprocess']);
  assert.equal(out[0].flag.includes('<order 1>'), true);
});

test('白名单 flag d/s/u/v/y 保留在 flag 输出', () => {
  const { out } = run([{ ...base, findRegex: '/x/dsuvy' }]);
  for (const f of ['d', 's', 'u', 'v', 'y']) {
    assert.ok(out[0].flag.includes(f), `flag '${f}' 应保留`);
  }
});

test('placement [1] 的三分法变体仍 -> editinput', () => {
  for (const variant of [
    { markdownOnly: true, promptOnly: false },
    { markdownOnly: false, promptOnly: true },
    { markdownOnly: false, promptOnly: false },
  ]) {
    const { out } = run([{ ...base, placement: [1], ...variant }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, 'editinput');
  }
});

test('replaceString {{match}} -> out {{data}}(整 token 替换)', () => {
  const { out } = run([{ ...base, replaceString: '{{match}}X{{match_foo}}' }]);
  assert.equal(out[0].out, '{{data}}X{{match_foo}}');
});
