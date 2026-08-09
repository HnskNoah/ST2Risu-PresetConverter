# round2 双侧调研:RisuAI CBS / SillyTavern 宏系统

日期:2026-08-09
来源:两路子代理源码调研(Risu: `rius/risuai-src`;Tavern: `SillyTavern/SillyTavern-src`)
范围:架构、语法、解析引擎、内置宏清单、自定义宏/变量作用域、与正则/prompt 联动、高级能力、求值顺序与转义
> 本文由 `round2-risu-macros.md` + `round2-tavern-macros.md` 按主题对照合一,两侧 `文件:行号` 证据全部保留。

---

## 0. 架构总览

| | RisuAI(CBS) | SillyTavern |
|---|---|---|
| 引擎 | **自研字符级状态机 + 注册表回调**,无第三方依赖。`parser.svelte.ts:1538`(`risuChatParser`)+ `cbs.ts:117`(`registerCBS`,`registerFunction` 注册 ~171 宏)| **两代引擎并存**:旧正则引擎(`evaluateMacros`,`macros.js:610`)+ 新 Chevrotain 引擎(`MacroEngine.evaluate`,`engine/MacroEngine.js`),默认开新(`power-user.js:302` `experimental_macro_engine:true`) |
| 注册中心 | `initMatcher()`(`parser.svelte.ts:956,997`)把 cbs.ts 回调填入 `matcherMap` | `MacroRegistry`(`engine/MacroRegistry.js`,单例) |
| 变量存储 | `chatVar.svelte.ts`(`getChatVar`/`setChatVar`/`getGlobalChatVar`) | `SillyTavern.getContext().variables`(`variables.js`) |
| 对外入口 | `risuChatParser(da, opts)`(`parser.svelte.ts:1538`) | `substituteParams(content, opts)`(`script.js:2922`) |

---

## 1. 语法对照

### Risu 4 大语法(状态机 `parser.svelte.ts:1613-1640`)
1. **变量/函数宏** `{{name}}`、`{{name::arg1::arg2}}`:`matcher()`(`:1035`)先按 `::` 切分,参数含单 `:` 再按 `:` 切;名称 `.toLocaleLowerCase()` 并去空格/下划线/连字符(`/[\s_-]/g`,`:1044`);未知宏原样透传(`:1721`)。
2. **计算表达式** `{{? 1+2*3}}`:`p1.startsWith('? ')` → `calcString()`(`:1038-1041`)。
3. **块级宏** `{{#xxx}}...{{/xxx}}`(`blockStartMatcher` `:1152` / `blockEndMatcher` `:1411`):
   | 块宏 | 说明 | 位置 |
   |---|---|---|
   | `{{#if 1}}...{{/}}` | 旧条件,**已废弃** | `:1153`;`cbs.ts:2381` |
   | `{{#if_pure 1}}` | 旧变体,**已废弃** | `cbs.ts:2397` |
   | `{{#when::op::...}}...{{:else}}...{{/}}` | 新条件,支持操作符链 | `:1160` |
   | `{{#each arr as v}}...{{slot::v}}...{{/}}` | 数组遍历循环 | `:1194` |
   | `{{#func name args}}...{{/}}`+`{{call::name::arg}}` | 自定义函数定义/调用 | `:1200,1689` |
   | `{{#pure}}` | 不解析原样输出(废弃→`#puredisplay`) | `:1204` |
   | `{{#puredisplay}}` | 输出二次转义 | `:1205` |
   | `{{#code}}` | normalize 块(处理 `\n` 等转义) | `:1207` |
   | `{{#escape}}`、`{{#escape::keep}}` | 转义块(`{}()`→私有 Unicode) | `:1209` |
   | `{{:else}}` | `#when` 的 else | `:1455` |
4. **传统单括号** `{#if 1#}...{#if#}`(legacy,废弃):`case '#'`(`:1645`)`legacyBlockMatcher`(`:1097`)仅 if。
5. **注释** `{{// ...}}`(`cbs.ts:2259`);**预处理** `<(user|char|bot)>` → `{{$1}}`(`:1612`)。

