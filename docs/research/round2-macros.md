# Risu vs SillyTavern 宏系统对比 — 第 2 轮调研

日期:2026-08-09
范围:宏/CBS 系统(语法、解析引擎、内置宏、自定义宏、与正则/prompt 联动、高级能力)
方法:两路子代理并行源码调研(Risu: `rius/risuai-src`,Tavern: `SillyTavern/SillyTavern-src`)

---

## 1. 总体架构对比

| 方面 | RisuAI | SillyTavern |
|---|---|---|
| 系统名 | CBS(Curly Bracket Syntax) | Macro 系统(两代引擎并存) |
| 核心文件 | `src/ts/parser/parser.svelte.ts`(解析器)、`src/ts/cbs.ts`(宏注册中心) | 新引擎 `public/scripts/macros/`(Chevrotain);旧引擎 `public/scripts/macros.js` |
| 入口函数 | `risuChatParser()`(parser.svelte.ts:1538) | `substituteParams()`(script.js:2922)→ 默认走新引擎 `MacroEngine.evaluate()` |
| 引擎类型 | 自研字符级状态机 + 注册表回调 | 旧:正则逐个替换;新:Chevrotain 词法/语法解析 + CST 遍历 |
| 引擎切换 | 无(单一实现) | `power_user.experimental_macro_engine`(默认 `true`,新引擎开启;旧引擎仅兼容) |
| 内置宏数量 | 约 171 个注册点(cbs.ts) | 数十个(按 core/env/state/chat/time/variable/instruct 分组) |

---

## 2. 宏语法对比

| 语法 | RisuAI | SillyTavern |
|---|---|---|
| 基础宏 | `{{name}}`、`{{name::arg::arg}}`(支持 `::` 与 `:` 分隔) | `{{name}}`、`{{name::arg::arg}}`,兼容单冒号/空格(`{{roll 1d6}}`) |
| 计算表达式 | `{{? 1+2*3}}`(`? ` 前缀,calcString 求值) | ❌ 无直接等价(用 `{{calc}}` 类宏?见下) |
| 块级控制流 | `{{#if}}...{{/}}`、`{{#when::op}}...{{:else}}...{{/}}`、`{{#each arr as v}}...{{slot::v}}...{{/}}` | `{{if}}...{{else}}...{{/if}}`(作用域宏) |
| 循环 | `{{#each}}`(数组遍历,支持嵌套) | ❌ 无循环宏(用斜杠命令 `/while`、`/times`) |
| 自定义函数 | `{{#func name args}}...{{/}}` + `{{call::name::arg}}` | ❌ 无 |
| 注释 | `{{// ...}}` | `{{// ...}}`(别名 comment) |
| 转义 | `risuEscape/Unescape`(私有 Unicode)+ `{{#escape}}` 块 + `{{bo}}/{{bc}}` 显示宏;**无 `\{{`** | `\{` `\}` post-processing 还原(**有 `\{{` 转义**) |
| 旧标记 | `<user>/<char>/<bot>` 预处理转 `{{user}}` 等 | `<USER>/<BOT>/<CHAR>/<CHARIFNOTGROUP>/<GROUP>` 预处理转 `{{}}` |
| 第二语法 | ❌ 无(`{%...%}` 不存在) | ❌ 无(`{%...%}` 不存在;story string 用 Handlebars,但语法仍是 `{{}}`) |

**关键差异**:
- Risu 语法系统是**图灵完备的自研模板语言**(块级 if/when/each/func/call + 表达式 + 转义块),Tavern 更"宏展开"导向(单层求值为主,控制流仅 `{{if}}`)。
- Tavern 新引擎有 flags:`#` 保留空白、`/` 闭合块(已实现);`!`/`?`/`~`/`>` 未实现。
- Risu 无 `\{{` 反斜杠转义(需用 `{{#escape}}` 或 `{{bo}}`);Tavern 有 `\{{`。

---

## 3. 解析引擎对比

### Risu(parser.svelte.ts:1538)
- 字符级状态机,`switch(da[pointer])`,`nested[]` 栈管理嵌套,逐字符扫描。
- 支持 HTML 属性内 `<...>` 作为第二类嵌套。
- 递归解析(宏回调内可再调 `risuChatParser`),**防爆栈:callStack > 20 直接报错**。
- 名称规范化:小写、去空格/下划线/连字符;未知宏**原样透传**。
- `#each` 通过"重写 da 字符串 + 继续解析"实现迭代。

### Tavern 新引擎(MacroEngine)
- Chevrotain 多模式词法器(`MacroLexer.js`)+ CstParser(`MacroParser.js`)+ CST 遍历器(`MacroCstWalker.js`)。
- 处理管线:pre-processors → parse → evaluate → post-processors。
- 嵌套宏自内向外求值;`delayArgResolution`(如 `{{if}}`)延迟参数求值。
- `globalOffset` 为 `{{pick}}` 等提供确定性种子。
- 注册表 `MacroRegistry`(键小写,含参数校验、别名、分类)。
- 未注册宏原样保留。

