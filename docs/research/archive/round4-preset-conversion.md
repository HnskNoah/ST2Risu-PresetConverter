# Tavern → Risu preset 转换缺口分析 — 第 4 轮调研

日期:2026-08-09
范围:把 SillyTavern preset(JSON)转换为 RisuAI bot preset 需要的完整映射与缺失项,重点覆盖"酒馆 preset 现在在 extensions 里带正则(regex_scripts)"这一新情况
方法:两路子代理并行核实双方 preset schema + 对工作区现有转换产物(`rius/preset/converted_risu (2).json`)做实际比对
原始报告:见 `round4-risu-preset.md`、`round4-tavern-preset.md`

---

## 0. 现状诊断(实测)

| 项目 | 酒馆 preset(示例) | Risu 转换产物 `converted_risu (2).json` |
|---|---|---|
| `extensions.regex_scripts`(PRESET 作用域正则) | **12 个脚本**(含 findRegex/replaceString/placement/substituteRegex/minDepth/maxDepth/markdownOnly/promptOnly/trimStrings) | **`regex: []`(空的)** — 正则**完全没转** |
| `prompts`(98 个可视化 prompt) | 存在 | `mainPrompt/jailbreak/globalNote` 字段在,但**98 个 prompts 未展开为 promptTemplate** |
| `prompt_order`(角色→顺序) | `{character_id:100001, order:[...]}` | `formatingOrder` 是 9 项默认列表,未反映 prompt_order |
| 采样器 | `temperature/frequency_penalty/presence_penalty/top_p/top_k/top_a/min_p/repetition_penalty` | `temperature/frequencyPenalty/PresensePenalty/top_p/top_k/top_a/min_p/repetition_penalty`(有映射) |
| `openai_max_context`/`openai_max_tokens` | 存在 | `maxContext/maxResponse`(有映射) |
| `extensions.SPreset`/`tavern_helper` | 存在(第三方扩展) | 不存在(丢失) |
| `bias_preset_selected` | 指向命名 bias preset | Risu `bias` 为裸 `[string,number][]`,命名 preset 库无对应 |
| `seed`/`n`/`stream_openai`/`max_context_unlocked` | 存在 | 无对应字段 |

**核心结论:现有转换只做了"采样器 + 简单 prompt 字段"级别的搬运,最关键的 `regex_scripts`(12 个正则)和 `prompts`(98 个)两大数据源完全没有转换。** 下面给出完整缺口。

---

## 1. 正则转换:`extensions.regex_scripts` → `regex`(本次重点)

### 1.1 字段映射表

| Tavern `RegexScriptData`(char-data.js:88-102) | Risu `customscript`(database.svelte.ts:1307-1315) | 转换规则 |
|---|---|---|
| `scriptName` | `comment` | 直接复制 |
| `findRegex` | `in` | 直接复制(见 §1.3 宏/转义差异) |
| `replaceString` | `out` | 直接复制(见 §1.4 `$n` 等差异) |
| `placement[]` + `markdownOnly` + `promptOnly` | `type` | 见 §1.2 映射决策表 |
| `disabled` | `type: 'disabled'` | 禁用脚本 → `type='disabled'` |
| `substituteRegex`(0/1/2) | `flag` 里的 `<cbs>` | `substituteRegex≠0` → `ableFlag=true` 且 `flag` 追加 `<cbs>`(见 §1.3) |
| `runOnEdit` | 无对应 | Risu 的 editinput/editoutput 默认即处理编辑/重卷;`runOnEdit=false` 需**人工确认**(Risu 无等价开关) |
| `minDepth`/`maxDepth` | 无对应 | **丢弃**(Risu 正则无深度过滤) |
| `trimStrings[]` | 无对应 | **丢弃**(Risu 无 trim 能力;若重要需改写到 `out` 或换逻辑) |
| `id`(UUID) | 无 | 丢弃 |

### 1.2 placement → type 映射决策表