### Tavern 语法(新引擎默认)
- **只有 `{{...}}` 一种语法。`{%...%}` 全库不存在**(仅第三方压缩 TTS 库 kokoro.web.js 出现,无关)。
- **旧尖括号标记** `<USER>/<BOT>/<CHAR>/<GROUP>/<CHARIFNOTGROUP>`:旧引擎直接正则替换(`macros.js:624-628`);新引擎由**预处理器**改写为 `{{user}}/{{char}}/{{group}}/{{charIfNotGroup}}`(priority 20)。
- **故事字符串用 Handlebars**:`macros.js:17-26` 注册 `trim` helper 与 `helperMissing` 兜底(未识别 `{{name}}` 转回 `substituteParams('{{name}}')`)。
- 参数:`{{macro::arg1::arg2}}`(`::`),兼容单冒号/空格(`{{roll 1d6}}`、`{{random:a,b}}`)。
- **作用域/成对宏**:`{{if}}...{{else}}...{{/if}}`、`{{setvar::x}}content{{/setvar}}`,`/` 作闭合标签(`MacroFlags.js` `CLOSING_BLOCK`)。

---

## 2. 解析引擎

### Risu `risuChatParser`(`parser.svelte.ts:1538`)
- **状态机**:逐字符 `while` + `switch`(`:1613-1730`);`nested[]` 当栈(`{{`/`{#` 入栈,`}}` 出栈交给 matcher/块匹配器);**同样支持 `<...>` 嵌套**(stackType 2,用于 HTML 属性)。
- **嵌套**:`#each` 通过改写 `da` 字符串实现迭代再继续解析(`:1710-1723`)。
- **递归**:宏回调内部再调 `risuChatParser`(`{{personality}}` 重解析角色性格 `cbs.ts:246`;`{{call::}}` 递归 `:1690-1700`);**防爆栈 `callStack>20` → `'ERROR: Call stack limit reached'`**(`:1605-1606`)。
- **`matcher()`**(`:1035`):`::` 拆分→小写→`matcherMap.get`→回调。回调返回 `string`/`{text,var}`/`null`(透传)。

### Tavern `substituteParams`(`script.js:2922`)
1. 空串/非字符串处理(`:2924-2928`);
2. options 非对象 → `substituteParamsLegacy`(`:2930-2934`);
3. `!experimental_macro_engine` → legacy(`:2938-2940`);
4. 新引擎:`MacroEnvBuilder.buildFromRawEnv(ctx)` → `MacroEngine.evaluate(content, env)`(`:2942-2949`)。
- `substituteParamsExtended`(`:2756`)= 带 `dynamicMacros`+`postProcessFn` 的包装,**deprecated**。
- **旧引擎** `evaluateMacros`(`macros.js:610`):宏是 `{regex, replace}` 对象,按 `[...preEnv, ...env, ...postEnv]`(`:694`)逐个 `content.replace()`;短路 `!content.includes('{{')`(`:700-702`)。
- **新引擎** `MacroEngine`(`engine/MacroEngine.js`):pre-processors → `MacroParser.parseDocument` → `MacroCstWalker.evaluateDocument` → post-processors;`#resolveMacro` 先查 `env.dynamicMacros`(本次求值专属,支持 string/function/MacroDefinitionOptions),再查注册表,未知宏**原样保留**;预处理器:`{{time_UTC±N}}`→`{{time::UTC±N}}`(priority 10)、尖括号标记(priority 20);后处理器:`\{`/`\}` 还原(priority 10)、`{{trim}}` 空白清除(priority 20)、`ELSE_MARKER` 清理(priority 30)。
- **Lexer/Parser**:`MacroLexer.js` Chevrotain 多模式;`MACRO_IDENTIFIER_PATTERN=/^[a-zA-Z][\w-_]*$/`(`:19`)。`MacroParser.js`:`document → macro*`,`macro → {{ flags? (variableExpr|macroBody) }}`。`MacroCstWalker.js`:嵌套、作用域配对(`{{x}}content{{/x}}`→内容作最后一个无名参数)、变量简写(`#evaluateVariableExpr`)、`globalOffset` 确定性种子。
- **MacroRegistry**(`engine/MacroRegistry.js`):`registerMacro`(`:198`)/`registerMacroAlias`(`:241`)/`getAllMacros`(`:379`)等;**键大小写不敏感**(`:305`);选项含 `aliases/category/unnamedArgs/list/strictArgs/delayArgResolution`(`{{if}}` 用)/`handler`;参数校验 `isArgsValid`(`:698`);来源检测 `detectMacroSource`(`:808`,识别 extension);分类 `MacroCategory`(`:30-47`)。
- **注册调用链**:`initMacros()`(`macros.js:717`,调自 `script.js:7960`)→ `initRegisterMacros()`(`:746`)→ 按序注册 core→env→state→chat→time→variable→instruct 七组。
- **flags**(`MacroFlags.js`):`#` 保留空白、`/` 闭合块**已实现**;`!`/`?`/`~`/`>`(过滤器)均 TBD 未实现。

