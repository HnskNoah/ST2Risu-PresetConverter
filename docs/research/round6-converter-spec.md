# Tavern → Risu 通用转换器:规格 v1(第 6 轮)

日期:2026-08-09
输入:三路子代理调研(Risu 自带 ST 导入 / 宏对照表 / Risu 正则脚本完整能力)+ 既有 round1-5 结论
目标:可执行的技术规格,直接支撑转换器 v1 的编写

---

## 0. 定位(为什么值得做)

Risu 官方 `importPreset` 的 ST 分支只转 7 个字段(`database.svelte.ts:2392-2496`):temperature/frequency_penalty/presence_penalty/top_p/prompt_order[0]/prompts/assistant_prefill。
`extensions.regex_scripts` 全源码 **0 命中**——**官方完全不转正则脚本**。本转换器填补的是官方空白,不是重复劳动。

---

## 1. 输入 / 输出 / 报告

- **输入**:SillyTavern OpenAI 系 preset JSON(含 `extensions.regex_scripts`)。
- **输出**:Risu `botPreset` 裸 JSON(经 `importPreset` json 分支可导入)+ 一份差异报告。
- **检测启发式**(复用官方):`Array.isArray(pre?.prompt_order?.[0]?.order) && Array.isArray(pre?.prompts)` → ST preset(`database.svelte.ts:2392`)。严格版再加 `chat_completion_source`(`prompt.ts:111`)。

---

## 2. 顶层字段映射表

| Tavern 字段 | Risu 字段 | 规则 |
|---|---|---|
| `temperature` | `temperature` | `×100`(官方 `:2400`) |
| `frequency_penalty` | `frequencyPenalty` | `×100`(官方 `:2401`) |
| `presence_penalty` | `PresensePenalty` | `×100`;**不要抄官方 `×0.7` 与无兜底 bug**(`database.svelte.ts:2402`,缺失会产生 NaN,官方真 bug) |
| `top_p` | `top_p` | 直通(官方 `:2403`) |
| `top_k` / `top_a` / `min_p` / `repetition_penalty` | 同名 | 直通(**官方不转,我们补上**,字段存在 `setPreset:2206-2214`) |
| `openai_max_context` | `maxContext` | 直通(**官方不转**,默认 4000) |
| `openai_max_tokens` | `maxResponse` | 直通(**官方不转**,默认 300) |
| `name` | `name` | 直通(**官方硬编码 "Imported ST Preset" `:2493`,我们修复**) |
| `seed` / `n` / `stream_openai` / `squash_system_messages` / `max_context_unlocked` / `names_behavior` / `media_inlining` / `assistant_prefill`(除 prompt 处理外) / `assistant_impersonation` / `use_sysprompt` / `inline_image_quality` | — | **丢弃 + 报告** |
| `apiType` / `chat_completion_source` / 模型字段 | `apiType` / `aiModel` | 尽力映射,否则保留 Risu 默认 + 报告 |
| `bias_preset_selected` | `bias`(仅当提供 ST 全局 bias_presets) | **preset 文件只有选中项名字**(`openai.js:362`,isConnection=false),条目内容在 ST 全局 `bias_presets`(`:424-425`,`{id,text,value}[]`),不随 preset 导出 → 需转换器**额外输入 ST 全局 bias_presets** 才能映射 `{text,value}`→`[text,value]`(id 丢弃);否则报告 manual:提示"bias preset 'X' 需从 ST 全局设置迁移"。Risu 侧:`bias:[string,number][]`(`database.svelte.ts:1603`),text 运行时会过 `risuChatParser`(`index.svelte.ts:1156`)并 tokenize(`requests.ts:185-200`,支持 `[[tokenid]]`/`value=-101` strongBan) |

## 3. prompts → promptTemplate 映射

**直接复用官方映射表**(`database.svelte.ts:2411-2474` 与 `prompt.ts:170-233` 一致),并修复官方缺陷:

