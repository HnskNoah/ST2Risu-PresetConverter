import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseST, normalizeRole } from '../src/ir.js';
import { mapFields } from '../src/mapFields.js';
import { mapPrompts } from '../src/mapPrompts.js';
import { createReport } from '../src/report.js';
import { convert } from '../src/index.js';
import type { TavernPreset } from '../src/types.js';

// cwd 是项目根(npm test 在此运行),dist/test 与 test 均可解析
const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test', 'fixtures', 'minimal-st.json'), 'utf8'),
) as TavernPreset;

test('parseST recognizes an ST preset', () => {
  const ir = parseST(fixture);
  assert.equal(ir.prompts.length, 7);
  assert.equal(ir.regexScripts.length, 1);
  assert.equal(ir.promptOrder[0].character_id, 100001);
  assert.equal(ir.formats.scenarioFormat, undefined);
});

test('parseST rejects non-ST json', () => {
  assert.throws(() => parseST({ name: 'x' }), /Not a SillyTavern preset/);
});

test('normalizeRole maps assistant/char -> bot', () => {
  assert.equal(normalizeRole('assistant'), 'bot');
  assert.equal(normalizeRole('char'), 'bot');
  assert.equal(normalizeRole('user'), 'user');
  assert.equal(normalizeRole('system'), 'system');
  assert.equal(normalizeRole(undefined), 'system');
});

test('mapPrompts passes ST prompt name through to cards', () => {
  const report = createReport('t');
  const { cards } = mapPrompts(parseST(fixture), report);
  assert.equal((cards.find((c) => c.type2 === 'main') as any).name, 'Main');
  assert.equal((cards.find((c) => c.type === 'chat') as any).name, 'Chat History');
  assert.equal((cards.find((c) => c.text === '{{personality}}') as any).name, 'Personality');
  assert.equal((cards.find((c) => c.type === 'description') as any).name, 'Description');
  // templateCheck 要求恰好 1 张 globalNote 卡(mapPrompts 自动补空卡)
  const gn = cards.filter((c) => c.type2 === 'globalNote');
  assert.equal(gn.length, 1);
  assert.equal(gn[0].type, 'plain');
  assert.equal(gn[0].text, '');
});

test('mapPrompts extracts setvar macros into triggers and strips them from card text', () => {
  const report = createReport('t');
  const ir = parseST({
    ...fixture,
    prompts: [
      ...(fixture.prompts ?? []),
      { identifier: 'init', name: 'Init', role: 'system', content: '{{setvar::foo::1}}{{setvar::bar::x}}' },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [{ identifier: 'init', enabled: true }, ...(fixture.prompt_order?.[0]?.order ?? [])],
      },
    ],
  });
  const { cards, setvars } = mapPrompts(ir, report);
  const card = cards.find((c) => c.type === 'plain' && c.name === 'Init');
  assert.ok(card);
  assert.equal(String(card.text).includes('{{setvar::'), false);
  assert.equal(setvars.length, 2);
  assert.deepEqual(
    setvars.map((s) => ({ name: s.name, operator: s.operator, value: s.value })),
    [
      { name: 'foo', operator: '=', value: '1' },
      { name: 'bar', operator: '=', value: 'x' },
    ],
  );
  const entry = report.sections.macros.find((e) => e.action === 'converted' && e.reason?.includes('setvar'));
  assert.ok(entry);
  assert.match(entry.reason as string, /foo/);
  assert.match(entry.reason as string, /bar/);
});

test('mapFields converts samplers with x100 and drops unsupported', () => {
  const report = createReport('t');
  const out = mapFields(fixture, report);
  assert.equal(out.temperature, 100);
  assert.equal(out.frequencyPenalty, 30);
  assert.equal(out.PresensePenalty, 50);
  assert.equal(out.top_p, 1);
  assert.equal(out.repetition_penalty, 1.1);
  assert.equal(out.maxContext, 8192);
  assert.equal(out.maxResponse, 512);
  assert.equal(out.name, 'minimal');

  const dropped = report.sections.topLevel.filter((e) => e.action === 'dropped');
  const droppedFields = dropped.map((e) => e.field as string);
  assert.ok(droppedFields.includes('seed'));
  assert.ok(droppedFields.includes('stream_openai'));

  const biasEntry = report.sections.topLevel.find((e) => e.field === 'bias_preset_selected');
  assert.ok(biasEntry);
  assert.equal(biasEntry.action, 'manual');
});