---

## 3. 内置宏清单(并行小节)

### Risu(cbs.ts 全部 `registerFunction` 提取,171 注册点;仅列主名,别名见源码)
**角色/身份**:`char`(147,alias `bot`)、`user`(173)、`role`(671)、`trigger_id`(185)
**提示词段落**:`personality`(238)、`description`(253)、`scenario`(268)、`exampledialogue`(283)、`persona`(299)、`mainprompt`(308)、`jb`(373)、`globalnote`(383)、`authornote`(393)
**历史/消息**:`previouscharchat`(195)、`previoususerchat`(214)、`userhistory`(337)、`charhistory`(355)、`history`(1513)、`lastmessage`(723)、`lastmessageid`(738)、`previouschatlog`(1148)、`messagetime`(446)、`messagedate`(470)、`messageunixtimearray`(493)、`messageidleduration`(548)、`idleduration`(605)
**时间/日期**:`time`(517)、`isotime`(527)、`isodate`(537)、`date`(1565)、`unixtime`(507);`dateTimeFormat`(`parser.svelte.ts:1060`)支持 `YYYY/MM/DD/HH/mm/ss/MMMM/dddd`。
**模型/元数据**:`model`(651)、`axmodel`(661)、`maxcontext`(713)、`metadata`(1865)、`moduleenabled`(1609)、`moduleassetlist`(1624)、`prefillsupported`(1358)、`isfirstmsg`(691)、`jbtoggled`(703)、`chatindex`(416)、`firstmsgindex`(425)、`screenwidth/height`(1368/1377)
**变量控制**:`tempvar`/`gettempvar`(754)、`settempvar`(766)、`getvar`(793)、`calc`(802)、`addvar`(811)、`setvar`(827)、`setdefaultvar`(843)、`getglobalvar`(862)、`return`(779)、`declare`(2249)、内部 `__`(2273)
**随机**:`random`(2026)、`pick`(2035,**哈希确定性**)、`roll`(2049)、`rollp`(2078,**确定性掷骰**)、`randint`(1814)、`dice`(1828)、`hash`(1805)
**数学**:`min/max/sum/average`(1695-1755)、`round/floor/ceil/abs/remaind`(1103-1143)、`pow`(1171)、`tonumber`(1160)、`fixnum`(1760)、`range`(1546)
**字符串**:`startswith/endswith/contains`(985-1012)、`replace/split/join/spread/trim/length`(1021-1066)、`lower/upper/capitalize`(1076-1098)、`reverse`(2122)、`unicodeencode/unicodedecode`(1769-1786)、`u/ue`(1787-1804)、`fromhex/tohex`(1847-1865)
**比较/逻辑**:`equal/notequal/greater/less/greaterequal/lessequal`(891-940)、`and/or/not`(945-972)、`xor`(1949)
**数组/对象**:`makearray`(1296)、`makedict`(1305)、`arraylength`(1067)、`arrayelement`(1180)、`dictelement`(1190)、`objectassert`(1200)、`element`(1213)、`arrayshift/arraypop/arraypush/arraysplice/arrayassert`(1238-1291)、`filter`(1641)、`all/any`(1669-1695)
**显示/HTML**:`br`(642)、`cbr`(1386)、`bo/bc`(1417/1426)、`decbo/decbc`(1399/1408)、`displayescaped*`(1435-1488)、`risu`(880)、`button`(871)、`comment`(2131)、`tex`(2143)、`ruby`(2152)、`codeblock`(2161)、`bkspc`(2181)、`erase`(2213)
**资产(仅文档,UI 层实现)**:`asset/emotion/audio/bg/bgm/video/video-img/image/img/path/inlay/inlayed/inlayeddata/source`(2284-2377,`doc_only`)
**加密**:`xor`(1962)、`xordecrypt`(1975)、`crypt`(1985,凯撒)
**特殊**:`blank`(437,alias `none`)、`hiddenkey`(2113)、`//`(2259)、`?`(2266)、`slot`(2492)、`position`(2499)、`#escape/#each/#if/#when/:else/#pure/#puredisplay`(2468-2501,`doc_only`)

