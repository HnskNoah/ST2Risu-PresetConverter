# SillyTavern 宏与 OpenAI preset 字段穷举清单

> 纯研究文档：逐行读取源码所得，未做任何修改。
> 源码根：`C:/Users/Latitude/Dev/AiRP/SillyTavern/SillyTavern-src/public/scripts/`（`script.js` 在 `public/` 根下）。

## 来源文件与行号依据

### 宏系统（新引擎，`macros/`）
| 文件 | 行号依据 | 注册数量 |
|---|---|---|
| `macros/definitions/core-macros.js` | `registerMacro` 第 32–450 行 | 17 |
| `macros/definitions/env-macros.js` | `registerMacro` 第 16–198 行 | 20 |
| `macros/definitions/state-macros.js` | `registerMacro` 第 35、43 行 | 2 |
| `macros/definitions/chat-macros.js` | `registerMacro` 第 9–70 行 | 9 |
| `macros/definitions/time-macros.js` | `registerMacro` 第 11–94 行 | 8 |
| `macros/definitions/variable-macros.js` | `registerMacro` 第 11–287 行 | 14 |
| `macros/definitions/instruct-macros.js` | `registerSimple` 第 22 行（18 个）+ `registerMacro('systemPrompt')` 第 59 行 | 19 |
| `macros/engine/MacroRegistry.js` | `MacroCategory` 枚举第 37–63 行；`MacroValueType` 枚举第 73–89 行 | — |
| `macros/engine/MacroFlags.js` | `MacroFlagType` 枚举 | — |
| `macros/engine/MacroLexer.js` | `Tokens` 定义（含 `Var.*` 运算符 token） | — |
| `macros/engine/MacroParser.js` | 文法规则（`macro`、`macroBody`、`variableExpr`、`arguments`） | — |
| `macros/engine/MacroCstWalker.js` | scoped 配对/变量运算解析 | — |
| `macros/macro-system.js` | `initRegisterMacros()` 注册顺序 | — |

### 宏系统（旧引擎）
| 文件 | 行号依据 | 说明 |
|---|---|---|
| `macros.js` | `evaluateMacros` 第 610–714 行（preEnvMacros 第 622 行起、postEnvMacros 第 642 行起）；`initMacros` 第 717–747 行 | 旧正则宏；仍在使用（`experimental_macro_engine` 关闭时） |
| `instruct-mode.js` | `getInstructMacros` 第 673–763 行 | 旧 instruct 宏键（`a|b` 管道别名） |
| `variables.js` | `getVariableMacros` 第 238–260 行 | 旧变量宏 |
| `authors-note.js` | 第 606–614 行 `MacrosParser.registerMacro` | 扩展宏（跨文件） |
| `extensions/memory/index.js` | 第 1127 行 `summary` | 扩展宏（跨文件） |
| `extensions/stable-diffusion/index.js` | 第 5989、5993 行 `charPrefix`/`charNegativePrefix` | 扩展宏（跨文件） |

### OpenAI preset 字段
| 文件 | 行号依据 |
|---|---|
| `openai.js` | `settingsToUpdate` 第 298–401 行；`sensitiveFields` 第 280–291 行；`default_settings` 第 404–508 行；`getChatCompletionPreset` 第 4477–4485 行；`saveOpenAIPreset` 第 4493–4525 行；`onSettingsPresetChange` 第 4899–4955 行；`default_bias_presets` 第 115–128 行；prompt manager 配置第 670–690 行 |
| `PromptManager.js` | `Prompt` 类 第 78–215 行；`INJECTION_POSITION` 第 37–41 行；`chatCompletionDefaultPrompts` 第 2001–2075 行；`promptManagerDefaultPromptOrders` 第 2083–2086 行；`promptManagerDefaultPromptOrder` 第 2088–2118 行；`getPromptOrderForCharacter` 第 1207–1213 行；`addPromptOrderForCharacter` 第 1233–1240 行 |
| `extensions/regex/index.js` | 编辑保存字段 第 849–868 行（测试对象 第 820–840 行） |
| `extensions/regex/engine.js` | `regex_placement` 第 281–289 行；`substitute_find_regex` 第 292–298 行 |
| `preset-manager.js` | `readPresetExtensionField` 第 846–870 行；`writePresetExtensionField` 第 876–903 行（`oai_settings.extensions` 即 preset 扩展字段容器） |

---

## 新系统宏清单（按 category 分类）

说明：下表中「别名」= 注册在 `aliases` 里、指向同一 handler 的名字（`visible` 标注隐藏别名）。
主宏名共 **89** 个；别名共 **27** 个。

