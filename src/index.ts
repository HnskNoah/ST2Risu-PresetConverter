import { parseST } from './ir.js';
import { createReport } from './report.js';
import { mapFields } from './mapFields.js';
import { mapPrompts } from './mapPrompts.js';
import { mapRegexes } from './mapRegexes.js';
import { buildModule } from './mapTriggers.js';
import { mapToggles } from './mapToggles.js';
import { mapDisabledToggles } from './mapDisabledToggles.js';
import { mapInstruct } from './mapInstruct.js';
import type { ConvertOptions, ConvertResult } from './types.js';

export function convert(tavernJson: unknown, opts: ConvertOptions = {}): ConvertResult {
  const report = createReport(opts.source ?? 'preset');
  const ir = parseST(tavernJson);
  const fields = mapFields(ir.topLevel, report);
  // round11: 变量卡组 → customPromptTemplateToggle(基于原始 prompts+order,含 disabled 候选)
  const toggles = mapToggles(ir.topLevel, ir.prompts, ir.promptOrder[0]?.order ?? [], report);
  // round18: 孤立 disabled 卡(未进变量组)→ 默认关闭的开关(守卫卡),让用户可在 Risu 重新打开
  const disabledToggles = mapDisabledToggles(ir.prompts, ir.promptOrder[0]?.order ?? [], report);
  const { cards: promptTemplate, setvars } = mapPrompts(ir, report, {
    defs: toggles.defs,
    toggleKeys: toggles.toggleKeys,
  });
  if (disabledToggles.guardCard) promptTemplate.push(disabledToggles.guardCard);
  const regex = mapRegexes(ir.regexScripts, report);
  const toggleTemplate = [toggles.toggleTemplate, disabledToggles.toggleLines].filter(Boolean).join('\n');
  const preset = {
    ...fields,
    promptTemplate,
    regex,
    ...(toggleTemplate ? { customPromptTemplateToggle: toggleTemplate } : {}),
  };
  // round17: 可选第二输入 ST instruct preset(显式 opts.instruct,或主预设顶层 instruct 块)
  const instrRaw = opts.instruct ?? ir.topLevel.instruct;
  if (instrRaw && typeof instrRaw === 'object' && !Array.isArray(instrRaw)) {
    const instr = mapInstruct(instrRaw);
    Object.assign(preset, instr);
    report.add('topLevel', {
      field: 'instruct',
      action: 'converted',
      reason: `instruct 模式开启:instructChatTemplate=jinja,useInstructPrompt=true,JinjaTemplate(${instr.JinjaTemplate.length} 字符)`,
    });
  }
  const module = buildModule({ setvars, source: opts.source ?? 'preset' })?.module ?? null;
  return { preset, report, module };
}