test('mapFields presence_penalty missing -> 0 (decision)', () => {
  const report = createReport('t');
  const { presence_penalty: _presence_penalty, ...noPresence } = fixture;
  const out = mapFields(noPresence, report);
  assert.equal(out.PresensePenalty, 0);
});

test('mapPrompts applies identifier mapping and decisions', () => {
  const report = createReport('t');
  const ir = parseST(fixture);
  const { cards } = mapPrompts(ir, report);

  const main = cards.find((c) => c.type2 === 'main');
  assert.ok(main);
  assert.equal(main.type, 'plain');
  assert.equal(main.role, 'system');

  const description = cards.find((c) => c.type === 'description');
  assert.ok(description);
  assert.match(description.innerFormat as string, /\{\{scenario\}\}/); // scenario merged in

  assert.ok(cards.some((c) => c.type === 'chat' && c.rangeEnd === 'end'));

  // worldInfoAfter degraded plain, placed before the prefill block
  const wi = cards.find((c) => c.text === '{{wiAfter}}');
  assert.ok(wi);
  assert.equal(wi.type, 'plain');
  const postEverythingIdx = cards.findIndex((c) => c.type === 'postEverything');
  assert.ok(cards.indexOf(wi) < postEverythingIdx);

  // charPersonality degraded plain
  const personality = cards.find((c) => c.text === '{{personality}}');
  assert.ok(personality);
  assert.equal(personality.type, 'plain');

  // assistant_prefill 存在时模板仍必须恰好一张 type2==='main' 卡
  const mainCards = cards.filter((c) => c.type2 === 'main');
  assert.equal(mainCards.length, 1);
  // assistant_prefill -> postEverything 卡的 innerFormat(官方模板,不另生 main 卡)
  const post = cards.find((c) => c.type === 'postEverything');
  assert.ok(post);
  assert.match(post.innerFormat as string, /continue/); // prefill 文本保留
  assert.match(post.innerFormat as string, /prefill_supported/);

  const degraded = report.sections.prompts.filter((e) => e.action === 'degraded').map((e) => e.identifier as string);
  assert.ok(degraded.includes('scenario'));
  assert.ok(degraded.includes('charPersonality'));
  assert.ok(degraded.includes('worldInfoAfter'));
});

test('disabled prompts are skipped and reported as dropped', () => {
  const report = createReport('t');
  const ir = parseST(fixture);
  const { cards } = mapPrompts(ir, report);
  assert.ok(!cards.some((c) => c.text === 'be nice')); // jailbreak disabled
  const dropped = report.sections.prompts.filter((e) => e.action === 'dropped' && e.identifier === 'jailbreak');
  assert.equal(dropped.length, 1);
  assert.ok(dropped[0].fields?.includes('enabled'));
});

test('mapFields reports behavior strings / reasoning params / platform switches', () => {
  const report = createReport('t');
  const top = {
    ...fixture,
    impersonation_prompt: 'reply as {{char}}',
    continue_prefill: true,
    show_thoughts: true,
    wrap_in_quotes: true,
    image_inlining: true,
    function_calling: true,
  };
  mapFields(top, report);

  const manualFields = report.sections.topLevel.filter((e) => e.action === 'manual').map((e) => e.field as string);
  assert.ok(manualFields.includes('impersonation_prompt'));
  assert.ok(manualFields.includes('continue_prefill'));
  assert.ok(manualFields.includes('show_thoughts'));

  const droppedFields = report.sections.topLevel.filter((e) => e.action === 'dropped').map((e) => e.field as string);
  assert.ok(droppedFields.includes('wrap_in_quotes'));
  assert.ok(droppedFields.includes('image_inlining'));
  assert.ok(droppedFields.includes('function_calling'));
});