### category: utility（11）
| 宏名 | 别名 | 简述 |
|---|---|---|
| `space` | — | 返回空格，可选 count 参数（默认 1） |
| `newline` | — | 返回换行，可选 count 参数 |
| `noop` | — | 无操作，返回空串 |
| `trim` | — | 修剪空白；非 scoped 时由后处理修剪，scoped 时引擎自动修剪内容 |
| `if` | — | 条件宏：`{{if cond}}…{{else}}…{{/if}}`；`!` 取反，支持宏名/变量简写；延迟解析仅执行选中分支 |
| `else` | — | `{{if}}` 块内的 else 分支标记（scoped 内有效） |
| `input` | — | 当前发送文本框内容 |
| `reverse` | — | 反转参数字符串 |
| `//` | `comment`（隐藏） | 注释宏，返回空串，参数任意（可用 scoped 多行注释） |
| `banned` | — | 屏蔽词（仅 textgenerationwebui 后端），剥除引号 |
| `outlet` | — | 返回指定 outlet key 的 World Info outlet 提示 |

### category: random（3）
| 宏名 | 别名 | 简述 |
|---|---|---|
| `roll` | — | droll 骰子掷骰（如 `{{roll::1d20}}`），纯数字视为 `1dN` |
| `random` | — | 从列表随机取一项，每次解析都会重掷 |
| `pick` | — | 从列表确定性取一项（按 chat + 位置播种），`/reroll-pick` 可重掷 |

### category: names（5）
| 宏名 | 别名 | 简述 |
|---|---|---|
| `user` | — | 当前 persona 用户名 |
| `char` | — | 角色名 |
| `group` | `charIfNotGroup`（隐藏） | 群组成员名（含静音）逗号列表，单聊则返回角色名 |
| `groupNotMuted` | — | 群组成员名（排除静音）逗号列表 |
| `notChar` | — | 除当前说话者外的所有参与者名列表 |

### category: character（13）
| 宏名 | 别名 | 简述 |
|---|---|---|
| `charPrompt` | — | 角色主提示（Main Prompt）覆写 |
| `charInstruction` | — | 角色历史后指令（Post-History）覆写 |
| `charDescription` | `description` | 角色描述 |
| `charPersonality` | `personality` | 角色性格 |
| `charScenario` | `scenario` | 角色情景 |
| `persona` | — | 当前 persona 描述 |
| `mesExamplesRaw` | — | 未格式化的对话示例 |
| `mesExamples` | — | 对话示例，开启 instruct 时按 instruct 格式 |
| `charDepthPrompt` | — | 角色 @ 深度笔记 |
| `charCreatorNotes` | `creatorNotes` | 角色卡创建者备注 |
| `charFirstMessage` | `greeting` | 角色开场白；可选 index 取备用开场白（0 起） |
| `charVersion` | `version`（隐藏）、`char_version`（隐藏） | 角色版本号 |
| `original` | — | `{{original}}` 替换用的原文（一次性） |

### category: chat（9）
| 宏名 | 别名 | 简述 |
|---|---|---|
| `lastMessage` | — | 聊天最后一条消息文本 |
| `lastMessageId` | — | 最后一条消息的索引 |
| `lastUserMessage` | — | 最后一条用户消息 |
| `lastCharMessage` | — | 最后一条角色/机器人消息 |
| `firstIncludedMessageId` | — | 当前上下文首条包含消息索引 |
| `firstDisplayedMessageId` | — | 首条显示消息索引 |
| `lastSwipeId` | — | 最后消息的 swipe 数量（1 起） |
| `currentSwipeId` | — | 当前 swipe 索引（1 起） |
| `allChatRange` | — | 全部消息 id 范围字符串（如 `0-10`），空聊天返回空串 |

### category: time（8）
| 宏名 | 别名 | 简述 |
|---|---|---|
| `time` | — | 当前本地时间（`LT`），或 `{{time::UTC±N}}` 偏移时区 |
| `date` | — | 当前本地日期（`LL` 短格式） |
| `weekday` | — | 当前星期名 |
| `isotime` | — | 当前时间 `HH:mm` |
| `isodate` | — | 当前日期 `YYYY-MM-DD` |
| `datetimeformat` | — | 按给定 moment.js 格式串格式化当前时间 |
| `idleDuration` | `idle_duration`（隐藏） | 距最后一条用户消息的可读时长 |
| `timeDiff` | — | 两个时间差的可读描述（绝对值） |

