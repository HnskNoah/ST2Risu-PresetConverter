# SillyTavern 宏系统调研报告 — Round 2

日期:2026-08-09
来源:子代理源码调研(`SillyTavern/SillyTavern-src`)
范围:两代引擎、语法、解析引擎、内置宏清单、自定义宏、与正则/prompt 联动、高级能力、求值顺序与转义

关键文件:`public/scripts/macros.js`、`public/scripts/macros/`(新引擎)、`public/script.js`(注意:`script.js` 在 `public/` 根,不在 `scripts/` 下)。

---

## 0. 总体架构:两代引擎并存

SillyTavern 当前同时存在**两代宏引擎**,通过 `power_user.experimental_macro_engine` 开关切换:

| | 旧引擎(legacy) | 新引擎(experimental) |
|---|---|---|
| 入口 | `evaluateMacros()` `macros.js:610` | `MacroEngine.evaluate()` `engine/MacroEngine.js` |
| 实现 | 正则逐个替换 `{regex, replace}` | Chevrotain 词法/语法解析 + CST 遍历(支持嵌套/作用域) |
| 模块 | `public/scripts/macros.js` | `public/scripts/macros/{engine,definitions,macro-system.js}` |
| 状态 | 标记 deprecated | 默认开启 |

**开关默认值:`true`**(已默认开启)。证据:`power-user.js:302` `experimental_macro_engine: true`;UI 开关在 `index.html:5442`(`#experimental_macro_engine`),事件绑定在 `power-user.js:3868`。

---

## 1. 宏语法:`{{...}}` 与 `{%...%}`

**结论:SillyTavern 只有 `{{...}}`(双花括号)一种宏语法。`{%...%}` 语法在本代码库中不存在**——全库搜索 `\{%` 仅在第三方压缩 TTS 库 `extensions/tts/lib/kokoro.web.js` 中出现,与宏系统无关。

相关但易混淆的语法:

- **历史遗留的非花括号标记** `<USER>` `<BOT>` `<CHAR>` `<GROUP>` `<CHARIFNOTGROUP>`,旧引擎直接正则替换(`macros.js:624-628`);新引擎由**预处理器**统一改写为 `{{user}}`/`{{char}}`/`{{group}}`/`{{charIfNotGroup}}` 后再走正规管线(`MacroEngine.js` 中 `#registerCorePreProcessors`,priority 20)。
- **故事字符串(story string)用 Handlebars 渲染**,语法仍是 `{{...}}`。为避免 Handlebars 吃掉未定义宏,`macros.js:17-26` 注册了 `trim` helper 与 `helperMissing` 兜底:`helperMissing` 会把任何未识别的 `{{name}}` 转回 `substituteParams('{{name}}')`。
- 参数分隔:标准写法 `{{macro::arg1::arg2}}`(`::` 双冒号),也兼容单冒号/空格 `{{roll 1d6}}`、`{{random:a,b}}` 等旧写法(见 `MacroParser.js` arguments 规则、`core-macros.js` `readSingleArgsRandomList`)。
- **作用域宏/成对宏**:`{{if ...}}...{{else}}...{{/if}}`、`{{setvar::x}}content{{/setvar}}`,用 `/` 标志作闭合标签(`MacroFlags.js` `CLOSING_BLOCK`)。

---

## 2. 宏解析引擎

### 2.1 总入口 `substituteParams`(`script.js:2922`)

`substituteParams(content, options = {})` 是唯一对外入口,做四件事:

1. 空串/非字符串处理(`script.js:2924-2928`);
2. **旧式位置参数调用兼容**:`options` 不是对象则转 `substituteParamsLegacy`(`script.js:2930-2934`);
3. **引擎开关**:`!power_user?.experimental_macro_engine` → 走 legacy(`script.js:2938-2940`);
4. 否则走新引擎:`MacroEnvBuilder.buildFromRawEnv(ctx)` → `MacroEngine.evaluate(content, env)`(`script.js:2942-2949`)。