---

## 4. 内置宏能力对比(按功能域)

| 功能域 | RisuAI | SillyTavern | 备注 |
|---|---|---|---|
| 角色/身份 | `char/bot`、`user`、`role`、`trigger_id` | `user`、`char`、`group`、`notChar`、`charIfNotGroup` | 两者都有 |
| 提示词段落 | `personality/description/scenario/exampledialogue/persona/mainprompt/jb/globalnote/authornote` | `charPrompt/charInstruction/charDescription/charPersonality/charScenario/persona/mesExamples/charDepthPrompt/charCreatorNotes/charFirstMessage` | 字段命名不同,Tavern 更细分 |
| 历史/消息 | `previouscharchat/previoususerchat/userhistory/charhistory/history/lastmessage/lastmessageid/messagetime/messagedate/idleduration` 等 | `lastMessage/lastUserMessage/lastCharMessage/lastSwipeId/currentSwipeId/allChatRange/idleDuration/timeDiff` | 都有 |
| 时间/日期 | `time/date/isotime/isodate/unixtime/datetimeformat`(自定义格式) | `time/date/weekday/isotime/isodate/datetimeformat/idleDuration/timeDiff`,支持 `{{time::UTC±N}}` | 都有 |
| 随机 | `random/pick(哈希确定性)/roll/rollp(确定性掷骰)/randint/dice/hash` | `random(每次重掷)/pick(位置+内容稳定,可 `/reroll-pick`)` | Risu 随机工具更多 |
| 数学 | `min/max/sum/average/round/floor/ceil/abs/pow/tonumber/range/calc/{{? }}` | 少(主要由表达式系统/斜杠命令覆盖) | Risu 更强 |
| 字符串 | `startswith/endswith/contains/replace/split/join/spread/trim/length/lower/upper/capitalize/reverse/unicodeencode/...` | 少(trim/reverse 等) | Risu 更强 |
| 逻辑/比较 | `equal/notequal/greater/less/and/or/not/xor/{{#when}}` 链 | `{{if}}`(支持 `!`、变量简写、宏名解析) | 都有,Risu 块级更强 |
| 数组/对象 | `makearray/makedict/arraylength/arrayelement/dictelement/element/filter/all/any` 等 | 少(无内建数组宏) | Risu 独有 |
| 变量 | `setvar/getvar/addvar/setdefaultvar/getglobalvar/settempvar/tempvar`(4 层作用域) | `setvar/addvar/incvar/decvar/getvar/hasvar/deletevar`(本地)+ `setglobalvar/...`(全局)+ **变量简写表达式**(`.var`、`$var++`) | 都有;Tavern 有语法级变量表达式 |
| 显示/HTML | `br/cbr/bo/bc/button/comment/tex/ruby/codeblock/risu` 等 | 无(显示能力弱) | Risu 独有 |
| 加密 | `xor/xordecrypt/crypt` | ❌ | Risu 独有 |
| 模型/元数据 | `model/maxcontext/prefillsupported/moduleenabled/chatindex/firstmsgindex` 等 | `model/isMobile/lastGenerationType/hasExtension` | Risu 更全 |

**结论**:Risu 内置宏覆盖面远大于 Tavern(171 vs 数十个),尤其在数学/字符串/数组/显示/加密领域;Tavern 靠 `{{if}}` + 变量表达式 + 斜杠命令补充,更"平台化"。

---

## 5. 自定义宏对比

| 方式 | RisuAI | SillyTavern |
|---|---|---|
| UI/脚本定义 | `{{#func}}` 模板内定义;`{{declare}}` 行为声明 | ❌ 无 `/define` 命令、无 userMacros(已移除) |
| 代码级注册 | `registerCBS()`(cbs.ts:117) | `macros.register()` / `registry.registerMacro`(新引擎推荐);`MacrosParser.registerMacro`(旧,deprecated) |
| 每次调用动态宏 | 临时变量 `{{settempvar}}` | `substituteParams(content, { dynamicMacros })`(单次求值可见,支持 string/function/options 三种格式) |
| 变量作用域 | 全局(`db.globalChatVariables`)/ 角色默认(`char.defaultVariables`)/ 聊天(`chat.scriptstate`,可写)/ 模板全局(`db.templateDefaultVariables`)/ 临时 | 全局(`extension_settings.variables.global`)/ 聊天本地(`chat_metadata.variables`)/ 单次(dynamicMacros) |
| 持久化 | `chat.scriptstate['$key']` | `chat_metadata.variables` / `extension_settings.variables.global` |

**结论**:Risu 支持模板内 `#func` 函数与 4-5 层变量作用域(含角色默认、模板默认);Tavern 自定义宏主要靠代码注册(extension 用 `SillyTavern.getContext().registerMacro`),变量作用域 2 层 + 语法级变量表达式。