### category: variable（14）
| 宏名 | 别名 | 简述 |
|---|---|---|
| `setvar` | — | 设置局部变量，返回空串 |
| `addvar` | — | 向局部变量追加（数值/字符串），不存在则创建 |
| `incvar` | — | 局部变量 +1，返回新值 |
| `decvar` | — | 局部变量 -1，返回新值 |
| `getvar` | — | 读取局部变量值 |
| `hasvar` | `varexists` | 判断局部变量是否存在，返回 `"true"/"false"` |
| `deletevar` | `flushvar` | 删除局部变量 |
| `setglobalvar` | — | 设置全局变量，返回空串 |
| `addglobalvar` | — | 向全局变量追加，不存在则创建 |
| `incglobalvar` | — | 全局变量 +1，返回新值 |
| `decglobalvar` | — | 全局变量 -1，返回新值 |
| `getglobalvar` | — | 读取全局变量值 |
| `hasglobalvar` | `globalvarexists` | 判断全局变量是否存在 |
| `deleteglobalvar` | `flushglobalvar` | 删除全局变量 |

### category: prompts（19）
| 宏名 | 别名 | 简述 |
|---|---|---|
| `instructStoryStringPrefix` | — | instruct story 前缀 |
| `instructStoryStringSuffix` | — | instruct story 后缀 |
| `instructUserPrefix` | `instructInput` | instruct 用户/输入前缀序列 |
| `instructUserSuffix` | — | instruct 用户/输入后缀序列 |
| `instructAssistantPrefix` | `instructOutput` | instruct 助手/输出前缀序列 |
| `instructAssistantSuffix` | `instructSeparator` | instruct 助手/输出后缀序列 |
| `instructSystemPrefix` | — | instruct 系统前缀序列 |
| `instructSystemSuffix` | — | instruct 系统后缀序列 |
| `instructFirstAssistantPrefix` | `instructFirstOutputPrefix` | instruct 首个助手/输出前缀序列 |
| `instructLastAssistantPrefix` | `instructLastOutputPrefix` | instruct 最后助手/输出前缀序列 |
| `instructStop` | — | instruct 停止序列 |
| `instructUserFiller` | — | instruct 用户对齐填充 |
| `instructSystemInstructionPrefix` | — | instruct 系统指令前缀序列 |
| `instructFirstUserPrefix` | `instructFirstInput` | instruct 首个用户/输入前缀序列 |
| `instructLastUserPrefix` | `instructLastInput` | instruct 最后用户/输入前缀序列 |
| `defaultSystemPrompt` | `instructSystem`、`instructSystemPrompt` | 默认系统提示 |
| `systemPrompt` | — | 活动系统提示文本（可由角色提示覆写） |
| `exampleSeparator` | `chatSeparator` | 示例对话块分隔符 |
| `chatStart` | — | 聊天开始标记 |

### category: state（7）
| 宏名 | 别名 | 简述 |
|---|---|---|
| `maxPrompt` | `maxPromptTokens` | 最大 prompt 上下文尺寸 |
| `maxContext` | `maxContextTokens` | 最大上下文 token 限制 |
| `maxResponse` | `maxResponseTokens` | 最大响应 token 限制 |
| `model` | — | 当前所选 API 的模型名 |
| `isMobile` | — | 是否移动端环境（`"true"/"false"`） |
| `lastGenerationType` | — | 上次生成请求类型（normal/impersonate/regenerate/quiet/swipe/continue），切聊天清空 |
| `hasExtension` | — | 判断某扩展是否启用 |

> 注：`MacroCategory` 枚举还定义了 `misc`、`uncategorized` 两个值（MacroRegistry.js:37–63），但 7 个内置定义文件未使用，仅保留给扩展/兜底。

### 分类计数汇总
| category | 主宏数 |
|---|---|
| utility | 11 |
| random | 3 |
| names | 5 |
| character | 13 |
| chat | 9 |
| time | 8 |
| variable | 14 |
| prompts | 19 |
| state | 7 |
| **合计** | **89** |

别名 27 个：可见 22（`maxPromptTokens`、`maxContextTokens`、`maxResponseTokens`、`description`、`personality`、`scenario`、`creatorNotes`、`greeting`、`varexists`、`flushvar`、`globalvarexists`、`flushglobalvar`、`instructInput`、`instructOutput`、`instructSeparator`、`instructFirstOutputPrefix`、`instructLastOutputPrefix`、`instructFirstInput`、`instructLastInput`、`instructSystem`、`instructSystemPrompt`、`chatSeparator`）；隐藏 5（`comment`、`charIfNotGroup`、`version`、`char_version`、`idle_duration`）。

---