test('mapFields maps reasoning_effort low/medium/high -> reasonEffort 0/1/2', () => {
  for (const [st, risu] of [
    ['low', 0],
    ['medium', 1],
    ['high', 2],
    ['HIGH', 2],
    [2, 2],
  ] as const) {
    const report = createReport('t');
    const out = mapFields({ ...fixture, reasoning_effort: st } as any, report);
    assert.equal(out.reasonEffort, risu, `reasoning_effort=${st}`);
    assert.ok(report.sections.topLevel.some((e) => e.action === 'converted' && e.field === 'reasoning_effort'));
  }
});

test('mapFields: continue_postfix -> promptSettings.postEndInnerFormat(degraded)', () => {
  const report = createReport('t');
  const out = mapFields({ ...fixture, continue_postfix: ' [end] ' } as any, report);
  assert.equal(out.promptSettings?.postEndInnerFormat, ' [end] ');
  const e = report.sections.topLevel.find((x) => x.field === 'continue_postfix');
  assert.ok(e);
  assert.equal(e.action, 'degraded');
  assert.match(e.reason as string, /postEndInnerFormat/);
});

test('mapFields: continue_nudge/impersonation/continue_prefill 有值 manual 带语义理由;空行为字段不报噪音', () => {
  const report = createReport('t');
  const out = mapFields(
    {
      ...fixture,
      impersonation_prompt: 'you are {{user}}',
      continue_nudge_prompt: 'continue here',
      continue_prefill: true,
      new_chat_prompt: '', // 空值应忽略
      send_if_empty: '', // 空值应忽略
    } as any,
    report,
  );
  const manual = report.sections.topLevel.filter((e) => e.action === 'manual').map((e) => e.field as string);
  assert.ok(manual.includes('impersonation_prompt'));
  assert.ok(manual.includes('continue_nudge_prompt'));
  assert.ok(manual.includes('continue_prefill'));
  // 空值字段不产生报告
  assert.ok(!manual.includes('new_chat_prompt'));
  assert.ok(!manual.includes('send_if_empty'));
  // manual 理由不再是笼统待调研
  const nudge = report.sections.topLevel.find((e) => e.field === 'continue_nudge_prompt');
  assert.ok(!(nudge?.reason as string).includes('待调研'));
  assert.ok(out.promptSettings === undefined);
});

test('mapFields reasoning_effort auto -> manual,不写入', () => {
  const report = createReport('t');
  const out = mapFields({ ...fixture, reasoning_effort: 'auto' } as any, report);
  assert.ok(!('reasonEffort' in out));
  assert.ok(report.sections.topLevel.some((e) => e.action === 'manual' && e.field === 'reasoning_effort'));
});

test('mapFields maps verbosity low/medium/high/auto -> 0/1/2', () => {
  for (const [st, risu] of [
    ['low', 0],
    ['medium', 1],
    ['high', 2],
    ['HIGH', 2],
    ['auto', 1],
  ] as const) {
    const report = createReport('t');
    const out = mapFields({ ...fixture, verbosity: st } as any, report);
    assert.equal(out.verbosity, risu, `verbosity=${st}`);
    assert.ok(report.sections.topLevel.some((e) => e.action === 'converted' && e.field === 'verbosity'));
  }
});

test('mapFields verbosity 非法值 -> manual,不写入', () => {
  const report = createReport('t');
  const out = mapFields({ ...fixture, verbosity: 'ultra' } as any, report);
  assert.ok(!('verbosity' in out));
  assert.ok(report.sections.topLevel.some((e) => e.action === 'manual' && e.field === 'verbosity'));
});

test('mapFields reports extensions plugin sub-keys (except regex_scripts)', () => {
  const report = createReport('t');
  const top = {
    ...fixture,
    extensions: { regex_scripts: [], SPreset: { version: 1 }, tavern_helper: { enabled: true } },
  };
  mapFields(top, report);
  const manualFields = report.sections.topLevel.filter((e) => e.action === 'manual').map((e) => e.field as string);
  assert.ok(manualFields.includes('extensions.SPreset'));
  assert.ok(manualFields.includes('extensions.tavern_helper'));
});

