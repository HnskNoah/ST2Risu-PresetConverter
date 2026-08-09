import type { MapFieldsResult, Report, TavernPreset } from './types.js';

const num = (v: unknown, scale = 1): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n * scale;
};

const DROPPED_NO_EQUIVALENT = [
  'seed',
  'n',
  'stream_openai',
  'squash_system_messages',
  'max_context_unlocked',
  'names_behavior',
  'media_inlining',
  'wrap_in_quotes',
  'image_inlining',
  'video_inlining',
  'inline_image_quality',
  'claude_use_sysprompt',
  'use_makersuite_sysprompt',
  'function_calling',
  'enable_web_search',
  'request_images',
] as const;

// 顶层行为字符串:v1 报告 manual,待调研 Risu 对应模板(continue/impersonation)后转
const BEHAVIOR_MANUAL = [
  'impersonation_prompt',
  'new_chat_prompt',
  'new_group_chat_prompt',
  'new_example_chat_prompt',
  'continue_nudge_prompt',
  'group_nudge_prompt',
  'continue_postfix',
  'continue_prefill',
  'send_if_empty',
  'assistant_impersonation',
] as const;

// 思考参数:v1 报告 manual,待调研 Risu 思考参数映射后转
const REASONING_MANUAL = ['reasoning_effort', 'show_thoughts'] as const;

// 转换器消费或已报告的顶层字段白名单(采样器/上下文/name/assistant_prefill/prompts/
// prompt_order/extensions/bias_preset_selected + DROPPED 列表 + 连接类 + 格式串)。
const CONSUMED_OR_REPORTED = new Set<string>([
  ...DROPPED_NO_EQUIVALENT,
  ...BEHAVIOR_MANUAL,
  ...REASONING_MANUAL,
  'bias_preset_selected',
  'apiType',
  'aiModel',
  'name',
  'assistant_prefill',
  'prompts',
  'prompt_order',
  'extensions',
  'wi_format',
  'scenario_format',
  'personality_format',
  'temperature',
  'frequency_penalty',
  'presence_penalty',
  'top_p',
  'top_k',
  'top_a',
  'min_p',
  'repetition_penalty',
  'openai_max_context',
  'openai_max_tokens',
]);

const hasValue = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== '' && v !== false && v !== 'false' && v !== 0 && v !== '0';

export function mapFields(top: TavernPreset, report: Report): MapFieldsResult {
  const out: MapFieldsResult = {
    temperature: num(top.temperature, 100) ?? 80,
    frequencyPenalty: num(top.frequency_penalty, 100) ?? 70,
    // decision 2026-08-09: presence_penalty x100, missing -> 0 (avoid official x0.7/NaN bug)
    PresensePenalty: num(top.presence_penalty, 100) ?? 0,
    top_p: num(top.top_p) ?? 1,
    top_k: num(top.top_k) ?? 0,
    top_a: num(top.top_a) ?? 0,
    min_p: num(top.min_p) ?? 0,
    repetition_penalty: num(top.repetition_penalty) ?? 1,
    maxContext: num(top.openai_max_context) ?? 4000,
    maxResponse: num(top.openai_max_tokens) ?? 300,
  };

  if (top.name) out.name = top.name;

  for (const field of DROPPED_NO_EQUIVALENT) {
    if (hasValue(top[field])) {
      report.add('topLevel', { field, action: 'dropped', reason: 'Risu botPreset 无等价字段' });
    }
  }
  if (hasValue(top.bias_preset_selected)) {
    report.add('topLevel', {
      field: 'bias_preset_selected',
      action: 'dropped',
      reason: 'bias 本体在 ST 侧 openai_settings.bias_presets,preset 文件仅存名字',
      suggestion: '如需要,从 ST 全局设置手动迁移 bias 数组到 Risu bias',
    });
  }

  // 连接类字段:不发明输出字段,保留 Risu 默认连接设置并报告
  if (hasValue(top.apiType)) {
    report.add('topLevel', {
      field: 'apiType',
      action: 'manual',
      reason: '未映射到 Risu 连接字段,将使用 Risu 默认连接设置',
    });
  }
  if (hasValue(top.aiModel)) {
    report.add('topLevel', {
      field: 'aiModel',
      action: 'manual',
      reason: '未映射到 Risu 连接字段,将使用 Risu 默认连接设置',
    });
  }

  // 顶层行为字符串:v1 报告 manual(SCOPE 决策)
  for (const field of BEHAVIOR_MANUAL) {
    if (hasValue(top[field])) {
      report.add('topLevel', {
        field,
        action: 'manual',
        reason: 'v1 未映射,待调研 Risu 对应模板(continue/impersonation)',
      });
    }
  }

  // 思考参数:v1 报告 manual(SCOPE 决策)
  for (const field of REASONING_MANUAL) {
    if (hasValue(top[field])) {
      report.add('topLevel', {
        field,
        action: 'manual',
        reason: 'v1 未映射,待调研 Risu 思考参数映射',
      });
    }
  }

  // 白名单外的未知顶层字段:报告 manual,不静默忽略
  for (const key of Object.keys(top)) {
    if (CONSUMED_OR_REPORTED.has(key)) continue;
    if (!hasValue(top[key])) continue;
    report.add('topLevel', {
      field: key,
      action: 'manual',
      reason: '未知顶层字段,未映射到 Risu botPreset',
    });
  }

  // extensions 插件子字段(regex_scripts 除外)由转换器消费;其余插件扩展字段报告 manual(SCOPE §三)
  if (top.extensions && typeof top.extensions === 'object') {
    for (const key of Object.keys(top.extensions)) {
      if (key === 'regex_scripts') continue;
      if (!hasValue(top.extensions[key])) continue;
      report.add('topLevel', {
        field: `extensions.${key}`,
        action: 'manual',
        reason: '插件扩展字段,v1 不转换',
      });
    }
  }

  return out;
}