> ⚠️ **`{{data}}`**:cbs.ts 中**没有** `data` 宏。模型请求整段 prompt 经触发器 `arg.displayData` 暴露(`triggers.ts:1066,2353`);Playground 里是 `{{slot::data}}`(`PlaygroundSubtitle.svelte:302`)。需模型输出上下文用 `{{lastmessage}}` 或触发器 displayData。

### Tavern 内置宏
**core-macros.js**:`space`(32)、`newline`(50)、`noop`(68)、`trim`(77)、`if`(134)、`else`(217)、`input`(228)、`maxPrompt`(236,alias `maxPromptTokens`)、`maxContext`(246)、`maxResponse`(256)、`reverse`(266)、`//`(282,alias `comment`)、`roll`(303)、`random`(340)、`pick`(363)、`banned`(425)、`outlet`(450)
**env-macros.js**:`user`(16)、`char`(23)、`group`(30,alias `charIfNotGroup`)、`groupNotMuted`(38)、`notChar`(45)、`charPrompt`(53)、`charInstruction`(60)、`charDescription`(67,alias `description`)、`charPersonality`(75,alias `personality`)、`charScenario`(83,alias `scenario`)、`persona`(91)、`mesExamplesRaw`(98)、`mesExamples`(105)、`charDepthPrompt`(128)、`charCreatorNotes`(135,alias `creatorNotes`)、`charFirstMessage`(143,alias `greeting`)、`charVersion`(168,alias `version`)、`model`(180)、`original`(187)、`isMobile`(198)
**chat-macros.js**:`lastMessage`(9)、`lastMessageId`(16)、`lastUserMessage`(24)、`lastCharMessage`(31)、`firstIncludedMessageId`(38)、`firstDisplayedMessageId`(46)、`lastSwipeId`(54)、`currentSwipeId`(62)、`allChatRange`(70)
**time-macros.js**:`time`(11,可 `{{time::UTC±N}}`)、`date`(41)、`weekday`(48)、`isotime`(55)、`isodate`(62)、`datetimeformat`(69)、`idleDuration`(85,alias `idle_duration`)、`timeDiff`(94)
**variable-macros.js**:本地 `setvar`(11)/`addvar`(35)/`incvar`(59)/`decvar`(79)/`getvar`(99)/`hasvar`(119,alias `varexists`)/`deletevar`(139,alias `flushvar`);全局 `setglobalvar`(159)/`addglobalvar`(183)/`incglobalvar`(207)/`decglobalvar`(227)/`getglobalvar`(247)/`hasglobalvar`(267)/`deleteglobalvar`(287)
**state-macros.js**:`lastGenerationType`(35)、`hasExtension`(43)
**instruct-macros.js**(`registerSimple` 批量,`instEnabled` 关则空串):`instructStoryStringPrefix/Suffix`、`instructUserPrefix/Input/Suffix`、`instructAssistantPrefix/Output/Suffix/Separator`、`instructSystemPrefix/Suffix`、`instructFirstAssistantPrefix`、`instructLastAssistantPrefix`、`instructStop`、`instructUserFiller`、`instructSystemInstructionPrefix`、`instructFirstUserPrefix`、`instructLastUserPrefix`、`defaultSystemPrompt/instructSystem/instructSystemPrompt`(56)、`systemPrompt`(59)、`exampleSeparator/chatSeparator`、`chatStart`
**扩展注册**:`authorsNote/charAuthorsNote/defaultAuthorsNote`(`authors-note.js:606-614`)、`summary`(`extensions/memory/index.js:1127`)、`charPrefix/charNegativePrefix`(`stable-diffusion/index.js:5989-5993`)
**旧引擎专属**(新引擎关闭时仍生效):preEnv `<USER>/<BOT>/<CHAR>/<CHARIFNOTGROUP>/<GROUP>`(624-628)、`roll`(629)、`newline`(632)、`trim`(633)、`noop`(634)、`input`(635);postEnv `maxPrompt/maxContext/maxResponse(,Tokens)`、`lastMessage/lastMessageId/lastUserMessage/lastCharMessage/firstIncludedMessageId/firstDisplayedMessageId/lastSwipeId/currentSwipeId/allChatRange`、`reverse`(658)、`//`(659)、时间系列(660-666)、`outlet`(668)、`timeDiff`(669)、`banned`(670,正则 `:443`)、`random`(671)、`pick`(672);`lastGenerationType`(723)、`isMobile`(738)