| Tavern 特征 | 目标 Risu `type` |
|---|---|
| `placement` 含 `USER_INPUT(1)` 且 `promptOnly` | `editinput` |
| `placement` 含 `AI_OUTPUT(2)` 且 `promptOnly` | `editoutput` |
| `placement` 含 `WORLD_INFO(5)` 或 `SLASH_COMMAND(3)` / `REASONING(6)` | **Risu 无对应放置点** → 需并入最接近的模式或标记为需人工处理 |
| `markdownOnly=true` 且 `promptOnly=false` | `editdisplay`(仅显示) |
| `markdownOnly=false` 且 `promptOnly=true` | `editinput`/`editoutput`/`editprocess`(按 placement) |
| 两者都 false(默认路径:流式收尾/开场白/编辑) | `editoutput`(最接近)或 `editprocess`,需人工确认 |
| 一个脚本同时含多个 placement | **Risu 单脚本单 type** → 需拆分成多个 Risu 脚本 |

**注意(实测)**:示例 preset 里 `placement:[2] + markdownOnly:true`(AI_OUTPUT 仅显示),应映射为 `editdisplay`;但同一脚本的 replaceString 包含大量 HTML `<style>/<details>` 包装 —— 这类"显示美化型"脚本在 Risu 中对应 `editdisplay` 是合理的。

### 1.3 findRegex 的宏差异(`substituteRegex` → `<cbs>`)

- Tavern:`substituteRegex=RAW(1)` 时 findRegex 先 `substituteParamsExtended`(宏展开);`ESCAPED(2)` 还转义正则元字符。
- Risu:仅当 flag 含 `<cbs>` 时 IN 才做 CBS 解析(`scripts.ts:262-264`)。转换时:
  - RAW → `ableFlag=true, flag='gi<cbs>'`(把 `{{}}` 宏转成 Risu CBS 语法);
  - ESCAPED → 需要在转换工具里先做"宏替换 + 转义"的等效计算,再当作字面正则给 `in`(Risu 无等价"替换后转义"能力);
  - NONE(0)→ 直接给 `in`,不加 `<cbs>`。
- **宏语法本身也要翻译**:Tavern `{{char}}/{{user}}/{{time}}` 等在 Risu CBS 中基本同名,但 Tavern 特有宏(`{{pick}}`、`{{banned}}`、`{{idleDuration}}`、`{{outlet}}`、`{{maxPrompt}}` 等)在 Risu 无等价,需查 Round 2 的宏对照表逐项改写或保留字面。

### 1.4 replaceString 的差异

| 项 | Tavern | Risu | 转换 |
|---|---|---|---|
| 换行 `$n` | 无(`\n` 直接写) | OUT 里字面 `$n` 会在一切替换前被 `replaceAll("$n","\n")` 转成换行(`scripts.ts:154`) | **`$$n` 转义无效**(replaceAll 先跑,`$$n` 里的 `$n` 仍被吃掉 → `$\n`);字面 `$n` 无法表达,需改其他占位符或接受 `\n` 语义 |
| 命名组 | `$<name>` | `$<name>`(有效)、`$(name)`(无效) | 统一用 `$<name>` |
| 尾部 `>` 自动补换行 | 无 | Risu OUT 以 `>` 结尾会自动 `+\n` | 若不需要可用 `no_end_nl` action |
| 宏 | replaceString 恒被宏替换 | OUT 替换后必再过 CBS | 宏语法按 Round 2 翻译 |
| `{{match}}` | 整段匹配 | `{{data}}` → `$&` | `{{match}}` → `$&` 或 `{{data}}` |

---

## 2. Prompt 系统转换:`prompts` + `prompt_order` → Risu

Tavern 的 prompt 是 **98 个 prompt 对象 + 按 character_id 的 order**(每个都有 `injection_position/depth/order/role/enabled/injection_trigger`)。Risu 只有两套并列方案:legacy(`mainPrompt/jailbreak/globalNote/formatingOrder`)或新版 `promptTemplate`(PromptItem 卡片数组)。

### 2.1 决策:转换目标用哪套?