相关包装:
- `substituteParamsExtended(content, additionalMacro, postProcessFn)`(`script.js:2756`)= `substituteParams(content, {dynamicMacros: additionalMacro, postProcessFn})`,**已标记 deprecated**。
- `substituteParamsLegacy`(`script.js:2772`):构造 legacy `environment` 对象(角色卡字段、`user/char/group/notChar/model`、`original`、additionalMacro),最终调 `evaluateMacros`(`script.js:2878`)。
- 启用新引擎时 `substituteParamsLegacy` 内部也会重路由到新引擎(`script.js:2778-2788`)。

### 2.2 旧引擎 `evaluateMacros`(`macros.js:610`)

宏是 `{ regex, replace }` 对象,按 `[...preEnvMacros, ...envMacros, ...postEnvMacros]`(`macros.js:694`)顺序逐个 `content.replace()`:

- **preEnvMacros**(env 替换前,`macros.js:622-641`):`<USER>` 等旧标记、`{{roll}}`、instruct 宏(`getInstructMacros`)、变量宏(`getVariableMacros`)、`{{newline}}` `{{trim}}` `{{noop}}` `{{input}}`。
- **envMacros**(`macros.js:673-690`):对传入 env 的每个键动态生成 `new RegExp('{{'+escapeRegex(varName)+'}}','gi')`;值可以是函数(带 `nonce` 参数),经 `MacrosParser.sanitizeMacroValue` 归一化。
- **postEnvMacros**(`macros.js:642-672`):`{{maxPrompt}}` 系列、聊天信息系列、时间系列、`{{random}}/{{pick}}/{{banned}}/{{outlet}}/{{timeDiff}}` 等。
- 短路优化:`!macro.regex.source.startsWith('<') && !content.includes('{{')` 直接跳出(`macros.js:700-702`);每个替换结果再套 `postProcessFn`(`macros.js:706`)。

### 2.3 新引擎(`public/scripts/macros/`)

- `macro-system.js:29-37` 导出单例集合:`macros = { engine, registry, envBuilder, lexer, parser, cstWalker, category, register, registerAlias }`。
- **MacroEngine**(`engine/MacroEngine.js`):
  - `evaluate(input, env, {contextOffset})`:先跑 pre-processors → `MacroParser.parseDocument` → `MacroCstWalker.evaluateDocument` → post-processors。
  - `#resolveMacro`:先查 `env.dynamicMacros`(本次求值专属的动态宏,支持字符串/函数/MacroDefinitionOptions 三种格式),再查注册表;未注册的未知宏**原样保留**(`return raw`);执行结果经 `env.functions.postProcess` 后置处理。
  - 预处理器:`{{time_UTC±N}}`→`{{time::UTC±N}}`(priority 10)、旧尖括号标记→`{{}}`(priority 20);后处理器:`\{`/`\}` 转义还原(priority 10)、`{{trim}}` 周围空白清除(priority 20)、`ELSE_MARKER` 清理(priority 30)。
- **MacroLexer**(`engine/MacroLexer.js`):Chevrotain 多模式词法器,状态机有 `plaintext / macro_def / macro_identifier_end / macro_args / macro_filter_modifer / var_identifier / var_after_identifier / var_value` 等模式。标识符规则:`MACRO_IDENTIFIER_PATTERN = /^[a-zA-Z][\w-_]*$/`(`MacroLexer.js:19`)。
- **MacroParser**(`engine/MacroParser.js`):CstParser,规则为 `document → macro*`,`macro → {{ flags? (variableExpr|macroBody) }}`,`macroBody → identifier args?`,args 支持 `::` 分隔与嵌套宏。
- **MacroCstWalker**(`engine/MacroCstWalker.js`):遍历 CST,处理嵌套宏、作用域宏配对(`#processScopedMacros`,把 `{{x}}content{{/x}}` 合并成"内容作为最后一个无名参数")、变量简写求值(`#evaluateVariableExpr`)。`globalOffset` 用于 `{{pick}}` 这类确定性种子。
- **MacroRegistry**(`engine/MacroRegistry.js`):注册中心(见下)。
- **MacroEnvBuilder**(`engine/MacroEnvBuilder.js`):构建传给 handler 的 `MacroEnv`(`{content, contentHash, names, character, system, functions, dynamicMacros, extra}`),character 字段用**惰性 getter**(`getCharacterCardFieldsLazy`);支持 `registerProvider` 扩展(优先级 `env_provider_order`:EARLIEST 0 … LATEST 100)。
- 注册调用链:`initMacros()`(`macros.js:717`,调用点 `script.js:7960`)→ `initRegisterMacros()`(`macros.js:746` → `macro-system.js:65`)→ 按序注册 core→env→state→chat→time→variable→instruct 七组宏。

