import { normalizeRole } from './ir.js';
import type { ParsedIR, Report, RisuPromptCard } from './types.js';
import { translateMacros } from './macroTable.js';

export function mapPrompts(ir: ParsedIR, report: Report): RisuPromptCard[] {
  const { prompts, promptOrder, formats } = ir;
  const order = promptOrder[0]?.order ?? [];
  const byId = new Map(prompts.map((p) => [p.identifier, p]));
  const cards: RisuPromptCard[] = [];
  const tail: RisuPromptCard[] = [];
  let hasMain = false;
  // 预扫描:先建立 description 卡引用,scenario 无论出现在 charDescription 之前还是之后都能并入(顺序无关)
  const orderItems = order.filter((item) => item && item.enabled !== false);
  let descriptionCard: RisuPromptCard | null = orderItems.some((item) => item.identifier === 'charDescription')
    ? { type: 'description' }
    : null;

  for (const item of order) {
    if (!item || item.enabled === false) continue;
    const p = byId.get(item.identifier);
    if (!p) {
      report.add('prompts', {
        identifier: item.identifier,
        action: 'manual',
        reason: 'prompt_order 引用的 prompt 不存在',
      });
      continue;
    }
    const text = (p.content ?? '').trim();
    const scenarioFormat = formats.scenarioFormat;
    switch (item.identifier) {
      case 'main':
        hasMain = true;
        cards.push({ type: 'plain', type2: 'main', text: text || '\n', role: normalizeRole(p.role) });
        break;
      case 'jailbreak':
      case 'nsfw':
        cards.push({ type: 'jailbreak', type2: 'normal', text: text || '\n', role: normalizeRole(p.role) });
        break;
      case 'chatHistory':
        cards.push({ type: 'chat', rangeStart: 0, rangeEnd: 'end' });
        break;
      case 'worldInfoBefore':
        cards.push({ type: 'lorebook' });
        break;
      case 'charDescription': {
        if (!descriptionCard) descriptionCard = { type: 'description' };
        // 标准内容 {{description}} 等价 Risu {{slot}},直接丢弃;自定义内容保留在 innerFormat 前缀
        if (text && text !== '{{description}}') {
          const existing = typeof descriptionCard.innerFormat === 'string' ? descriptionCard.innerFormat : '';
          descriptionCard.innerFormat = existing ? `${text}\n${existing}` : `${text}\n{{slot}}`;
          report.add('prompts', {
            identifier: 'charDescription',
            action: 'degraded',
            reason: '自定义 description 内容并入 innerFormat',
          });
        }
        cards.push(descriptionCard);
        break;
      }
      case 'personaDescription':
        cards.push({ type: 'persona', innerFormat: formats.personalityFormat ?? '{{slot}}' });
        break;
      case 'scenario': {
        // decision 2026-08-09: 并入 description 卡 innerFormat(经 scenario_format 包装,官方漏转字段)
        const content = scenarioFormat ? String(scenarioFormat).replace(/\{\{scenario\}\}/g, text) : text;
        if (descriptionCard) {
          // 保留已有的自定义 description 前缀,再追加 scenario 内容
          const existing = typeof descriptionCard.innerFormat === 'string'
            ? descriptionCard.innerFormat.replace(/\n\{\{slot\}\}$/, '')
            : '';
          descriptionCard.innerFormat = existing ? `${existing}\n${content}\n{{slot}}` : `${content}\n{{slot}}`;
        } else {
          cards.push({ type: 'plain', type2: 'normal', text: content || '', role: 'system' });
        }
        report.add('prompts', {
          identifier: 'scenario',
          action: 'degraded',
          reason: '并入 description 卡(决策)',
        });
        break;
      }
      case 'charPersonality':
      case 'dialogueExamples':
        cards.push({ type: 'plain', type2: 'normal', text: text || '\n', role: normalizeRole(p.role) });
        report.add('prompts', {
          identifier: item.identifier,
          action: 'degraded',
          reason: 'Risu 无对应槽位,降级 plain(决策)',
        });
        break;
      case 'worldInfoAfter':
        tail.push({ type: 'plain', type2: 'normal', text: text || '\n', role: normalizeRole(p.role) });
        report.add('prompts', {
          identifier: 'worldInfoAfter',
          action: 'degraded',
          reason: 'v1 降级 plain 于模板末尾;pt_ 槽位 M5(决策)',
        });
        break;
      case 'enhanceDefinitions':
        cards.push({ type: 'plain', type2: 'normal', text: text || '\n', role: normalizeRole(p.role) });
        report.add('prompts', {
          identifier: 'enhanceDefinitions',
          action: 'degraded',
          reason: 'Risu 无增强定义槽位,降级 plain',
        });
        break;
      default:
        cards.push({ type: 'plain', type2: 'normal', text: text || '\n', role: normalizeRole(p.role) });
    }
  }

  cards.push(...tail);

  // M3: 宏翻译(每张卡的 text / innerFormat)
  for (const c of cards) {
    if (typeof c.text === 'string') c.text = translateMacros(c.text, report, `prompt:${c.type}`);
    if (typeof c.innerFormat === 'string') c.innerFormat = translateMacros(c.innerFormat, report, `prompt:${c.type}`);
  }

  // wi_format 非默认时报告未消费(v1 lorebook 卡不支持 innerFormat)
  const WI_FORMAT_DEFAULT = 'System: {{wi}}';
  const wiFormat = formats.wiFormat;
  if (wiFormat !== undefined && wiFormat !== null && wiFormat !== '' && String(wiFormat) !== WI_FORMAT_DEFAULT) {
    report.add('prompts', {
      identifier: 'wi_format',
      action: 'manual',
      reason: 'wi_format 未在 v1 消费(lorebook 卡不支持 innerFormat),将使用默认世界书格式',
    });
  }

  const prefill = ir.topLevel?.assistant_prefill;
  if (prefill) {
    // 官方模板:prefill 内容挂在 postEverything 卡的 innerFormat,不另生 main 卡(模板必须恰一张 type2==='main')
    const prefillText = translateMacros(
      `{{#if {{prefill_supported}}}}${prefill}{{/if}}`,
      report,
      'prompt:postEverything',
    );
    cards.push({
      type: 'postEverything',
      innerFormat: prefillText,
      role2: 'bot',
    });
    report.add('prompts', {
      identifier: 'assistant_prefill',
      action: 'converted',
      reason: '官方模板(postEverything innerFormat + prefill 条件)',
    });
  }

  if (!hasMain) {
    report.add('prompts', {
      identifier: 'main',
      action: 'manual',
      reason: 'prompt_order 未启用 main,结果模板缺 main 槽位',
    });
  }

  return cards;
}
