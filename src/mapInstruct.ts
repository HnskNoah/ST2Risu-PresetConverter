// ST instruct preset -> Risu JinjaTemplate(round17)。
//
// ST 的 Instruct 模式是独立预设体系(instruct/<name>.json),字段含 input_sequence/
// output_sequence/system_sequence/suffix 等。Risu 的 instruct 模式(useInstructPrompt +
// instructChatTemplate='jinja' + JinjaTemplate)用 @huggingface/jinja 渲染单串 prompt。
//
// 算法以官方转换器 prompt.ts:453-484 为蓝本,for-message 循环按 role 分支把 ST 序列
// 逐字直插(官方如此,无需转义)。两处增强:
//   1. assistant 前缀区分 first/last:ST 的 first_output_sequence/last_output_sequence
//      是独立字段(官方完全丢弃,Libra-32B 主分隔符就在 last_output_sequence),
//      用 Jinja loop.first/loop.last 精确还原;
//   2. story_string 的 {{system_prompt}}/{{system}} 替换目标为 system_prompt 字段
//      (官方替换为 instData.system_prompt 的字面内容,不是 system_sequence)。

export interface STInstructData {
  system_prompt?: string;
  input_sequence?: string;
  output_sequence?: string;
  last_output_sequence?: string;
  system_sequence?: string;
  stop_sequence?: string;
  system_sequence_prefix?: string;
  system_sequence_suffix?: string;
  first_output_sequence?: string;
  output_suffix?: string;
  input_suffix?: string;
  system_suffix?: string;
  user_alignment_message?: string;
  system_same_as_user?: boolean;
  last_system_sequence?: string;
  first_input_sequence?: string;
  last_input_sequence?: string;
  name?: string;
  story_string?: string;
  chat_start?: string;
  story_string_prefix?: string;
  story_string_suffix?: string;
}

export interface InstructResult {
  instructChatTemplate: string;
  JinjaTemplate: string;
  useInstructPrompt: boolean;
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '');

// story_string 预处理(官方 prompt.ts:456-463):{{user}}->{{risu_user}}、
// {{system_prompt}}/{{system}} 替换为字面内容、删 {{#if}} 块与残留 {{...}}、压缩空行
// 注意:{{risu_user}} 与 system_prompt 文本都先占位(NUL 前缀,避开后续 {{...}} 清理),最后才还原
const USER_PLACEHOLDER = '\u0000RISU_USER\u0000';
const SYS_PLACEHOLDER = '\u0000RISU_SYSTEM\u0000';

function preprocessStory(story: string, systemPrompt: string): string {
  const out = story
    .replace(/\{\{user\}\}/gi, USER_PLACEHOLDER)
    .replace(/\{\{system_prompt\}\}/gi, SYS_PLACEHOLDER)
    .replace(/\{\{system\}\}/gi, SYS_PLACEHOLDER)
    .replace(/\{\{#if\s*[\s\S]*?\{\{\/if\}\}/g, '')
    .replace(/\{\{[\s\S]*?\}\}/gi, '')
    .replace(/\n{3,}/g, '\n\n');
  return out
    .split(SYS_PLACEHOLDER)
    .join(systemPrompt)
    .split(USER_PLACEHOLDER)
    .join('{{risu_user}}');
}

function systemBranch(data: STInstructData): string {
  if (data.system_same_as_user) {
    // system 消息当作 user 处理(官方 prompt.ts:371-375)
    return `${s(data.input_sequence)}{{ message.content }}${s(data.output_sequence)}${s(data.system_suffix)}`;
  }
  return `${s(data.system_sequence)}${s(data.system_sequence_prefix)}{{ message.content }}${s(data.system_sequence_suffix)}${s(data.system_suffix)}`;
}

// assistant 前缀:first_output_sequence(loop.first) > last_output_sequence(loop.last) > output_sequence
function assistantBranch(data: STInstructData): string {
  const first = s(data.first_output_sequence);
  const last = s(data.last_output_sequence);
  const def = s(data.output_sequence);
  if (first && last) {
    return `{% if loop.first %}${first}{% elif loop.last %}${last}{% else %}${def}{% endif %}`;
  }
  if (first) {
    return `{% if loop.first %}${first}{% else %}${def}{% endif %}`;
  }
  if (last) {
    return `{% if loop.last %}${last}{% else %}${def}{% endif %}`;
  }
  return def;
}

// 生成 JinjaTemplate。官方收尾追加 output_sequence(生成提示/助手前缀)。
export function buildJinjaTemplate(data: STInstructData): string {
  const parts: string[] = [];
  // story_string_prefix/suffix 仅附着 story_string 段落(仿 instruct-mode.js:490-496:prefix 替换 {{name}}->System)
  const storyRaw = s(data.story_string)
    ? s(data.story_string_prefix).replace(/{{name}}/gi, 'System') + s(data.story_string) + s(data.story_string_suffix)
    : '';
  const story = preprocessStory(storyRaw, s(data.system_prompt));
  if (story) parts.push(story);
  if (s(data.chat_start)) parts.push(s(data.chat_start));

  parts.push('{% for message in messages %}');
  parts.push(`{% if message.role == 'user' %}${s(data.input_sequence)}{{ message.content }}${s(data.input_suffix)}{% endif %}`);
  parts.push(`{% if message.role == 'assistant' %}${assistantBranch(data)}{{ message.content }}${s(data.output_suffix)}{% endif %}`);
  parts.push(`{% if message.role == 'system' %}${systemBranch(data)}{% endif %}`);
  parts.push('{% endfor %}');
  parts.push(s(data.output_sequence));
  return parts.join('');
}

// 判断对象是否为 ST instruct 配置(含序列字段)。用于主预设顶层 instr 块识别。
export function looksLikeInstruct(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.input_sequence === 'string' || typeof o.output_sequence === 'string' || typeof o.system_sequence === 'string';
}

// 从任意对象提取 instruct 字段;兼容顶层直放序列字段 / {instruct:{...}} 嵌套两种形态
export function mapInstruct(raw: unknown): InstructResult {
  const inner = looksLikeInstruct(raw) ? raw : (raw as Record<string, unknown> | undefined)?.instruct;
  const data = (looksLikeInstruct(inner) ? inner : {}) as STInstructData;
  return {
    instructChatTemplate: 'jinja',
    JinjaTemplate: buildJinjaTemplate(data),
    useInstructPrompt: true,
  };
}