### 2.4 MacroRegistry(`engine/MacroRegistry.js`)

- 单例 `MacroRegistry`;`registerMacro(name, options)`(`:198`)、`registerMacroAlias`(`:241`)、`unregisterMacro`(`:327`)、`hasMacro`(`:336`)、`getMacro`(`:348`)、`getPrimaryMacro`(`:365`)、`getAllMacros`(`:379`)、`executeMacro`(`:397`)。
- **键大小写不敏感**:内部以 `name.toLowerCase()` 存储(`:305`)。
- 注册选项:别名 `aliases`、分类 `category`、无名参数 `unnamedArgs`(数字或定义数组,支持可选参数)、`list`、`strictArgs`、`delayArgResolution`(如 `{{if}}` 用,延迟参数解析)、`handler`、`description`/`returns`/`returnType`/`displayOverride`/`exampleUsage`(`buildMacroDefFromOptions` `:470`)。
- 参数校验:`isArgsValid`(`:698`)、`validateArgTypes`(`:746`)、`isValueOfType`(`:790`)。
- 来源检测:`detectMacroSource`(`:808`)通过调用栈判断是否来自 extension/third-party。
- 分类枚举 `MacroCategory`(`:30-47`):utility/random/names/character/chat/time/variable/prompts/state/misc/uncategorized。

### 2.5 宏优先级/匹配顺序小结

- **旧引擎**:preEnv → env → postEnv 固定顺序(`macros.js:694`),同名冲突由顺序决定(先匹配先替换)。
- **新引擎**:同一时刻按"动态宏(dynamicMacros)> 注册宏"查找(`MacroEngine.js` `#resolveMacro`),嵌套宏由 CST 结构决定自内向外求值;未知宏保留原文。
- `MacroFlags`(`engine/MacroFlags.js`):`!` 立即求值、`?` 延迟求值、`~` 重求值均为 **TBD 未实现**;`#` 保留空白、`/` 闭合块、`>` 过滤器标志(过滤器功能未实现,仅解析)。

---

## 3. 内置宏完整清单

### 3.1 新引擎注册的内置宏(来源全部 registerMacro 调用点)

**core-macros.js**
- `space`(32)、`newline`(50)、`noop`(68)、`trim`(77)、`if`(134,条件宏)、`else`(217)、`input`(228)、`maxPrompt`(236,别名 `maxPromptTokens`)、`maxContext`(246,别名 `maxContextTokens`)、`maxResponse`(256,别名 `maxResponseTokens`)、`reverse`(266)、`//`(282,注释宏,别名 `comment` 隐藏)、`roll`(303)、`random`(340)、`pick`(363)、`banned`(425)、`outlet`(450)

**env-macros.js**(名字/角色卡/环境)
- `user`(16)、`char`(23)、`group`(30,隐藏别名 `charIfNotGroup`)、`groupNotMuted`(38)、`notChar`(45)
- `charPrompt`(53)、`charInstruction`(60)、`charDescription`(67,别名 `description`)、`charPersonality`(75,别名 `personality`)、`charScenario`(83,别名 `scenario`)、`persona`(91)、`mesExamplesRaw`(98)、`mesExamples`(105)、`charDepthPrompt`(128)、`charCreatorNotes`(135,别名 `creatorNotes`)、`charFirstMessage`(143,别名 `greeting`,可带索引)、`charVersion`(168,隐藏别名 `version`/`char_version`)
- `model`(180)、`original`(187,一次性取原文)、`isMobile`(198)

**chat-macros.js**
- `lastMessage`(9)、`lastMessageId`(16)、`lastUserMessage`(24)、`lastCharMessage`(31)、`firstIncludedMessageId`(38)、`firstDisplayedMessageId`(46)、`lastSwipeId`(54)、`currentSwipeId`(62)、`allChatRange`(70)

