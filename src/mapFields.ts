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
  'use_sysprompt',
  'assistant_impersonation',
  'function_calling',
  'enable_web_search',
  'request_images',
] as const;

// 顶层行为字符串:Risu 均为硬编码注入,无 botPreset 字段。
// 决策(2026-08-09):continue_postfix 有近似等价(promptSettings.postEndInnerFormat,每次生成追加非仅续写 → degraded);
// assistant_prefill 仿官方 stChatConvert 转 postEverything 卡;
// continue_nudge_prompt/impersonation_prompt 语义无等价,有值时 manual 保留并说明;
// continue_prefill 有值时 manual 保留(Risu 续写自动用上一条内容作 prefix,无 prefill 文本字段);
// 其余(new_chat/new_group_chat/new_example_chat/group_nudge/send_if_empty)为空值即忽略,不产生噪音。
const BEHAVIOR_CONVERT_POSTFIX = 'continue_postfix' as const;
const BEHAVIOR_MANUAL = [
  'impersonation_prompt',
  'continue_nudge_prompt',
  'continue_prefill',
] as const;
// 空值即忽略、不报告的行为字段(ST 中默认多为空;有值才报 manual)
const BEHAVIOR_SILENT_IGNORE = [
  'new_chat_prompt',
  'new_group_chat_prompt',
  'new_example_chat_prompt',
  'group_nudge_prompt',
  'send_if_empty',
] as const;

// 思考参数:show_thoughts v1 报告 manual(待调研);reasoning_effort 已映射到 Risu reasonEffort
const REASONING_MANUAL = ['show_thoughts'] as const;

// ST reasoning_effort -> Risu reasonEffort(0=Low/1=Medium/2=High,3=XHigh 无 ST 等价)
const REASONING_EFFORT_MAP: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

// 转换器消费或已报告的顶层字段白名单(采样器/上下文/name/assistant_prefill/prompts/
// prompt_order/extensions/bias_preset_selected + DROPPED 列表 + 连接类 + 格式串)。
const CONSUMED_OR_REPORTED = new Set<string>([
  ...DROPPED_NO_EQUIVALENT,
  ...BEHAVIOR_MANUAL,
  ...BEHAVIOR_SILENT_IGNORE,
  BEHAVIOR_CONVERT_POSTFIX,
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
  'reasoning_effort',
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
      action: 'manual',
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

  // 顶层行为字符串(2026-08-09 调研定稿):
  // continue_postfix → promptSettings.postEndInnerFormat(每次生成追加,非仅续写 → degraded)
  if (hasValue(top[BEHAVIOR_CONVERT_POSTFIX])) {
    out.promptSettings = { postEndInnerFormat: String(top[BEHAVIOR_CONVERT_POSTFIX]) };
    report.add('topLevel', {
      field: BEHAVIOR_CONVERT_POSTFIX,
      action: 'degraded',
      reason: 'Risu promptSettings.postEndInnerFormat 每次生成都追加(prompt.ts:11),ST 仅续写时追加;近似承载',
    });
  }
  // continue_nudge_prompt / impersonation_prompt / continue_prefill:语义无等价,有值时 manual 保留
  for (const field of BEHAVIOR_MANUAL) {
    if (hasValue(top[field])) {
      const reason =
        field === 'continue_nudge_prompt'
          ? 'Risu 续写提示硬编码 [Continue the last response](index.svelte.ts:1227),无 botPreset 字段;自定义续写提示不生效'
          : field === 'impersonation_prompt'
            ? 'Risu 无"以非真名发送"检测(用户名恒为 getUserName),systemprompt trigger 会无条件注入,无法只在冒充时注入'
            : 'Risu 续写自动用上一条 assistant 内容作 prefix,无 prefill 文本字段(assistantPrefill 为未启用休眠字段)';
      report.add('topLevel', { field, action: 'manual', reason });
    }
  }
  // 空值行为字段:默认即空,忽略不报告(避免噪音)

  // 思考参数:show_thoughts v1 报告 manual(SCOPE 决策)
  for (const field of REASONING_MANUAL) {
    if (hasValue(top[field])) {
      report.add('topLevel', {
        field,
        action: 'manual',
        reason: 'v1 未映射,待调研 Risu 思考参数映射',
      });
    }
  }

  // reasoning_effort -> Risu reasonEffort(ST low/medium/high 映射到 0/1/2)
  if (hasValue(top.reasoning_effort)) {
    const r = String(top.reasoning_effort).toLowerCase();
    const mapped = REASONING_EFFORT_MAP[r] ?? (Number.isInteger(Number(r)) ? Number(r) : undefined);
    if (mapped !== undefined && mapped >= 0 && mapped <= 3) {
      out.reasonEffort = mapped;
      report.add('topLevel', {
        field: 'reasoning_effort',
        action: 'converted',
        reason: `reasoning_effort '${String(top.reasoning_effort)}' -> Risu reasonEffort=${mapped}(0=Low/1=Medium/2=High/3=XHigh)`,
      });
    } else {
      report.add('topLevel', {
        field: 'reasoning_effort',
        action: 'manual',
        reason: `reasoning_effort '${String(top.reasoning_effort)}' 无 Risu 等价(auto 由模型决定,Risu 仅 Low/Medium/High/XHigh),未写入`,
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