| ST identifier | 生成卡 | 官方行为 | 我们的处理 |
|---|---|---|---|
| `main` | `{type:'plain', type2:'main', text, role}` | 转 | 同 |
| `jailbreak` / `nsfw` | `{type:'jailbreak', ...}` | 转 | 同 |
| `chatHistory` | `{type:'chat', rangeEnd:'end', rangeStart:0}` | 转 | 同 |
| `worldInfoBefore` | `{type:'lorebook'}` | 转 | 同;`wi_format` → 填 `innerFormat`(官方漏) |
| `charDescription` | `{type:'description'}` | 转 | 同;`scenario_format` → `innerFormat` |
| `personaDescription` | `{type:'persona'}` | 转 | 同;`personality_format` → `innerFormat` |
| `dialogueExamples` / `charPersonality` / `scenario` | — | **丢弃**(`break //ignore` `:2431-2435`) | 默认丢弃,策略开关可改为 plain 卡 |
| `worldInfoAfter` | — | **丢弃**(`:2450-2452`) | 默认丢弃,策略开关可合并进 lorebook |
| `enhanceDefinitions` / 其他自定义 | `{type:'plain', type2:'normal', ...}` | 转(default) | 同(报告"降级") |
| `assistant_prefill` | postEverything + `{{#if {{prefill_supported}}}}` 模板 | 转(`:2481-2491`) | 同 |

- 顺序:仅驱动 `prompt_order[0].order`(官方 `:2405`;多角色组只取第一组,报告提示)。`enabled=false` 跳过,找不到 `console.log`。
- role 归一化:官方 `normalizePromptTemplate`(`:2524-2556`)/`normalizeImportedPromptRole`(`prompt.ts:93-101`),`assistant/char→bot`,非法→`system`。我们复用同一规则。
- **prompt 级丢弃字段**(round4 §2.2 独有):`injection_trigger`(impersonate/continue)、`injection_order`、`forbid_overrides` → **无对应,丢弃 + 报告**;`injection_position`(RELATIVE/ABSOLUTE)由数组顺序承载(无绝对/相对区分);`injection_depth` 需换算成 chat 卡 range,无等价语义。
- **nudge/格式串系列**(round4 §2.4 独有):`group_nudge_prompt`/`impersonation_prompt`/`new_chat_prompt`/`new_group_chat_prompt`/`continue_nudge_prompt`/`send_if_empty`/`new_example_chat_prompt` → **无等价**:开场/续写/扮演引导转 `{{firstmsg}}` 逻辑或触发器;`wi_format`/`scenario_format`/`personality_format` → description/chat 卡 `innerFormat`(模板化替换 `{0}`/`{lastChatMessage}` → Risu CBS)。

## 4. 正则脚本:13 字段 → customscript 规则(核心)

**Risu 侧完整能力**(子代理确认):
- 数据模型仍 6 字段(`database.svelte.ts:1307-1315`),但 `flag`/`out` 是能力容器:
  - flag 字符串 = 标准 flag(`dgimsuvy`,白名单 `scripts.ts:167`)+ `<...>` 标签指令;UI 只暴露 `g/i/m/u/s` + 5 个按钮,`d/v/y` 和 `<inject>` 需手写。
  - actions 指令:`<order n>`(降序执行,`scripts.ts:307-310,332-334`)、`<cbs>`(IN 宏展开,`:177-179`)、`<inject>`(回写消息+删除,`:207-211`)、`<move_top>`/`<move_bottom>`(删+拼到顶/底,`:213-246`)、`<repeat_back>`(匹配失败回溯上一条同角色消息,`:252-287`)、`<no_end_nl>`(防尾部补 `\n`,`:163-165`)。
  - out `@@` 前缀:`@@emo`/`@@inject`/`@@move_top`/`@@move_bottom`/`@@repeat_back [end|start|end_nl|start_nl]`;`{{data}}`=`$&`(`:15,155`)。
  - type 枚举实际 6 个:`editinput/editoutput/editprocess/editdisplay` + `edittrans`(翻译器专用,残废版)+ `disabled`(UI 值)。
  - **`<...>` 解析仅在 `ableFlag=true` 时发生**(`:299`)。
- 深度过滤:**无内建**,唯一方案 = OUT 内嵌 `{{#if}}`(round5 §7)。

**逐字段映射**:

| Tavern 字段 | 处理 |
|---|---|
| `findRegex` | → `in`。语法兼容(两边 JS RegExp);`/pattern/flags` 形式拆出 flag 合并进 Risu flag(注意:Tavern 支持的 `X/A/J` 等 Risu 白名单 `dgimsuvy` 之外 → 报告,删掉或改内联) |
| `replaceString` | → `out`。`{{match}}`→`$&` 等价;`$1`~`$99` 与 `$<name>`(命名组)原生兼容;**字面 `$n` 不行**:Risu 在一切替换前先 `replaceAll("$n","\n")`(`scripts.ts:154`),`$n` 恒变换行,`$$n` 转义无效;若 out 以 `>` 结尾 → 加 `<no_end_nl>`(否则 Risu 自动补 `\n`,Tavern 不加) |
| `placement` 数组 | 拆 type:`USER_INPUT(1)`→`editinput`;`AI_OUTPUT(2)`→`editoutput`(仅显示分支 `editdisplay`);`SLASH_COMMAND(3)`/`REASONING(6)`/`WORLD_INFO(5)` → **报告:无对应,丢弃或按 §5 提示** |
| 三分法 | `markdownOnly&&!promptOnly`→`editdisplay`;`promptOnly&&!markdownOnly`→`editprocess`(发请求前处理最贴近 `script.js:4447`);**双开**→拆 `editdisplay`+`editprocess` 两脚本;都 false(默认路径,`cleanUpMessage`/用户输入)→`editoutput`+`editinput` |
| `minDepth`/`maxDepth` | → OUT 包 `{{#if {{and::greaterequal(chatindex,last-max)::lessequal(chatindex,last-min)}}}}$&{{/if}}`,加 `ableFlag=true`+`<cbs>`;`in` 需吞尾换行(round5 §7)。宏名是 `greaterequal`/`lessequal`(`cbs.ts:927,936`),**无 `ge`/`le`** |
| `trimStrings` | **丢弃 + 报告**(无等价);高价值可手动焊进 out,不做通用 |
| `runOnEdit` | **丢弃 + 报告**(无等价,Risu 略宽松) |
| `substituteRegex` | `0`→无;`1(RAW)`→`<cbs>` + §6 宏翻译;`2(ESCAPED)`→**报告:需人工**(静态转不了运行时转义) |
| `disabled` | 跳过不生成,报告计数 |
| 顺序 | 数组内相对顺序 → 按 index 分配 `<order>`(Risu 降序先执行,故 index 越小 order 越大,保持原序) |
| `id`/`scriptName` | → `comment`(scriptName 前置 `[名]`),id 丢弃 |

## 5. 隐藏能力利用(把"丢弃"变"可用")

| Tavern 需求 | Risu 方案 |
|---|---|
| "检测到 X → 从该消息删除并塞到文本开头/结尾" | `<move_top>`/`<move_bottom>`(注意:只处理首个匹配,`g` 被临时移除 `scripts.ts:160-162`) |
| "把处理结果写回历史消息 + 本处删除" | `<inject>`(要求 chatID≠-1,即 editinput 不生效) |
| "匹配失败时去上一条同角色消息补刀" | `<repeat_back [end|start|end_nl|start_nl]>` |
| 情绪切换 | `@@emo <name>` |
| 执行优先级 | `<order n>` |
| 深度过滤(无内建) | OUT `{{#if}}`(§4) |
| 位置注入(用户消息后等) | **无等价**,改用 Lorebook `@@inject_at`/`@@inject_lore`(另一体系) |

## 6. 宏翻译表(A/B/C/D)

来源:Tavern `macros/definitions/*.js` + `macros.js`;Risu `cbs.ts` 全量 + 规范化 `parser.svelte.ts:1055`(小写 + 删空格/下划线/连字符)。

**A 直通**(同名同义):`char`/`user`/`description`/`personality`/`scenario`/`persona`/`newline`(=Risu `br`)`/reverse`/`random::a::b`/`pick`/`roll`(Risu 不支持 `+N`)/`model`/`getvar`/`getglobalvar`/`maxContext`/`lastMessage`/`lastMessageId`/`//`/`noop`→`blank`。

**写变量宏(round9 修订)**:`setvar`/`addvar`/`setdefaultvar` **归入 manual 报告**,不是 A 直通。Risu 中三者仅 `runVar=true` 时执行(cbs.ts:816,832,851),prompt 卡渲染 `runVar=false` → 字面量残留、变量不写入。报告 reason 提示用触发器 effect / 消息重处理 / `customPromptTemplateToggle` 迁移。详见 `round9-risu-chatvar-runtime.md`。