**time-macros.js**
- `time`(11,可带 `{{time::UTC±N}}`)、`date`(41)、`weekday`(48)、`isotime`(55)、`isodate`(62)、`datetimeformat`(69)、`idleDuration`(85,隐藏别名 `idle_duration`)、`timeDiff`(94)

**variable-macros.js**(均通过 `SillyTavern.getContext().variables`)
- 本地:`setvar`(11)、`addvar`(35)、`incvar`(59)、`decvar`(79)、`getvar`(99)、`hasvar`(119,别名 `varexists`)、`deletevar`(139,别名 `flushvar`)
- 全局:`setglobalvar`(159)、`addglobalvar`(183)、`incglobalvar`(207)、`decglobalvar`(227)、`getglobalvar`(247)、`hasglobalvar`(267,别名 `globalvarexists`)、`deleteglobalvar`(287,别名 `flushglobalvar`)

**state-macros.js**
- `lastGenerationType`(35)、`hasExtension`(43)

**instruct-macros.js**(`registerSimple` 批量注册,`instEnabled=instruct.enabled`, 关则返回空串)
- `instructStoryStringPrefix`、`instructStoryStringSuffix`
- `instructUserPrefix`/`instructInput`、`instructUserSuffix`
- `instructAssistantPrefix`/`instructOutput`、`instructAssistantSuffix`/`instructSeparator`
- `instructSystemPrefix`、`instructSystemSuffix`
- `instructFirstAssistantPrefix`/`instructFirstOutputPrefix`、`instructLastAssistantPrefix`/`instructLastOutputPrefix`
- `instructStop`、`instructUserFiller`、`instructSystemInstructionPrefix`
- `instructFirstUserPrefix`/`instructFirstInput`、`instructLastUserPrefix`/`instructLastInput`
- `defaultSystemPrompt`/`instructSystem`/`instructSystemPrompt`(`:56`)、`systemPrompt`(`:59`)、`exampleSeparator`/`chatSeparator`、`chatStart`

**扩展注册的内置宏**(新引擎开启时走 `macros.register`,关闭时走 `MacrosParser.registerMacro`)
- `authorsNote`、`charAuthorsNote`、`defaultAuthorsNote`(`authors-note.js:606-614`)
- `summary`(`extensions/memory/index.js:1127`)
- `charPrefix`、`charNegativePrefix`(`extensions/stable-diffusion/index.js:5989-5993`)

### 3.2 旧引擎专属宏(`macros.js` `evaluateMacros`,新引擎关闭时仍生效)

- preEnv:`<USER>/<BOT>/<CHAR>/<CHARIFNOTGROUP>/<GROUP>`(624-628)、`{{roll}}`(629)、`{{newline}}`(632)、`{{trim}}`(633)、`{{noop}}`(634)、`{{input}}`(635)
- postEnv:`{{maxPrompt(,Tokens)}}`(643-644)、`{{maxContext(,Tokens)}}`(645-646)、`{{maxResponse(,Tokens)}}`(647-648)、`{{lastMessage}}`(649)、`{{lastMessageId}}`(650)、`{{lastUserMessage}}`(651)、`{{lastCharMessage}}`(652)、`{{firstIncludedMessageId}}`(653)、`{{firstDisplayedMessageId}}`(654)、`{{lastSwipeId}}`(655)、`{{currentSwipeId}}`(656)、`{{allChatRange}}`(657)、`{{reverse:...}}`(658)、`{{// ...}}`注释(659)、`{{time}}`(660)、`{{date}}`(661)、`{{weekday}}`(662)、`{{isotime}}`(663)、`{{isodate}}`(664)、`{{datetimeformat ...}}`(665)、`{{idle_duration}}`(666)、`{{time_UTC±N}}`(667)、`{{outlet::}}`(668)、`{{timeDiff}}`(669)、`{{banned "..."}}`(670,正则 `macros.js:443`)、`{{random}}`(671,正则 `:492`)、`{{pick}}`(672,正则 `:522`)
- `MacrosParser.registerMacro`:`lastGenerationType`(723)、`isMobile`(738)

### 3.3 宏函数 / `{{banned}}` / `{{character}}`