## 旧版宏（新系统未覆盖 / 语法差异）

旧引擎 `macros.js` 的 `evaluateMacros`（第 610–714 行）仍通过正则执行以下宏，其中**新系统未覆盖或有语法差异**的：

| 宏 | 旧语法 | 新系统情况 |
|---|---|---|
| `<USER>` `<BOT>` `<CHAR>` `<CHARIFNOTGROUP>` `<GROUP>` | 无花括号尖括号形式 | **旧系统独有**，新系统只认 `{{user}}` 等花括号形式 |
| `{{time_UTC±N}}` | 如 `{{time_UTC+2}}`（macros.js:667） | **旧系统独有**；新系统改用 `{{time::UTC+2}}` |
| `{{reverse:str}}` | 单冒号分隔（macros.js:658） | 同名但新系统为 `{{reverse::str}}`（双冒号） |
| `{{banned "word"}}` | 带引号（macros.js:444） | 同名但新系统为 `{{banned::word}}`（可剥引号） |
| `{{instructFirstOutput}}` `{{instructLastOutput}}` | 旧键名（instruct-mode.js:707、716） | 已重命名为 `instructFirstAssistantPrefix` / `instructLastAssistantPrefix` |
| `{{random a,b}}` / `{{random:a,b}}` / `{{pick ...}}` / `{{roll ...}}` | 兼容旧分隔 | 同名，新系统统一 `::` 分隔并兼容旧式 |
| `{{newline}}` `{{trim}}` `{{noop}}` `{{input}}` | — | 新系统已覆盖同名宏 |
| `{{lastGenerationType}}` `{{isMobile}}` | `MacrosParser.registerMacro`（macros.js:723、738） | 新系统已覆盖（state/env） |
| 全部 instruct 序列 / 变量宏 | `getInstructMacros` / `getVariableMacros` | 新系统已覆盖 |

**跨文件用 `MacrosParser.registerMacro` 注册的宏（实验引擎开启时会桥接进新注册表）**：
| 宏名 | 来源 | 行号 |
|---|---|---|
| `authorsNote` | `authors-note.js` | 606 |
| `charAuthorsNote` | `authors-note.js` | 610 |
| `defaultAuthorsNote` | `authors-note.js` | 614 |
| `summary` | `extensions/memory/index.js` | 1127 |
| `charPrefix` | `extensions/stable-diffusion/index.js` | 5989 |
| `charNegativePrefix` | `extensions/stable-diffusion/index.js` | 5993 |

> `MacrosParser`（macros.js:42 起）整体标记为 deprecated；`registerMacro` 在 `experimental_macro_engine` 开启时同步注册进 `MacroRegistry`（macros.js:81–98）。

---

## 控制结构 / 特殊语法 / 环境变量

### 宏执行 flags（`MacroFlags.js`）
| 符号 | 名称 | 状态 |
|---|---|---|
| `!` | IMMEDIATE 立即解析 | TBD 未实现 |
| `?` | DELAYED 延迟解析 | TBD 未实现 |
| `~` | REEVALUATE 重解析 | TBD 未实现 |
| `>` | FILTER 管道过滤器开关（令宏内 `\|` 视为过滤器） | 已解析，过滤器功能未实现 |
| `/` | CLOSING_BLOCK 闭块标记（`{{macro}}…{{/macro}}`） | **已实现** |
| `#` | PRESERVE_WHITESPACE 保留空白（同时兼容旧 handlebars 风格 `{{#if}}`） | **已实现** |

### 控制结构
| 语法 | 说明 |
|---|---|
| `{{if cond}}…{{/if}}` | 条件块；`#` 前缀即 `{{#if cond}}` 兼容旧式（`#` 亦阻止自动修剪） |
| `{{if cond}}…{{else}}…{{/if}}` | 条件 + else 分支 |
| `{{if cond::content}}` | 内联 if（双参数形式，不参与深度统计） |
| scoped 宏 `{{macro}}内容{{/macro}}` | 任何支持 scoped 的宏；内容作为最后一个 unnamed 参数 |
| `{{// 注释}}` / scoped 多行注释 | 注释 |
| 嵌套宏 | 参数内可嵌套 `{{…}}` |
| 变量简写 `{{.var}}`（局部）/ `{{$var}}`（全局） | 变量表达式语法，非 flags |

### 变量简写运算符（`MacroLexer.js` Var tokens、`MacroParser.js` variableOperator）
`++` 自增 · `--` 自减 · `=` 赋值 · `+=` 加/追加 · `-=` 减 · `??` 空值兜底 · `||` 假值兜底 · `??=` 空值赋值 · `||=` 假值赋值 · `==` 相等 · `!=` 不等 · `>` 大于 · `>=` 大于等于 · `<` 小于 · `<=` 小于等于