**`{{banned}}` 是宏函数**:副作用——把词加入 `textgenerationwebui_banned_in_macros` 并返回空串(新 `core-macros.js:425`;旧 `macros.js:442-453`)。**没有 `{{character}}` 宏**(角色卡字段是 `{{charDescription}}` 等)。

**功能域对照**(Risu 171 vs Tavern 数十个):
- 角色/身份:都有;Risu `char/bot/user/role/trigger_id`,Tavern `user/char/group/notChar/charIfNotGroup`。
- 提示词段落:Risu `personality/description/scenario/exampledialogue/persona/mainprompt/jb/globalnote/authornote`,Tavern `charPrompt/charInstruction/charDescription/charPersonality/charScenario/persona/mesExamples/charDepthPrompt/charCreatorNotes/charFirstMessage`(Tavern 更细分)。
- 历史/消息:都有(`lastmessage/lastmessageid` ↔ `lastMessage/lastSwipeId/allChatRange` 等)。
- 时间/日期:都有,`{{time::UTC±N}}` 两侧都支持。
- 随机:Risu 工具更多(`random/pick/roll/rollp/randint/dice/hash`),Tavern `random`(每次重掷)/`pick`(位置+内容稳定,`/reroll-pick`)。
- 数学/字符串/数组/Risu 独有且更强;显示/HTML/加密 Risu 独有。
- 逻辑:都有,Risu 块级 `#when` 链更强;Tavern `{{if}}` 支持 `!`、变量简写、宏名解析。

**结论**:Risu 内置宏覆盖面远大于 Tavern,尤其在数学/字符串/数组/显示/加密;Tavern 靠 `{{if}}` + 变量表达式 + 斜杠命令补充,更"平台化"。

---

## 4. 自定义宏与变量作用域