test('mapPrompts preserves custom charDescription content before scenario merge', () => {
  const report = createReport('t');
  const ir = parseST({
    ...fixture,
    prompts: [
      ...(fixture.prompts ?? []),
      {
        identifier: 'charDescription',
        name: 'Description',
        role: 'system',
        content: 'CUSTOM DESC {{description}}',
      },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'scenario', enabled: true },
          { identifier: 'charDescription', enabled: true },
        ],
      },
    ],
  });
  const { cards } = mapPrompts(ir, report);
  const description = cards.find((c) => c.type === 'description');
  assert.ok(description);
  const fmt = description.innerFormat as string;
  assert.ok(fmt.includes('CUSTOM DESC'), 'custom description preserved');
  assert.ok(fmt.includes('{{scenario}}'), 'scenario content merged after custom description');
  const degraded = report.sections.prompts.filter((e) => e.action === 'degraded').map((e) => e.identifier as string);
  assert.ok(degraded.includes('charDescription'));
});

test('convert produces preset + report', () => {
  const { preset, report } = convert(fixture, { source: 'minimal-st.json' });
  assert.equal(preset.name, 'minimal');
  assert.equal(preset.temperature, 100);
  assert.ok(Array.isArray(preset.promptTemplate));
  assert.ok(Array.isArray(preset.regex));
  assert.equal(preset.regex.length, 1);
  assert.equal(preset.regex[0].type, 'editdisplay'); // markdownOnly + placement[2]
  assert.equal(preset.regex[0].in, 'x');
  assert.equal(preset.regex[0].out, 'y');
  assert.equal(report.source, 'minimal-st.json');
  assert.ok(report.summary.dropped >= 3);
  assert.equal(report.summary.converted, 3); // assistant_prefill + 正则脚本 + disabled 守卫卡 toggle
  const converted = report.sections.regex.filter((e) => e.action === 'converted');
  assert.equal(converted.length, 1);
});

function reorderFixture(scenarioFirst: boolean): TavernPreset {
  const copy: TavernPreset = JSON.parse(JSON.stringify(fixture));
  const orderArr = copy.prompt_order![0].order!;
  const desc = orderArr.find((o) => o.identifier === 'charDescription')!;
  const scen = orderArr.find((o) => o.identifier === 'scenario')!;
  orderArr.splice(orderArr.indexOf(desc), 1);
  orderArr.splice(orderArr.indexOf(scen), 1);
  orderArr.splice(0, 0, ...(scenarioFirst ? [scen, desc] : [desc, scen]));
  return copy;
}

test('scenario 在 charDescription 之前时仍并入 description 卡(顺序无关)', () => {
  const report = createReport('t');
  const { cards } = mapPrompts(parseST(reorderFixture(true)), report);
  const descCards = cards.filter((c) => c.type === 'description');
  assert.equal(descCards.length, 1);
  assert.match(descCards[0].innerFormat as string, /\{\{scenario\}\}/);
  // 不应出现独立的 scenario plain 卡
  assert.ok(!cards.some((c) => c.type2 === 'normal' && c.text === '{{scenario}}'));
});

test('scenario_format 驱动 description 卡 innerFormat', () => {
  const report = createReport('t');
  const withFormat: TavernPreset = { ...fixture, scenario_format: 'System note: {{scenario}}' };
  const { cards } = mapPrompts(parseST(withFormat), report);
  const desc = cards.find((c) => c.type === 'description')!;
  assert.ok(desc);
  assert.match(desc.innerFormat as string, /System note: \{\{scenario\}\}/);
  assert.match(desc.innerFormat as string, /\{\{slot\}\}/);
});

test('未知顶层字段 -> manual 报告', () => {
  const report = createReport('t');
  mapFields({ ...fixture, some_unknown_key: 'value' }, report);
  const manual = report.sections.topLevel.find((e) => e.action === 'manual' && e.field === 'some_unknown_key');
  assert.ok(manual);
});

test('apiType/aiModel 有值 -> manual 报告,不发明输出字段', () => {
  const report = createReport('t');
  const out = mapFields({ ...fixture, apiType: 'openai', aiModel: 'gpt-4o' }, report);
  assert.ok(!('apiType' in out));
  assert.ok(!('aiModel' in out));
  assert.ok(report.sections.topLevel.some((e) => e.action === 'manual' && e.field === 'apiType'));
  assert.ok(report.sections.topLevel.some((e) => e.action === 'manual' && e.field === 'aiModel'));
});