### 环境变量（env / 动态宏）
无 `{{env::…}}` 命名空间。本源码中**不存在** `env::` 语法（全仓 grep 无匹配）。
env 即 `substituteParams`/`evaluateMacros` 传入的对象（`script.js:2901`、`MacroEnvBuilder.js:74–90`），键名直接作宏名：`user`、`char`、`group`、`groupNotMuted`、`notChar`、`model`、`original`，角色卡字段（`charPrompt`、`charInstruction`、`charJailbreak`、`description`、`personality`、`scenario`、`persona`、`mesExamples`、`mesExamplesRaw`、`charVersion`/`char_version`、`charDepthPrompt`、`creatorNotes`），以及各调用方通过 `additionalMacro`/`dynamicMacros` 传入的任意键（如 `substituteParamsExtended` 的第二个参数，openai.js:902）。
> 注意：`{{system}}`、`{{jailbreak}}` 等出现在默认提示串里（如 `power-user.js:90` 的 `{{#if system}}{{system}}`），但**不是静态注册宏**，仅在调用方以 env/dynamic 方式传入时才被替换。

### 本源码中**不存在**的结构（排除项）
`{{#each}}` / `{{/each}}`、`{{:else}}`、`{{stop}}`、`{{only}}`、`{{env::VAR}}` —— 全仓搜索无任何定义或处理逻辑。

---

## OpenAI preset 顶层字段表

preset 结构权威来源：`getChatCompletionPreset`（openai.js:4477–4485）把 `settingsToUpdate` 的每个 `presetKey → settings[settingsKey]` 序列化为 preset body。下表即 `settingsToUpdate`（openai.js:298–401）全部 **102** 个顶层字段。

「连接字段」= `settingsToUpdate` 中第 4 元组 `isConnection=true`，即 `bind_preset_to_connection` 开启时才随 preset 应用（openai.js:4925 跳过判断）。