| 方面 | Risu | Tavern |
|---|---|---|
| UI/脚本定义 | `{{#func}}` 模板内定义;`{{declare}}` 行为声明 | ❌ **无 `/define` 命令、无 userMacros**(已移除) |
| 代码级注册 | `registerCBS()`(`cbs.ts:117`) | `macros.register()`/`registry.registerMacro`(新,推荐);`MacrosParser.registerMacro`(旧,deprecated,`st-context.js:179-181`) |
| 每次调用动态宏 | 临时变量 `{{settempvar}}` | `substituteParams(content,{dynamicMacros})`(string/function/MacroDefinitionOptions 三种格式,本次求值内可见) |
| 变量作用域 | 全局(`db.globalChatVariables`)/角色默认(`char.defaultVariables`)/聊天(`chat.scriptstate`,可写)/模板全局(`db.templateDefaultVariables`)/临时 | 全局(`extension_settings.variables.global`)/聊天本地(`chat_metadata.variables`)/单次(dynamicMacros) |
| 持久化 | `chat.scriptstate['$'+key]` | `chat_metadata.variables` / `extension_settings.variables.global` |
| 变量简写表达式 | ❌ 无 | ✅ 语法级:`.varName`/`$varName`,操作符 `++ -- = += -= || ?? == != > >= < <=`(`MacroLexer.js` Var.Operators) |

### Risu 变量细节
- `{{setvar::name::value}}`(`cbs.ts:827`)、`{{setdefaultvar}}`(843)、`{{addvar}}`(811)、`{{getvar}}`(793);存储 `chat.scriptstate['$'+key]`(`chatVar.svelte.ts:29-33`,`database.svelte.ts:1458`)。
- **仅在 `runVar:true` 时真正写入**(`cbs.ts:833`;round9 实证)。
- 作用域层级(`chatVar.svelte.ts`):聊天(最高)→ 角色默认(`char.defaultVariables` 字符串 `k=v`,`:17-22`,`database.svelte.ts:1483`)→ 模板/全局默认(`db.templateDefaultVariables`,`:17`,`:531,1632`)→ 全局(`db.globalChatVariables`,`:38-40`,`:1059`)。
- 临时:`{{settempvar}}`(766)、`{{tempvar}}`(754);函数:`{{#func 名 args}}...{{/}}`(1200-1202,1685-1691)+`{{call::名::参}}`(1689-1700)+`{{arg::0}}`;声明:`{{declare::name}}` 设 `__declared_X__`(2249)。
- 触发器/脚本侧:`triggers.ts` 有完整 `getVar/setVar` API 与 `setVar` 副作用宏(60+ effect 类型)。

### Tavern 变量细节
- 本地存 `chat_metadata.variables`,全局存 `extension_settings.variables.global`(`variables.js`)。
- `{{setvar/getvar/incvar/decvar/addvar/hasvar/deletevar}}` 与 `{{setglobalvar/...}}`。
- `{{if {{getvar::showHeader}}}}` 嵌套示例 `core-macros.js:163`;`index.html:5624` 有设置项防 `{{getvar}}` 返回的"宏样文本"二次求值。

---

## 5. 宏与正则脚本联动

| 位置 | Risu | Tavern |
|---|---|---|
| 数据源 | `processScriptFull` 内先 `risuChatParser(data)` 整体过宏(`scripts.ts:133`) | 引擎不替换输入文本宏 |
| findRegex(IN) | 仅 flag 含 `<cbs>` 时展开(`scripts.ts:77,178`) | 仅 `substituteRegex≠NONE`:`RAW`→`substituteParamsExtended`,`ESCAPED`→带 `sanitizeRegexMacro` 转义(`engine.js:397-409`) |
| replaceString(OUT) | 替换后必再跑 `risuChatParser`(`scripts.ts:248,291`) | **总是** `substituteParams`(组引用/裁剪后,`engine.js:444`) |
| trimStrings | ❌ 无 | 每条 `substituteParams`(`engine.js:457-464`) |
| 特殊 | `{{hiddenkey}}`(触发脚本但不出现在请求,`cbs.ts:2113`);脚本缓存键把 `<cbs>` IN 展开计入(`scripts.ts:77`) | — |

**结论**:Risu 的"输入先整体过宏、OUT 后再过宏、IN 可选";Tavern 的"replaceString/trim 恒宏替换、findRegex 可选且可转义"。功能等价,实现位置不同。