**推荐转 `promptTemplate`**(因为 Tavern 本身就是"有序卡片"模型,与 Risu PromptItem 一一对应)。Risu 会自动 `normalizePromptTemplate` 并校验(templateCheck 要求恰 1 个 main + 1 个 globalNote + description + lorebook + 一个 `rangeEnd:'end'` 的 chat 卡)。

### 2.2 映射表(Tavern Prompt → Risu PromptItem)

| Tavern prompt 字段 | Risu PromptItem | 备注 |
|---|---|---|
| `content`(system_prompt=true / marker=false) | `{type:'plain', text:content}` | 普通文本卡 |
| `identifier==='main'` | `{type:'plain', type2:'main', text}` | Risu 主提示槽 |
| `identifier==='jailbreak'` | `{type:'jailbreak', text}` 或 `{type:'plain', type2:'normal'}` | |
| `role` | `role`/`role2`(归一化:assistant/char→bot) | normalizePromptTemplate 处理 |
| `marker=true`(chatHistory/dialogueExamples/worldInfo 占位) | `{type:'chat', rangeStart, rangeEnd:'end'}` / `{type:'description'}` / `{type:'lorebook'}` | marker 占位 → 对应 Risu 区块槽位卡 |
| `injection_depth` | chat 卡的 range / depth 类卡 | Tavern 深度注入语义≠Risu 的 chat 切片,需换算 |
| `injection_position`(RELATIVE/ABSOLUTE) | 卡片在数组中的顺序 | Risu 顺序=数组顺序,无绝对/相对区分 |
| `injection_order` | 无 | 排序靠数组顺序 |
| `injection_trigger`(impersonate/continue) | 无 | **丢弃或人工** |
| `enabled` | 是否保留该卡 | false 的直接丢弃 |
| `forbid_overrides` | 无 | 丢弃 |

### 2.3 prompt_order 的消耗

- Tavern `prompt_order` 是 `{character_id, order:[{identifier,enabled}]}`,是**每角色**的。Risu 的 promptTemplate 是**预设级单一份**。
- 转换策略:只取 `character_id===100000`(global 策略的 dummy)那一份,按其中 `enabled=true` 的 identifier 顺序重排 prompt 数组。其余角色的个性化 order **无法表达**。

### 2.4 其余格式串(无 Risu 对应,需人工/丢弃)

`wi_format`、`scenario_format`、`personality_format`、`group_nudge_prompt`、`impersonation_prompt`、`new_chat_prompt`、`new_group_chat_prompt`、`continue_nudge_prompt`、`send_if_empty`、`new_example_chat_prompt` —— Tavern 用它们包装世界书/场景/性格/开场/续写。Risu 中:
- 场景/性格包装 → 可以做成 promptTemplate 的 `description` 卡 innerFormat,或直接拼进角色卡(转换器需做模板化替换,把 `{0}`/`{lastChatMessage}` 换成 Risu CBS);
- 开场/续写/扮演引导 → **Risu 无等价** → 需转换为 `{{firstmsg}}` 逻辑或触发器。

---

## 3. 采样器与 token 参数映射

| Tavern | Risu | 备注 |
|---|---|---|
| `temperature` | `temperature` | Risu 内部 ×100 存储,导入时 /100 |
| `frequency_penalty` | `frequencyPenalty` | |
| `presence_penalty` | `PresensePenalty` | 注意 Risu 拼写 `Presense` |
| `top_p` | `top_p` | |
| `top_k` | `top_k` | |
| `top_a` | `top_a` | |
| `min_p` | `min_p` | |
| `repetition_penalty` | `repetition_penalty` | |
| `openai_max_context` | `maxContext` | |
| `openai_max_tokens` | `maxResponse` | |
| `seed` / `n` | **无对应**(Risu 无 seed/n 顶层字段) | 丢弃(部分模型走 `seperateParameters` 也没有) |
| `max_context_unlocked` | 无 | 丢弃 |

---

## 4. Instruct / 模板转换