---

## 6. 与正则脚本的联动对比

| 位置 | RisuAI | SillyTavern |
|---|---|---|
| 数据源 | `processScriptFull` 内先 `risuChatParser(data)` 整体过宏(scripts.ts:133) | 引擎不替换输入文本的宏 |
| findRegex(IN) | 仅当 flag 含 `<cbs>` 时做宏展开(用户可选,scripts.ts:77/178) | 仅当 `substituteRegex≠NONE` 时(RAW=1 / ESCAPED=2 转义,engine.js:397-409) |
| replaceString(OUT) | 替换后必然再跑 `risuChatParser`(scripts.ts:248/291),OUT 内 `{{}}` 会展开 | **总是** `substituteParams`(engine.js:444) |
| trimStrings | ❌ 无 | 每条 `substituteParams`(engine.js:457-464) |
| 特殊宏 | `{{hiddenkey}}`(触发脚本但不出现在请求)、`{{data}}` 实为触发器 `displayData` 概念 | — |
| 语义 | IN 可选、OUT 必展 | findRegex 可选、replaceString/trim 必展 |

**结论**:两者方向相反 —— Risu 的"输入先整体过宏、OUT 后再过宏、IN 可选";Tavern 的"replaceString/trim 恒宏替换、findRegex 可选(且可转义)"。功能等价,实现位置不同。

---

## 7. 与 prompt 组装联动对比

| 环节 | RisuAI | SillyTavern |
|---|---|---|
| 主提示词 | `risuChatParser`(index.svelte.ts:433) | `substituteParams`(script.js:4631) |
| 世界书条目 | `risuChatParser(resolvePosition(lorebook.prompt))`(index.svelte.ts:537...) | `entry.content = substituteParams(entry.content)`(world-info.js:4939) |
| 示例消息 | index.svelte.ts:693-716(`{{slot}}` 占位) | parseMesExamples 经 `baseChatReplace`(script.js:3282) |
| 聊天历史 | 每条消息 `runCurrentChatFunction` 重跑宏(索引 :146);发送前 `processScriptFull(msg.data)`(:902) | `createRawPrompt` 每条 `substituteParams`(script.js:3886);CC 侧 openai.js:885 |
| 故事字符串 | — | Handlebars 渲染 + `helperMissing` 兜底转 `substituteParams`(macros.js:20-26) |
| 收发转义 | 发送前 `risuUnescape`(request.ts:218),接收后按需 `risuEscape`(:282) | `\{{` 由后处理器还原 |

**结论**:两者都在发送前对 prompt 各段落展开宏。Risu 特色是"发送前整体宏 + 收发私有字符转义";Tavern 特色是"Handlebars 故事字符串 + helperMissing 兜底 + 变量表达式"。

---

## 8. 高级能力与求值细节

### Risu 独有
- `{{? expr}}` 内联数学表达式;`{{#when}}` 操作符链(`and/or/not`/`>/>=/</<=`/`is/isnot`/`var/toggle`)。
- `{{#each}}` 数组循环(支持变量数组、二维嵌套)。
- `{{#func}}/{{call::}}` 模板内函数定义与递归调用。
- 调用栈深度限制 20;未知宏透传;未闭合花括号自动补 `{{` 前缀。
- 确定性随机:pick/rollp 基于哈希。

### Tavern 独有
- **语法级变量表达式**:`.var`、`$var`,操作符 `++ -- = += -= || ?? ||= ??= == != > >= < <=`(MacroLexer/MacroCstWalker)。
- `{{if}}`:`!` 取反、变量简写、宏名自动解析(`getPrimaryMacro` 且 minArgs=0)、`delayArgResolution` 只求值选中分支。
- `{{pick}}` 确定性种子 = `chatIdHash + contentHash + globalOffset + pick_reroll_seed`,`/reroll-pick` 换种子。
- `{{banned}}`:把词加入 textgenerationwebui banned 列表(副作用宏)。
- `{{original}}` 一次性取原文;`{{outlet}}`;`{{pipe}}` 是斜杠命令管道占位符(非宏)。
- 宏来源检测(detectMacroSource,基于调用栈识别 extension)。
- 旧引擎 legacy 兼容层 + `<USER>` 等旧标记。

---

## 9. 一句话总结

> **Risu 宏(CBS)= 自研图灵完备模板语言**:字符级状态机 + 171 内置宏 + 块级 `#if/#when/#each/#func` + `{{?}}` 表达式 + 私有字符转义,无 `\{{`;
> **Tavern 宏 = 两代引擎(旧正则 / 新 Chevrotain)**:结构化注册表 + `{{if}}` 控制流 + 语法级变量表达式(`.var`/`$var++`) + `\{{` 转义 + 确定性 `{{pick}}`,无循环宏、无模板内函数。
> Risu 宏能力"全内置"(模板语言化);Tavern 宏能力"平台化"(配合斜杠命令与扩展),代码级自定义更规范。