---

## 6. 宏与 prompt 组装

### Risu(所有文本段在 prompt 构建处展开,`index.svelte.ts`)
- 主提示词 `:433`;jailbreak `:436`;globalNote(支持 `{{original}}`占位)`:439`;作者注 `:449,455`;描述/性格/场景 `:467-480`;世界书 `risuChatParser(resolvePosition(lorebook.prompt))`(`:537,548,588,609`);persona `:563`;示例 `:693-716`(`{{slot}}` 占位);历史 `runCurrentChatFunction` 用 `runVar:true` 重跑(`:146`);发送前 `processScriptFull(msg.data)`(`:902`)。
- 发送前最后处理:`request.ts:218` `risuUnescape(m.content)`;escape 模式开时 `:282` `risuEscape(da.result)`。世界书激活判定先算宏:`lorebook.svelte.ts:576`。

### Tavern(主入口 `Generate`,`script.js:4231`)
- 世界书:`entry.content = substituteParams(entry.content)`(`world-info.js:4939`);`getWorldInfoPrompt`(`script.js:4576`)。
- 示例:`example_separator` 先替换(`:3451`);WI examples 经 `baseChatReplace`(`:3282`)进 `mesExamplesArray`(`:4583-4590`);CC 侧 `substituteParams(oai_settings.new_example_chat_prompt)`(`openai.js:1099`)。
- 系统/jailbreak:`substituteParams(system,{original})`(`:4631`)、`jailbreak`(`:4691`);OAI 场景/性格 `scenario_format/personality_format`(`openai.js:1359-1360`)、`group_nudge`(1361)、impersonation(1362)。
- 故事字符串:`renderStoryString`(`power-user.js:2234`)Handlebars + `helperMissing` 兜底(`:2248-2252`)。
- 聊天历史:TC `mesSendString`(`:5071-5131`),最终 `combinedPrompt`(`:5129-5133`);CC `populateChatHistory`(`openai.js:876`)。
- 通用 raw prompt:`createRawPrompt`(`:3866`)每条 `substituteParams`(`:3886`)。

---

## 7. 高级能力