**B 改写**(同名不同义):
| Tavern | Risu | 差异 |
|---|---|---|
| `time` | `time` | Tavern moment `LT`;Risu 24h 不补零/带参为格式串 |
| `isotime` | `isotime` | Tavern 本地 `HH:mm`;Risu **UTC** `HH:MM:SS`(含义相反) |
| `date` | `date` | 长格式 vs `YYYY-M-D` |
| `idleDuration` | `idleDuration` | 参照"最后用户消息" vs "最后消息";humanized vs `HH:MM:SS` |
| `trim` | `trim` | 作用域式 vs 字符串函数 |
| `random`(无参) | `random` | 空 vs 0~1 浮点 |
| `isMobile` | `metadata::mobile` | `true/false` vs `1/0` |
| `words` | 无 | Tavern 是 memory 扩展动态宏=整数,**不存在 `{{words::N}}` 随机词** |

**C 翻译**:
| Tavern | Risu |
|---|---|
| `charPrompt` | `mainprompt` |
| `charInstruction` | `jb` |
| `mesExamples(Raw)` | `exampledialogue` |
| `weekday` / `datetimeformat::fmt` | `date::dddd` / `date::fmt`(仅子集) |
| `{{if}}...{{else}}` | `{{#when}}...{{:else}}` |
| `hasExtension::x` | `moduleenabled::x` |
| `space::N` | 无(用 `cbr`) |

> **变量写宏(round9 修订,延伸)**:`incvar`/`decvar` **不翻译为 `addvar::n::1`**(Risu 无此二宏,且翻译后 `addvar` 仍仅 `runVar=true` 执行)。与 `setvar`/`addvar`/`setdefaultvar` 一样**归入 manual 报告**,保留原名。`addglobalvar`/`incglobalvar`/`decglobalvar`/`hasvar`/`deletevar`/`hasglobalvar`/`deleteglobalvar` 同理(Risu 无等价或仅触发器/UI 可写)。

**D 原样保留(安全)**:Risu 对未知宏透传(`parser.svelte.ts:1771-1774`),Tavern 同 → 未匹配宏原样保留即可:`group`/`groupNotMuted`/`notChar`/`charPrompt`/`instruct*`/`creatorNotes`/`greeting`/`summary`/`charPrefix` 等。

**规则**:输出统一小写无分隔形式(Risu 规范化保证命中);`{{random a,b}}` 空格语法 → `{{random::a::b}}`。

## 7. 差异报告 schema

```jsonc
{
  "source": "preset名",
  "summary": { "converted": 0, "dropped": 0, "degraded": 0, "manual": 0 },
  "sections": {
    "topLevel": [ { "field": "seed", "action": "dropped", "reason": "Risu botPreset 无对应字段" } ],
    "regex": [ { "scriptName": "...", "action": "dropped|degraded|manual|split", "fields": ["trimStrings"], "reason": "...", "suggestion": "..." } ],
    "prompts": [ { "identifier": "scenario", "action": "dropped", "reason": "Risu 官方丢弃,可开策略转 plain" } ],
    "macros": [ { "macro": "{{group}}", "action": "kept-unknown", "reason": "Risu 透传,行为不保证" } ]
  }
}
```

## 8. 已知边界(写入报告的"手动"类)

- 群聊不跑触发器(`request.ts:247` 等)——若深度方案走触发器则群聊失效;OUT 方案无此问题。
- `editinput` 的 chatID=-1 → `<inject>`/`<repeat_back>` 静默不生效(`scripts.ts:207,252`)。
- `edittrans` 引擎是残废版:无 `<...>` 解析、flag 含 `<` 直接抛异常(`translator.ts:633`)——**不要给 edittrans 脚本生成任何标签**。
- 世界书内容不过正则脚本(round3)——WORLD_INFO 型正则转过去是死代码,报告。
- `<move_top>` 只处理第一个匹配(`scripts.ts:160-162` 临时移除 `g`)。
- Risu 官方 `presence_penalty` 有 `×0.7`+NaN bug(§2),我们绕过。

## 9. 实现形态建议

模块化纯函数(便于 CLI + Web 复用):
```
parseST(json) → {topLevel, regexScripts, prompts, promptOrder, meta}
mapFields(topLevel) → {risuFields, warnings}
mapRegex(script) → customscript[]   // 可拆 1..2 个,含深度 OUT 生成
mapPrompts(prompts, order, formats) → PromptItem[]
translateMacros(text) → {text, warnings}
compose(parts) → {preset, report}
```
- 深度 OUT 生成器与宏翻译表独立成表驱动数据,便于维护。
- 输出 `.json` 裸格式(`importPreset` 走 json 分支);`.risup` 容器留作 phase 2(配方已从网站调研拿到)。