- `{{banned}}`:**宏函数类**,在替换时产生副作用——把词加入 `textgenerationwebui_banned_in_macros` 列表并返回空串(新:`core-macros.js:425`,去掉引号;旧:`macros.js:442-453`,正则 `{{banned "(.*)"}}`)。
- 没有 `{{character}}` 这个宏;角色卡字段宏是 `{{charDescription}}/{{description}}`、`{{personality}}`、`{{scenario}}`、`{{charPrompt}}`、`{{charInstruction}}`、`{{persona}}`、`{{charFirstMessage}}/{{greeting}}` 等(`env-macros.js`)。
- 宏的"函数值":env 中的值可以是函数(旧引擎用 `nonce` 随机串,`macros.js:684`);新引擎 handler 是 `(context) => string`,`context` 含 `args/unnamedArgs/list/flags/isScoped/raw/rawArgs/env/normalize/trimContent/resolve/warn/globalOffset` 等(`MacroRegistry.js` executionContext `:439-460`)。

---

## 4. 自定义宏

**结论:本版本(SillyTavern 当前源码)没有 `/define` 斜杠命令,也没有 `userMacros` 机制**(全库搜索无结果,`/define` 已被移除)。自定义宏的途径是代码级:

1. **JS API(推荐,新引擎)**:`macros.register(name, options)` / `macros.registry.registerMacro` / `macros.registerAlias`(`macro-system.js:57-58`)。引擎自动识别来源 extension(基于调用栈,`MacroRegistry.js:808`)。
2. **旧 API(已弃用)**:`MacrosParser.registerMacro(key, value, description)`(`macros.js:183`),`st-context.js:179-181` 暴露 `context.registerMacro`/`unregisterMacro` 也标记 deprecated。
3. **每次调用的动态宏(dynamicMacros)**:
   - `substituteParams(content, { dynamicMacros: {...} })` / `substituteParamsExtended(content, { ... })`。
   - 值支持三种格式:`string`、`handler function`、`MacroDefinitionOptions 对象`(`MacroEnv.types.js` `DynamicMacroValue`)。
   - 仅在本次求值内可见(新引擎 `#resolveMacro` 中 `Object.hasOwn(env.dynamicMacros, nameLower)` 优先命中;`MacroEnvBuilder` 里键统一转小写)。
4. **作用域**:
   - 注册表宏 = **全局**(任何 substituteParams 调用都生效);
   - dynamicMacros = **单次调用**;
   - 变量宏通过 `{{setvar}}` 系列 + 变量系统实现 **chat 级(本地)与全局** 两种作用域。

---

## 5. 宏与正则脚本的关系(`extensions/regex/engine.js`)

`runRegexScript`(`engine.js:393-448`)中三者替换时机:

- **findRegex(查找正则)**:受 `regexScript.substituteRegex` 控制,枚举 `substitute_find_regex = { NONE:0, RAW:1, ESCAPED:2 }`(`engine.js:300-304`):
  - `NONE` → 原文,不做宏替换(`engine.js:400`);
  - `RAW` → `substituteParamsExtended(regexScript.findRegex)`(`:402`);
  - `ESCAPED` → 带 `sanitizeRegexMacro` 后处理(正则元字符转义,`engine.js:304`、`:404`)。
- **replaceString(替换串)**:先处理 `{{match}}`→`$0`、`$1/$<name>` 捕获组(`:421-422`),最后 `return substituteParams(replaceWithGroups)`(`:444`)——**总是做宏替换**。
- **trimStrings(修剪串)**:`filterString` 内对每个 trim 串调 `substituteParams(trimString, { name2Override: characterOverride })`(`:457-461`)——总是做宏替换。

---

## 6. 宏与 prompt 组装

主生成入口 `Generate`(`script.js:4231`)。宏在"发送给模型前"于多个位置展开:

- **世界书(WI)**:
  - 条目内容在激活扫描时内联替换:`entry.content = substituteParams(entry.content)`(`world-info.js:4939`);内容/键字段替换在 `world-info.js:1307-1310`、`:4803`、`:4835`。
  - `getWorldInfoPrompt(chatForWI, ...)`(`script.js:4576` 调用)返回 `worldInfoString/Before/After/Examples/Depth/OutletEntries`。