| 能力 | Risu | Tavern |
|---|---|---|
| 条件 | `{{#when::A::and::B}}...{{:else}}...{{/}}`(操作符 `and/not/var/toggle/`>=`/`<`/`is/isnot` 等,`cbs.ts:2421-2446`);旧 `{{#if 1}}`(废弃) | `{{if}}`(`core-macros.js:134`):`!`取反、变量简写、宏名自动解析、`{{else}}`(`splitOnTopLevelElse`,`:90`)、`delayArgResolution` 只求值选中分支、默认去缩进 |
| 循环 | `{{#each arr as v}}{{slot::v}}{{/}}`(+`::keep` 二维/嵌套,`loop.test.ts:34-46`) | ❌ **无 `{{for}}/{{loop}}` 宏**;循环靠斜杠命令 `/while`、`/times`(`variables.js`) |
| 数学 | `{{? (2*3)+4}}`→10、`{{calc::2+2*3}}`→8、`{{range::1::5}}` | 少,靠表达式/斜杠命令 |
| 函数 | `{{#func greet name}}Hello {{arg::0}}!{{/}}{{call::greet::World}}` | ❌(仅代码注册 handler) |
| JSON/数组 | `{{makedict}}`/`{{dictelement}}`/`{{objectassert}}`/`{{lorebook}}`(世界书 JSON)/`{{makearray}}`/`{{filter}}` | ❌ 无内建数组宏 |
| 确定性随机 | `pick/rollp`(哈希种子) | `{{pick}}` 种子=`chatIdHash+contentHash+globalOffset+pick_reroll_seed`(`core-macros.js:363-422`);`/reroll-pick` 改种子(`slash-commands.js:3594`) |
| 其它 | `{{hiddenkey}}`(仅激活脚本不占 token) | `{{banned}}` 宏函数(副作用加词表);`{{pipe}}` **不是宏**,是 SlashCommand 管道占位符(`SlashCommandClosure.js:178`) |

---

## 8. 求值顺序与转义

### 求值顺序
| Risu | Tavern |
|---|---|
| 单趟左到右逐字符(`:1613`);嵌套由栈保证,内层先求值;`#each` 重写 da 再解析(`:1720-1723`);`#puredisplay` 输出 `{{`→`\{{`(`:1737`);递归深度限 20(`:1605`);`::` 优先于 `:` 拆分(`:1038-1042`);未闭合花括号结尾补 `{{`(`:1755-1759`) | 旧引擎 pre→env→post 固定顺序(`macros.js:694`);新引擎单次解析、嵌套自内向外(除非 `delayArgResolution`);`globalOffset` 为嵌套 `{{pick}}` 确定性播种(`MacroCstWalker.js`);每个结果经 `env.functions.postProcess`(`MacroEngine.js`) |

### 转义机制
| Risu | Tavern |
|---|---|
| **无 `\{{` 反斜杠转义**。①私有 Unicode `U+E9B8–E9BF`(`risuEscape` 把 `{}()<>:;`→私有字符,`parser.svelte.ts:140-149`,`risuUnescape` 反向 `:133-138`);②`{{#escape}}...{{/}}` 块(`:1209,1530`,escapes.test.ts:71-88);③显示宏 `{{bo}}/{{bc}}`→`{{`/`}}`、`{{decbo}}/{{decbc}}`→`{`/`}`、`{{(}}/{{)}}` 等。范式:`risuUnescape(risuChatParser(text))` | `\{`/`\}` 由 post-processor 还原(`MacroEngine.js` priority 10);`\{\{` 不匹配宏起点,可输出字面 `{{` |

### 其它差异
- `{{time}}`:Risu 24h 不补零/带参为格式串;Tavern `{{time::UTC±N}}` 偏移。
- `{{idleDuration}}` 为正式名(Tavern);Risu 有 `idleduration`(605)。
- `{{random}}`:Risu 哈希确定性(`pick`/`rollp`);Tavern random 每次重掷(`seedrandom('added entropy.',{entropy:true})`,`core-macros.js:340`)。

---

## 9. 结论(供 round6 宏翻译表)

1. **Risu**:自研字符级状态机 + 注册表回调(`parser.svelte.ts:1538` + `cbs.ts:117`),无第三方模板依赖;171 宏注册点;4 层变量作用域;`<cbs>` flag 可选 IN 展开、OUT 必然二次展开;转义走私有 Unicode(无 `\{{`)。
2. **Tavern**:两代引擎(Chevrotain 新引擎默认开);只有 `{{...}}` 语法(`{%...%}` 不存在);注册宏全局 + dynamicMacros 单次;变量语法级简写(`.var`/`$var`);`{{if}}`/`{{pick}}` 高级;无循环宏、无 `/define`。
3. **翻译要点**(细节见 `round6-converter-spec.md` §6):
   - A 直通:同名同义(`char/user/newline/reverse/random::a::b/pick/roll/maxContext/lastMessage` 等)。
   - B 改写:同名不同义(`time/isotime/date/idleDuration/trim/random(无参)/isMobile/words`)。
   - C 翻译:`charPrompt→mainprompt`、`charInstruction→jb`、`mesExamples→exampledialogue`、`weekday→date::dddd`、`{{if}}→{{#when}}`、`incvar→addvar::n::1` 等。
   - D 原样保留:Risu 对未知宏透传(`parser.svelte.ts:1771-1774`),Tavern 同 → 未匹配宏原样保留(`group/notChar/charPrompt/instruct*` 等)。
   - 规则:输出统一小写无分隔形式(Risu 规范化保证命中);`{{random a,b}}` 空格语法 → `{{random::a::b}}`。
   - **无 `{{data}}` 宏**、**无 `{{character}}` 宏**;Risu 无 `\{{` 转义(导入 `\{{` 格式需解析前自行转换)。