## 10. 复用资产清单

| 来源 | 可复用 |
|---|---|
| Risu 官方 `importPreset` ST 分支 | prompt 映射表、检测启发式、role 归一化、assistant_prefill 模板 |
| Risu `cbs.ts` + `parser.svelte.ts:1055` | 宏全表、名称规范化规则 |
| Risu `scripts.ts` | flag/out 能力容器清单、尾部 `>` 与 no_end_nl |
| round5 §7 | 深度 OUT `{{#if}}` 生成公式与源码证据 |
| 网站调研(subagent) | `.risup`/`.risupreset` 加解密管线(phase 2) |

---

## 11. 跨子系统决策(能力全景补充,详见 round6-risu-capabilities.md)

| 决策点 | 结论 | 证据 |
|---|---|---|
| 状态标记(检测→置 flag) | **落触发器**(`exists` 条件 + `setvar`/`v2SetVar` effect);正则 OUT **只可读不可写**(runVar=false) | `scripts.ts:248,291` vs `triggers.ts:1568-1604`;`cbs.ts:813,829,845` |
| 命中→显示图片/音频/情绪 | `editdisplay` 正则 OUT 引 `{{image/audio/bgm/bg/emotion::name}}`;情绪用 `@@emo <name>`(仅 editdisplay);注意副作用缓存 | `parser.svelte.ts:747-762`;`scripts.ts:184-206,68-97` |
| 深度过滤 | **消息文本级**→OUT `{{#if}}`;聊天级搜索→触发器 `exists depth`/`v2QuickSearchChat`(无真 min/max 区间,需组合两次 depth+v2IfAdvanced) | `triggers.ts:1296-1309,2432-2454` |
| WORLD_INFO(5) 型正则 | **落世界书** `useRegex`+装饰器(注意:匹配原始文本、命中=注入非替换、无 wi_format 等价物、`{{setvar}}`/`{{chatindex}}` 在世界书无效) | `lorebook.svelte.ts:145-172,572-576`;`cbs.ts:415` |
| 翻译后处理 | 仅 `edittrans` 槽位;别给它生成 `<...>` 标签(残废引擎会抛异常);翻译结果不过 editprocess/output | `translator.ts:621-639` |
| 群聊 | 成员级正则/世界书在 Risu 群聊**不生效**,需下沉群 `customscript`/`globalLore`;request/display 触发器跳过群 | `scripts.ts:106`;`request.ts:241-248`;`lorebook.svelte.ts:79-82` |
| 打包分发 | **模块** `.risum`/`.charx`(regex+trigger+lorebook+assets+cjs 一体),`moduleIntergration` 随预设携带;模块无 variables 字段,默认变量用 trigger 初始化 | `modules.ts:19-35,398-427` |
| 变量写入路径 | 全局变量**无 setglobalvar 宏**,只能 toggle/UI;聊天级变量用触发器写 | `chatVar.svelte.ts`;`cbs.ts:861` |
| ST 变量初始化卡(`{{setvar::x::内容}}`) | **不落 prompt 卡**:卡内 setvar 不执行(runVar=false,字面量残留)。落**触发器 setvar effect** + `{{#when}}`/`{{getvar}}` 读;或迁 `customPromptTemplateToggle` + `{{getglobalvar::toggle_x}}` | round9 §4-6;`cbs.ts:816,832,851`;`index.svelte.ts:146` |
| REASONING 正则 | 用原生思考参数替代(thinkingType/thinkingTokens/reasonEffort),而非正则提取 | `anthropic.ts:364-383`;`shared.ts:311` |
| Instruct/格式串 | `instructChatTemplate`/`JinjaTemplate`/`systemContentReplacement`/`ooba.formating` 分场景承接;无单一 1:1 字段 | `chatTemplate.ts:27-38`;`request.ts:353-358` |
| Tavern Instruct preset(独立文件,不在 OpenAI preset 内) | **需单独转换**:`input_sequence`/`output_sequence`/`system_prompt`/stop 序列 → `instructChatTemplate` 或 Jinja 模板;现有转换未做,列为 phase 2 | round4 §4 |

**触发器使用边界**(转换器生成触发器时):display/request 模式被 allowlist 沙箱化(不能读历史、变量不落盘);`{{chatID}}` 恒 -1;V1 已弃用(用 V2);无否定条件;递归上限 10;低权限效果需模块/角色 lowLevelAccess。