| 字段（preset 键） | 对应设置键 | 连接字段 | 默认值（default_settings） |
|---|---|---|---|
| `chat_completion_source` | `chat_completion_source` | ✓ | `OPENAI` |
| `temperature` | `temp_openai` | | `1.0` |
| `frequency_penalty` | `freq_pen_openai` | | `0` |
| `presence_penalty` | `pres_pen_openai` | | `0` |
| `top_p` | `top_p_openai` | | `1.0` |
| `top_k` | `top_k_openai` | | `0` |
| `top_a` | `top_a_openai` | | `0` |
| `min_p` | `min_p_openai` | | `0` |
| `repetition_penalty` | `repetition_penalty_openai` | | `1` |
| `max_context_unlocked` | `max_context_unlocked` | | `false` |
| `group_models` | `group_models` | ✓ | `false` |
| `sort_models` | `sort_models` | ✓ | `'alphabetically'` |
| `openai_model` | `openai_model` | ✓ | `'gpt-4-turbo'` |
| `claude_model` | `claude_model` | ✓ | `'claude-sonnet-4-5'` |
| `openrouter_model` | `openrouter_model` | ✓ | openrouter 官网模型 |
| `openrouter_use_fallback` | `openrouter_use_fallback` | ✓ | `false` |
| `openrouter_providers` | `openrouter_providers` | ✓ | `[]` |
| `openrouter_quantizations` | `openrouter_quantizations` | ✓ | `[]` |
| `openrouter_allow_fallbacks` | `openrouter_allow_fallbacks` | ✓ | `true` |
| `openrouter_middleout` | `openrouter_middleout` | ✓ | `openrouter_middleout_types.ON` |
| `tool_reasoning_mode` | `tool_reasoning_mode` | | `DISABLED` |
| `ai21_model` | `ai21_model` | ✓ | `'jamba-large'` |
| `mistralai_model` | `mistralai_model` | ✓ | `'mistral-large-latest'` |
| `cohere_model` | `cohere_model` | ✓ | `'command-r-plus'` |
| `perplexity_model` | `perplexity_model` | ✓ | `'sonar-pro'` |
| `groq_model` | `groq_model` | ✓ | `'llama-3.3-70b-versatile'` |
| `chutes_model` | `chutes_model` | ✓ | `'deepseek-ai/DeepSeek-V3-0324'` |
| `siliconflow_model` | `siliconflow_model` | ✓ | `'deepseek-ai/DeepSeek-V3'` |
| `siliconflow_endpoint` | `siliconflow_endpoint` | ✓ | `SILICONFLOW_ENDPOINT.GLOBAL` |
| `minimax_model` | `minimax_model` | ✓ | `'MiniMax-M2.7'` |
| `minimax_endpoint` | `minimax_endpoint` | ✓ | `MINIMAX_ENDPOINT.GLOBAL` |
| `electronhub_model` | `electronhub_model` | ✓ | `'gpt-4o-mini'` |
| `nanogpt_model` | `nanogpt_model` | ✓ | `'gpt-4o-mini'` |
| `nanogpt_provider` | `nanogpt_provider` | ✓ | `''` |
| `nanogpt_payg_override` | `nanogpt_payg_override` | ✓ | `false` |
| `deepseek_model` | `deepseek_model` | ✓ | `'deepseek-v4-flash'` |
| `aimlapi_model` | `aimlapi_model` | ✓ | `'chatgpt-4o-latest'` |
| `xai_model` | `xai_model` | ✓ | `'grok-3-beta'` |
| `pollinations_model` | `pollinations_model` | ✓ | `'openai'` |
| `moonshot_model` | `moonshot_model` | ✓ | `'kimi-latest'` |
| `fireworks_model` | `fireworks_model` | ✓ | `'accounts/fireworks/models/kimi-k2-instruct'` |
| `cometapi_model` | `cometapi_model` | ✓ | `'gpt-4o'` |
| `custom_model` | `custom_model` | ✓ | `''` |
| `custom_url` | `custom_url` | ✓ | `''` |
| `custom_include_body` | `custom_include_body` | ✓ | `''` |
| `custom_exclude_body` | `custom_exclude_body` | ✓ | `''` |
| `custom_include_headers` | `custom_include_headers` | ✓ | `''` |
| `custom_prompt_post_processing` | `custom_prompt_post_processing` | ✓ | `NONE` |
| `google_model` | `google_model` | ✓ | `'gemini-2.5-pro'` |
| `vertexai_model` | `vertexai_model` | ✓ | `'gemini-2.5-pro'` |
| `zai_model` | `zai_model` | ✓ | `'glm-4.6'` |
| `zai_endpoint` | `zai_endpoint` | ✓ | `ZAI_ENDPOINT.COMMON` |
| `workers_ai_model` | `workers_ai_model` | ✓ | `'@cf/meta/llama-3.3-70b-instruct-fp8-fast'` |
| `workers_ai_account_id` | `workers_ai_account_id` | ✓ | `''` |
| `openai_max_context` | `openai_max_context` | | `max_4k` (4095) |
| `openai_max_tokens` | `openai_max_tokens` | | `300` |
| `names_behavior` | `names_behavior` | | `character_names_behavior.DEFAULT` |
| `send_if_empty` | `send_if_empty` | | `''` |
| `impersonation_prompt` | `impersonation_prompt` | | 默认拟人提示 |
| `new_chat_prompt` | `new_chat_prompt` | | `'[Start a new Chat]'` |
| `new_group_chat_prompt` | `new_group_chat_prompt` | | `'[Start a new group chat. Group members: {{group}}]'` |
| `new_example_chat_prompt` | `new_example_chat_prompt` | | `'[Example Chat]'` |
| `continue_nudge_prompt` | `continue_nudge_prompt` | | `'[Continue your last message without repeating its original content.]'` |
| `bias_preset_selected` | `bias_preset_selected` | | `'Default (none)'` |
| `reverse_proxy` | `reverse_proxy` | ✓ | `''` |
| `wi_format` | `wi_format` | | `'{0}'` |
| `scenario_format` | `scenario_format` | | `'{{scenario}}'` |
| `personality_format` | `personality_format` | | `'{{personality}}'` |
| `group_nudge_prompt` | `group_nudge_prompt` | | `'[Write the next reply only as {{char}}.]'` |
| `stream_openai` | `stream_openai` | | `false` |
| `prompts` | `prompts` | | `chatCompletionDefaultPrompts.prompts` |
| `prompt_order` | `prompt_order` | | `[]` |
| `show_external_models` | `show_external_models` | ✓ | `false` |
| `proxy_password` | `proxy_password` | ✓ | `''` |
| `assistant_prefill` | `assistant_prefill` | | `''` |
| `assistant_impersonation` | `assistant_impersonation` | | `''` |
| `use_sysprompt` | `use_sysprompt` | | `false` |
| `vertexai_auth_mode` | `vertexai_auth_mode` | ✓ | `'express'` |
| `vertexai_region` | `vertexai_region` | ✓ | `'us-central1'` |
| `vertexai_express_project_id` | `vertexai_express_project_id` | ✓ | `''` |
| `squash_system_messages` | `squash_system_messages` | | `false` |
| `media_inlining` | `media_inlining` | | `true` |
| `inline_image_quality` | `inline_image_quality` | | `'auto'` |
| `continue_prefill` | `continue_prefill` | | `false` |
| `continue_postfix` | `continue_postfix` | | `continue_postfix_types.SPACE` |
| `function_calling` | `function_calling` | | `false` |
| `tool_call_recurse_limit` | `tool_call_recurse_limit` | | `5` |
| `show_thoughts` | `show_thoughts` | | `true` |
| `reasoning_effort` | `reasoning_effort` | | `reasoning_effort_types.auto` |
| `verbosity` | `verbosity` | | `verbosity_levels.auto` |
| `enable_web_search` | `enable_web_search` | | `false` |
| `seed` | `seed` | | `-1` |
| `n` | `n` | | `1` |
| `bypass_status_check` | `bypass_status_check` | ✓ | `false` |
| `request_images` | `request_images` | | `false` |
| `request_image_aspect_ratio` | `request_image_aspect_ratio` | | `''` |
| `request_image_resolution` | `request_image_resolution` | | `''` |
| `azure_base_url` | `azure_base_url` | ✓ | `''` |
| `azure_deployment_name` | `azure_deployment_name` | ✓ | `''` |
| `azure_api_version` | `azure_api_version` | ✓ | `'2024-02-15-preview'` |
| `azure_openai_model` | `azure_openai_model` | ✓ | `''` |
| `extensions` | `extensions` | | `{}` |