- **示例对话(example messages)**:
  - `parseMesExamples` 中 `example_separator` 先替换(`script.js:3451`);
  - WI examples 经 `baseChatReplace`(内部 `substituteParams`,`script.js:3282`)进入 `mesExamplesArray`(`script.js:4583-4590`);
  - Chat Completion 侧:`substituteParams(oai_settings.new_example_chat_prompt)`(`openai.js:1099`)。
- **系统提示 / 角色提示 / jailbreak**:
  - `system`:`substituteParams(system, { original: sysprompt.content })`(`script.js:4631`)或 `baseChatReplace`(`:4633`);
  - `jailbreak`:`substituteParams(jailbreak, { original: sysprompt.post_history })`(`:4691`);
  - OAI 场景/性格格式 `scenario_format/personality_format`(`openai.js:1359-1360`)、`group_nudge`(1361)、impersonation(1362)。
- **故事字符串(story string)**:`renderStoryString`(`power-user.js:2234`)用 `Handlebars.compile(storyString, {noEscape:true})` 渲染,随后 `substituteParams(output, params.user, params.char)` 兜底替换未定义宏(`:2248-2252`);未识别 `{{x}}` 由 `helperMissing` 转发(`macros.js:20-26`)。
- **聊天历史**:
  - 文本补全:组装 `mesSendString`(`script.js:5071-5131`),`addChatsSeparator` 替换 `chat_start`(`:5958`)、`addChatsPreamble` 替换 Novel 前缀(`:5950`);最终 `combinedPrompt = combinedStoryString + mesExmString + mesSendString + generatedPromptCache`(`:5129-5133`)。
  - Chat Completion:`populateChatHistory`(`openai.js:876`),消息经 `substituteParams(newChat)`(`openai.js:885`)、continue 提示(`:902`)等。
- **通用 raw prompt**:`createRawPrompt`(`script.js:3866`)对每条消息 `message.content = prefix + substituteParams(message.content)`(`:3886`)、prefill(`:3877`)、systemPrompt(`:3896`)。
- 其它:`{{input}}` 取自输入框(`macros.js:635` / `core-macros.js:228`);输入框/bias 等见 `script.js:6401/8114`。

---

## 7. 高级宏:条件、变量、JS 表达式

- **条件 `{{if}}`**(`core-macros.js:134`):
  - 支持 `!` 取反、变量简写 `.var`/`$var`、注册宏名自动解析(`getPrimaryMacro` 且 `minArgs===0`)、`{{else}}` 分支(`splitOnTopLevelElse`,`:90`)、`delayArgResolution: true` 使只有被选中的分支才求值;默认去缩进(除非 `#` 标志)。
- **循环**:**没有 `{{for}}/{{loop}}` 宏**。循环能力由斜杠命令 `/while`、`/times` 提供(`variables.js` 中 `whileCallback`/`timesCallback`,详见变量系统)。
- **变量系统**:`SillyTavern.getContext().variables.local/global`。
  - 本地变量存 `chat_metadata.variables`,全局存 `extension_settings.variables.global`(`variables.js` `listVariablesCallback` 附近)。
  - 宏:`{{setvar/getvar/incvar/decvar/addvar/hasvar/deletevar}}` 与 `{{setglobalvar/...}}`(见 3.1)。
  - **变量简写表达式**(新引擎语法级支持):`.varName`、`$varName`,操作符 `++ -- = += -= || ?? ||= ??= == != > >= < <=`(`MacroLexer.js` Var.Operators;求值逻辑 `MacroCstWalker.js` `#evaluateVariableExpr`/`#executeVariableOperation`)。如 `{{.myvar}}`、`{{$counter++}}`、`{{.hp > 5}}`。
  - `{{if {{getvar::showHeader}}}}` 嵌套示例见 `core-macros.js:163`;`index.html:5624` 有设置项防止 `{{getvar}}` 返回的"宏样文本"被二次求值。
- 未发现 `{{firstuser}}` 宏;最接近的是 `{{user}}`、`{{notChar}}`(除当前发言者外全部参与者,`env-macros.js:45`)。

---

## 8. 求值顺序、嵌套、转义与其它

- **求值顺序**:
  - 旧引擎:固定三阶段 pre→env→post(`macros.js:694`),同文本内多宏按正则顺序。
  - 新引擎:单次解析,嵌套宏自内向外(参数/作用域内容在调用 handler 前先递归求值,除非 `delayArgResolution`);`{{if}}` 等控制流自行决定求值哪一分支。`globalOffset` 保证嵌套宏(如 `{{pick}}`)位置可确定性播种(`MacroCstWalker.js` `call.globalOffset = contextOffset + range.startOffset`)。