- Tavern 的 Instruct preset(独立 `instruct` 目录)+ Context preset 是**独立 preset 文件**,不在 OpenAI preset JSON 里;但 OpenAI preset 的 `prompts` 体系是 CC 模式。转换时需判断目标 Risu 走哪种:
  - 若源 preset 是 CC(`prompts` 有内容)→ Risu 用 `promptTemplate`(ChatML 卡 / plain 卡);
  - 若源是 Instruct 文本补全 → Risu 用 `instructChatTemplate`(如 `"chatml"`)或 `JinjaTemplate`。**Tavern 的 Instruct preset 需要单独转换**(input_sequence/output_sequence/system_prompt/stop 序列 → Risu instructChatTemplate 或 Jinja 模板),这一步现有转换完全没做。
- `useInstructPrompt` ↔ Risu 的 `useInstructPrompt` 直接映射。

---

## 5. API / 连接字段

| Tavern | Risu | 备注 |
|---|---|---|
| `chat_completion_source` | `apiType` | 需把 Tavern 的 source 枚举映射到 Risu 的 apiType 枚举 |
| `openai_model` 等 `*_model` | `aiModel` / `seperateModels` | 连接类字段默认不随 preset,受 `bind_preset_to_connection` 控制 |
| `reverse_proxy` | `forceReplaceUrl` / `reverseProxyOobaArgs` | |
| 各 provider key | `proxyKey`/`openAIKey` 等 | 导出时两边都会清敏感字段 |
| Instruct/Context/Sysprompt preset | `instructChatTemplate`/`JinjaTemplate`/`mainPrompt` | 需额外转换独立 preset |

---

## 6. 完全无对应项(转换必然丢失,需人工)

1. **`extensions.regex_scripts` 的 `minDepth/maxDepth/trimStrings/runOnEdit`**:Risu 正则没有这些能力(见 Round 1)。
2. **Tavern 命名 bias preset**(`bias_presets` 字典 + `bias_preset_selected`):Risu `bias` 是裸数组,需把选中的命名 preset 内容展开成 `[string,number][]`。
3. **`seed`/`n`/`stream_openai`/`max_context_unlocked`/`squash_system_messages`/`assistant_prefill`/`assistant_impersonation`**:Risu 无顶层字段。
4. **`extensions.SPreset`/`extensions.tavern_helper`**(第三方扩展数据):Risu 无扩展槽概念,直接丢弃。
5. **每角色的 `prompt_order`**(非 global 策略):Risu 预设只有一份模板。
6. **`injection_trigger`/`forbid_overrides`/`marker` 的部分语义**:Risu 无。

---

## 7. 建议的转换器实现要点(基于本次调研)

1. **先把 `extensions.regex_scripts` 转成 `regex`**(§1 映射表),按 placement+markdownOnly/promptOnly 决策出 `type`,必要时单脚本拆多脚本。
2. **把 `prompts`+`prompt_order`(取 character_id==100000 的 enabled 顺序)转成 `promptTemplate` 卡片**,普通文本→plain 卡,marker 占位→chat/description/lorebook 卡。
3. **采样器/上下文按 §3 映射**,temperature 注意 /100。
4. **Instruct preset 单独转换**(§4),若源是 CC 则走 promptTemplate。
5. **显式产出"丢弃清单"**(§6),让用户人工确认 lossy 部分。
6. 可参考 Risu 已有的 `importPreset` ST 分支(`stChatConvert`,prompt.ts:156-253)——Risu 本身已有从 ST 格式生成模板卡的逻辑,转换器应优先复用/对齐它。

---

## 8. 一句话总结

> **做 Tavern→Risu preset 转换,现有产物只完成采样器 + 少量字段;真正缺的是 ① `extensions.regex_scripts`(12 个正则,需按 placement/markdownOnly/promptOnly 映射为 `regex` 数组、按 substituteRegex 决定 `<cbs>`、并丢弃 minDepth/trim/runOnEdit)、② `prompts`+`prompt_order`(98 个 → `promptTemplate` 卡片,取 global 策略顺序)、③ Instruct preset 独立转换、④ 一批无对应项(命名 bias/seed/n/第三方 extensions/每角色 order)的丢失清单。**