> **不存在的字段**（用户疑点核对）：`max_context`/`max_tokens`（此处为 `openai_max_context`/`openai_max_tokens`）、`wrap_in_quotes`、`apiType`、`request_images` 之外的 `image` 字段、`top_d`。`bias_presets` 是全局设置（`oai_settings.bias_presets`），**不在 preset body 内**（不在 `settingsToUpdate`）。`preset_settings_openai`、`bind_preset_to_connection`、API key 等为全局设置，不进 preset。`sensitiveFields`（openai.js:280–291：`reverse_proxy`、`proxy_password`、`custom_url`、`custom_include_body`、`custom_exclude_body`、`custom_include_headers`、`vertexai_region`、`vertexai_express_project_id`、`azure_base_url`、`azure_deployment_name`、`workers_ai_account_id`）在导出/显示 preset 时被剔除（openai.js:4766、4696）。

---

## prompts / prompt_order 结构

### `prompts` 数组元素（Prompt 类，PromptManager.js:78–215）
| 字段 | 类型 | 说明 |
|---|---|---|
| `identifier` | string | 唯一键（如 `main`、`nsfw`、`jailbreak`、`enhanceDefinitions`、`dialogueExamples`、`chatHistory`、`worldInfoAfter`、`worldInfoBefore`、`charDescription`、`charPersonality`、`scenario`、`personaDescription`） |
| `name` | string | 显示名 |
| `system_prompt` | boolean | 是否系统提示 |
| `role` | string | `'system'` / `'user'` / `'assistant'` |
| `content` | string | 提示内容（marker 型为空） |
| `marker` | boolean | 是否占位标记（如 Chat History、World Info 槽位） |
| `injection_position` | number | `0`=相对（relative）、`1`=绝对（absolute，见 `INJECTION_POSITION`） |
| `injection_depth` | number | 注入深度（默认 `DEFAULT_DEPTH=4`） |
| `injection_order` | number | 注入顺序（默认 `DEFAULT_ORDER=100`） |
| `forbid_overrides` | boolean | 是否禁止被覆写 |
| `extension` | boolean | 是否扩展添加 |
| `position` | string\|number | 在提示列表中的位置 |
| `injection_trigger` | ? | 构造器解构字段（`openai.js:1268` 会拷贝 `injection_position/depth/order`） |
| `enabled` | boolean | 是否启用 |

默认 `chatCompletionDefaultPrompts.prompts` 含 12 项（PromptManager.js:2001–2075）：`main`、`nsfw`、`dialogueExamples`（marker）、`jailbreak`、`chatHistory`（marker）、`worldInfoAfter`（marker）、`worldInfoBefore`（marker）、`enhanceDefinitions`、`charDescription`（marker）、`charPersonality`（marker）、`scenario`（marker）、`personaDescription`（marker）。