- **未注册宏**:新引擎**原样保留**(`#resolveMacro` 返回 `raw`,`MacroEngine.js`),不报错。
- **转义**:`\{` `\}` 在 post-processing 还原(`\\(\`{}`]`)→ `$1`,priority 10,`MacroEngine.js` `#registerCorePostProcessors`)。因 `\{\{` 不匹配宏起点,可用来输出字面 `{{`。
- **标志 flags**(`MacroFlags.js`):`#` 保留空白(已实现)、`/` 闭合块(已实现);`!`/`?`/`~`/`>` 均未实现(仅解析)。如 `{{#setvar::x}}  text  {{/setvar}}`。
- **作用域宏**:`{{trim}}` 非作用域用法仍由后处理器清掉周围换行(priority 20,对应旧引擎 `macros.js:633`);作用域用法返回内容并自动 trim。
- **时间参数化**:`{{time::UTC+2}}`(`time-macros.js:11-40`);旧写法 `{{time_UTC+2}}` 由预处理器转写(priority 10)。
- **`{{pick}}` 确定性**:种子 = `chatIdHash + contentHash + globalOffset + pick_reroll_seed`(`core-macros.js:363-422`);`/reroll-pick` 命令改种子(`slash-commands.js:3594`,存 `chat_metadata.pick_reroll_seed`)。
- **`{{pipe}}` 不是宏**:是 **SlashCommand 管道占位符**(上一条命令输出注入),处理于 `slash-commands/SlashCommandClosure.js:178`、`SlashCommandParser.js:666`。
- **`{{idle}}`/`{{idle_duration}}`**:正式名 `{{idleDuration}}`(隐藏别名 `idle_duration`,`time-macros.js:85`);旧引擎仅有 `{{idle_duration}}`(`macros.js:666`)。计算"距上一条用户消息时长"(`getTimeSinceLastMessage`)。
- **`{{random}}` vs `{{pick}}`**:random 每次重新掷(`seedrandom('added entropy.',{entropy:true})`,`core-macros.js:340` / 旧 `macros.js:491`);pick 按位置+内容稳定。
- **一次替换/多阶段**:每个宏结果经 `env.functions.postProcess`(来自 `options.postProcessFn`,`MacroEngine.js` `#resolveMacro`),旧引擎等价于 `postProcessFn(macro.replace(...))`(`macros.js:706`)。

---

## 关键文件索引

- 旧引擎与内置宏:`public/scripts/macros.js`
- 新引擎:`public/scripts/macros/macro-system.js` + `public/scripts/macros/engine/{MacroEngine,MacroRegistry,MacroLexer,MacroParser,MacroCstWalker,MacroEnvBuilder,MacroFlags,MacroDiagnostics,MacroEnv.types,MacroBrowser}.js`
- 内置宏定义:`public/scripts/macros/definitions/{core,env,state,chat,time,variable,instruct}-macros.js`
- 分发入口:`public/script.js`(`substituteParams` 2922 / legacy 2772 / extended 2756)
- 变量系统:`public/scripts/variables.js`
- 正则脚本:`public/scripts/extensions/regex/engine.js`
- 开关:`public/scripts/power-user.js`(302 默认值、3868 绑定)、`public/index.html`(5442)

---

## 一句话总结

SillyTavern 只有 `{{...}}` 宏语法(`{%...%}` 不存在);当前默认启用基于 Chevrotain 的新宏引擎(旧正则引擎仅作兼容),宏分"全局注册宏 + 单次调用动态宏",prompt 在组装各环节(系统提示、世界书、示例、聊天历史、故事字符串、正则脚本)经 `substituteParams`/`substituteParamsExtended` 统一展开,正则脚本中仅 `findRegex` 受 `substituteRegex` 开关控制,`replaceString`/`trimStrings` 恒做宏替换;高级能力(`{{if}}`、变量简写、`{{setvar/getvar}}`)由新引擎和变量系统提供,无循环宏、无 `/define` 命令。