### `prompt_order` 结构
- `oai_settings.prompt_order` 为数组，元素：`{ character_id, order: [{ identifier, enabled }] }`（PromptManager.js:1207–1240）。
- `character_id`：按 `String(character.id)` 匹配；全局策略下用 `configuration.promptOrder.dummyId`（openai completion 为 **100001**，openai.js:687；默认全局 `dummyId=100000`，PromptManager.js:336）。
- `order`：元素 `{ identifier, enabled }`，顺序即注入顺序。
- 默认空：`promptManagerDefaultPromptOrders = { prompt_order: [] }`；无自定义顺序时使用 `promptManagerDefaultPromptOrder`（12 项：`main`、`worldInfoBefore`、`personaDescription`、`charDescription`、`charPersonality`、`scenario`、`enhanceDefinitions`(enabled:false)、`nsfw`、`worldInfoAfter`、`dialogueExamples`、`chatHistory`、`jailbreak`，PromptManager.js:2088–2118）。

---

## extensions.regex_scripts 字段表

preset 的 `extensions` 对象即 preset 扩展字段容器（preset-manager.js:884 `settings.extensions`；`writePresetExtensionField({ path: 'regex_scripts' })` 写入 `oai_settings.extensions.regex_scripts`，regex/engine.js:152）。regex 脚本保存字段见 regex/index.js:849–868。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | UUID |
| `scriptName` | string | 脚本名 |
| `findRegex` | string | 查找正则 |
| `replaceString` | string | 替换串（支持 `{{match}}`、`$1`、`$<name>` 引用） |
| `trimStrings` | string[] | 替换前修剪的片段列表（每行一个） |
| `placement` | number[] | 应用位置（见下 `regex_placement`） |
| `disabled` | boolean | 是否禁用 |
| `markdownOnly` | boolean | 仅对 markdown 显示生效 |
| `promptOnly` | boolean | 仅对 prompt 生效 |
| `runOnEdit` | boolean | 编辑时是否执行 |
| `substituteRegex` | number | `0`=NONE、`1`=RAW、`2`=ESCAPED（`substitute_find_regex`） |
| `minDepth` | number\|null | 最小深度（-1 及以上生效） |
| `maxDepth` | number\|null | 最大深度（0 及以上生效） |

`regex_placement` 枚举（regex/engine.js:281–289）：
`0`=MD_DISPLAY（已废弃）· `1`=USER_INPUT（用户输入）· `2`=AI_OUTPUT（AI 输出）· `3`=SLASH_COMMAND（斜杠命令）· `5`=WORLD_INFO（世界书）· `6`=REASONING（推理）；旧值 `4`（sendAs）已被迁移（index.js:1400–1405）。

---

## bias_presets 结构

- 全局设置：`oai_settings.bias_presets`（openai.js:115–128 默认，`default_bias_presets`）。
- 结构：**以预设名为键的对象（record）**，值为**数组**，数组元素 `{ id, text, value }`：
  | 字段 | 类型 | 说明 |
  |---|---|---|
  | `id` | string | UUID（`createNewLogitBiasEntry` 用 `uuidv4()`，openai.js:4571） |
  | `text` | string | 被偏置的 token/文本（如 `' bond'`） |
  | `value` | number | 偏置权重（如 -50、-25、100） |
- 默认：`{ 'Default (none)': [], 'Anti-bond': [{id, text:' bond', value:-50}, {id, text:' future', value:-50}, {id, text:' bonding', value:-50}, {id, text:' connection', value:-25}] }`。
- 关联字段：`oai_settings.bias_preset_selected`（当前选中的 preset 名，字符串）；preset body 中只有 `bias_preset_selected`（可能不含 `bias_presets`，见 custom-request.js:584 的兼容说明）。
- 导出时以 `JSON.stringify(oai_settings.bias_presets[oai_settings.bias_preset_selected])` 发送（openai.js:3307）。

---

## 关键结论速览

- **新系统主宏 89 个**（utility 11 / random 3 / names 5 / character 13 / chat 9 / time 8 / variable 14 / prompts 19 / state 7），另 **27 个别名**（5 个隐藏）。
- **旧系统独有**：`<USER> <BOT> <CHAR> <CHARIFNOTGROUP> <GROUP>`、`{{time_UTC±N}}`；同名的 `reverse`/`banned`/instruct 键有语法或命名差异。
- **不存在的结构**：`{{#each}}`、`{{stop}}`、`{{only}}`、`{{env::…}}`、`{{:else}}`。
- **OpenAI preset 顶层字段 102 个**（含 37 个连接字段），prompt 元素 13 个字段，regex 脚本 13 个字段，bias 条目 3 个字段。
