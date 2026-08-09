# round1 双侧调研:RisuAI / SillyTavern 正则脚本系统

日期:2026-08-09
来源:两路子代理源码调研(Risu: `rius/risuai-src`;Tavern: `SillyTavern/SillyTavern-src`)
范围:数据结构、执行入口、模式/placement 语义、flags、替换语义、作用域优先级、流式/翻译/宏联动、排序、导入导出
> 本文由 `round1-risu-regex.md` + `round1-tavern-regex.md` 按主题对照合一,两侧 `文件:行号` 证据全部保留。

---

## 0. 术语对照与来源

| 概念 | RisuAI | SillyTavern |
|---|---|---|
| 正则脚本 | `customscript`(代码类型名;UI/文档叫 Regex Script) | `RegexScriptData` |
| 脚本存放(角色) | `character.customscript`(`database.svelte.ts:1364`)、群聊 `groupChat.customscript`(`:1524`) | `characters[this_chid].data.extensions.regex_scripts`(SCOPED) |
| 脚本存放(全局) | `Database.presetRegex`(`:1134`,实际生效)/ `Database.globalscript`(`:905`,死代码) | `extension_settings.regex`(GLOBAL) |
| 脚本存放(预设/模块) | bot preset 的 `regex` 字段、`RisuModule.regex`(`modules.ts:23`) | preset 的 extension 字段 `regex_scripts`(PRESET) |
| 处理入口 | `processScriptFull` / `processScript`(`src/ts/process/scripts.ts:99`) | `getRegexedString`(`public/scripts/extensions/regex/engine.js:334`) |

**Risu type 字段值**:`editinput` / `editoutput` / `editprocess` / `editdisplay` / `edittrans` / `disabled`(代码中无 `RegexScript` 类型,该名只出现在翻译字符串)。核心引擎单文件 `scripts.ts`(391 行)。

---

## 1. 数据结构对比

### Risu `customscript`(`database.svelte.ts:1307-1313`)
```ts
export interface customscript{
    comment: string;   // 名称
    in:string          // 正则
    out:string         // 替换模板
    type:string        // 四种模式之一(字符串,非枚举)
    flag?:string       // 原生flags + 自定义 <...> flags
    ableFlag?:boolean  // 是否启用自定义 flag(UI 的 "Custom Flag" 开关)
}
```
- **仅 6 字段**,无 id、无顺序号(`<order n>` 运行时从 flag 解析)、无深度、无独立启用布尔。
- **启用/禁用 = `type === 'disabled'`**:执行时 `script.type === mode`(`scripts.ts:152`)永不匹配 `disabled`。
- UI 编辑器 `RegexData.svelte:112-124`:comment/type 下拉/in/out/flag/ableFlag;UI 原生 flags 只有 `g/i/m/u/s`(`:81-90`)。

### Tavern `RegexScriptData`(`char-data.js:88-102`,13 字段)
```js
@typedef {object} RegexScriptData
@property {string} id            - UUID of the script
@property {string} scriptName
@property {string} findRegex
@property {string} replaceString
@property {string[]} trimStrings
@property {number[]} placement    - 生效位置(数组)
@property {boolean} disabled
@property {boolean} markdownOnly  - 仅对 Markdown(显示)生效
@property {boolean} promptOnly    - 仅对 prompt 生效
@property {boolean} runOnEdit
@property {number} substituteRegex - findRegex 是否宏替换(0/1/2)
@property {number} minDepth
@property {number} maxDepth
```
实际落盘构造 `index.js:848-868`;两个枚举:`regex_placement`(`engine.js:281-292`)、`substitute_find_regex`(`engine.js:298-302`,NONE=0/RAW=1/ESCAPED=2)。

**结论**:Tavern 字段更丰富(深度、trim、substitute、markdown/prompt 分离);Risu 更简,靠"模式 + flag 字符串"组合。

---

## 2. 执行入口与调用点

### Risu:单一入口 `processScriptFull`(`scripts.ts:99`)+ 四模式
`processScript`(`:26`)是包装(chatID=-1)。四模式共用 `executeScript`,`type` 决定哪些脚本参与。

| 模式 | 触发时机 | 输入源 | 调用位置 |
|---|---|---|---|
| **editinput** | 用户发送,消息存入聊天 | 用户原始输入 | `DefaultChatScreen.svelte:194` |
| **editoutput** | 模型输出到达(流式/非流式/重卷) | `reformatContent(prefix+result)` | `index.svelte.ts:1657,1716,1742,1806,1810` |
| **editprocess** | 组装 prompt 时 | 开场白、每条历史 | `index.svelte.ts:873`(firstMessage)、`:902`(ms 循环) |
| **editdisplay** | 渲染 Markdown 时 | 显示文本(不改数据) | `parser/parser.svelte.ts:755` |

- **editinput 细节**:结果写入聊天记录 `cha.push({role:'user', data: await processScript(char,messageInput,'editinput'), ...})`;只有 `char.type==='character'` 走此分支,群聊直接存原始输入(`DefaultChatScreen.svelte:198-204`)。
- **editprocess 细节**:token 化与 HTTP 请求前调用;HypaV3 摘要重生成时也复用(`HypaV3Modal/utils.ts:98-118`,以 editprocess 调用)。
- **processScriptFull 内部顺序**(`:99-144`):①`runLuaEditTrigger` ②display 专属 `runTrigger(currentChar,'display')` ③pluginV2 钩子 ④`risuChatParser(data)`(CBS 预处理) ⑤合并脚本源 `(db.presetRegex??[]).concat(char.customscript).concat(getModuleRegexScripts())` ⑥LRU 缓存查/写 ⑦逐条 `executeScript` ⑧动态资源模糊匹配后处理。

### Tavern:单一入口 `getRegexedString`(`engine.js:334`)+ placement 驱动
`getRegexedString(rawString, placement, { characterOverride, isMarkdown, isPrompt, isEdit, depth })`:
1. 扩展禁用/空串/placement undefined → 直接返回(`:342-344`)
2. `getRegexScripts({allowedOnly:true})`(`:346`)
3. 逐脚本过滤后 `runRegexScript`(`:375`)

调用链:`getRegexedString`(`:334`)→ `getRegexScripts`(`:98`)+ `getScriptsByType`×3(`:108`,GLOBAL/SCOPED/PRESET)→ `runRegexScript`(`:391`)→ `getRegexString()`(substituteRegex 决定是否宏替换 `:397-409`)→ `RegexProvider.instance.get`(`:411`)→ `rawString.replace(findRegex, fn)`(`:419`)。

**聊天管线全部调用点**:

| 位置 | 用途 | placement / flags |
|---|---|---|
| `script.js:1809` | 聊天显示 `messageFormatting` | 动态,`isMarkdown:true`,带 depth |
| `script.js:4447` | **构造 LLM prompt** | 用户→USER_INPUT,AI→AI_OUTPUT,`isPrompt:true`,带 depth |
| `script.js:4486` | prompt 中注入 reasoning | `REASONING`,isPrompt |
| `script.js:5444` | 非流式响应 reasoning | `REASONING` |
| `script.js:5816` | `sendMessageAsUser` | `USER_INPUT` |
| `script.js:6422` | **`cleanUpMessage`(流式/非流式收尾)** | 模拟→USER_INPUT,否则 AI_OUTPUT |
| `script.js:7660/7665` | 开场白/备用 | `AI_OUTPUT`,depth:0 |
| `script.js:8100` | 编辑消息 | 按角色,`isEdit:true` |
| `world-info.js:5086` | 世界书条目 | `WORLD_INFO`,isPrompt,depth=WI深度 |
| `welcome-screen.js:277` | 欢迎屏开场白 | `AI_OUTPUT` |
| `reasoning.js:409/1009/1188/1506/1555` | 推理块 | `REASONING`,1188 为 isEdit |
| `slash-commands.js:4715/5716/5943/6086` | 旁白/角色扮演 STscript | `SLASH_COMMAND` |

**结论**:两者都是"一个引擎 + 调用点决定语义"。Risu 用 `type` 字段挑脚本;Tavern 用 `placement` 参数 + 脚本 placement 数组匹配。

---

## 3. 模式 / placement 语义与过滤

### Risu 四类型共享 `executeScript`(`scripts.ts:145-294`)
四种类型没有各自引擎,`type` 只决定参与集(`:152`)。核心分支(`:182`):OUT 以 `@@` 开头 **或** 存在自定义 actions 时走"特殊效果"路径,否则普通 `String.replace`:

| OUT 前缀 / action | 行为 | 位置 |
|---|---|---|
| `@@emo <name>` | 命中则设角色表情(写 `CharEmotion`,限 4、去重) | `:184-206` |
| `@@inject` / `<inject>` | 把当前 `data` 写回 `message[chatID].data`,再删匹配 | `:207-211` |
| `@@move_top/bottom` / `<move_top/bottom>` | 整块移到顶/底 | `:212-246` |
| `@@repeat_back` / `<repeat_back>` | 无匹配时回溯同 role 上一条取其结果拼入(end/start/end_nl/start_nl) | `:252-287` |
| 其它 | `data.replace(reg, outScript)` 后再次 `risuChatParser` | `:248,291` |

- move_top/bottom 临时移除 `g`(`:160-162`),只处理**第一个匹配**。
- `@@` 系列仅正则命中(`reg.test(data)`)时生效;未命中且无 repeat_back 则无事(`:183,251`)。
- `edittrans` 文档未提及,只被翻译器使用(见 §7)。

### Tavern placement 枚举与过滤
当前枚举(`engine.js:281-292`):`MD_DISPLAY:0`(废弃,仅迁移)/`USER_INPUT:1`/`AI_OUTPUT:2`/`SLASH_COMMAND:3`/`4`(sendAs legacy)/`WORLD_INFO:5`/`REASONING:6`。**本版本无 interrupt/start/in-chat 语义**(grep 确认无残留);placement 是"Affects"复选框数组(`editor.html:80-109`,值 1/2/3/5/6),可多选。匹配:`script.placement.includes(placement)`(`:374`)。

**markdownOnly/promptOnly 三分法**(`engine.js:348-354`):
```js
(script.markdownOnly && isMarkdown) ||                       // 仅显示
(script.promptOnly && isPrompt) ||                           // 仅 prompt
(!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)  // 默认
```
- 默认路径 = 既非显示也非 prompt:流式 `cleanUpMessage`(`6422`)、用户输入(`5816`)、旁白/斜杠、编辑(`8100`)、开场白(`7660`)。
- 编辑器默认新脚本:markdownOnly=true、runOnEdit=true、placement=[USER_INPUT](`index.js:797-809`)。

**旧值迁移**(`index.js:1374-1414`):无 id 补 UUID;含 MD_DISPLAY(0) → 移除并设 markdownOnly+promptOnly=true;旧 4(sendAs) → `[SLASH_COMMAND]`。

---

## 4. flags 体系对比(核心差异)

### Risu:自定义 `<...>` 先剥离后拼回(`scripts.ts:296-341`)
剥离阶段(`:298-330`):
```ts
if(script.ableFlag && script.flag?.includes('<')){
    const rregex = /<(.+?)>/g
    scriptData.flag = scriptData.flag?.replace(rregex, (v, p1) => {
        const meta = p1.split(',').map(v => v.trim())   // 支持逗号分隔
        for(const m of meta){
            if(m.startsWith('order ')){ order = parseInt(m.substring(6)); orderChanged = true }
            else actions.push(m)                        // 其余全进 actions
        }
        return ''                                       // 从 flag 中移除
    })
}
```
- 自定义 flags 只产生两类产物:`order`(数字)与 `actions`(`inject`/`move_top`/`move_bottom`/`repeat_back`/`cbs`/`no_end_nl`)。
- 例:`gi<cbs><move_top>` → 原生 `gi` 保留,`cbs`、`move_top` 进 actions。

执行阶段(`:156-181`):
- **`ableFlag=false` 时强制 `flag='g'`**(`:156-159`),此时 `<...>` 不会剥离(剥离以 ableFlag 为前提),被净化正则直接丢弃 → **自定义 flag 在 ableFlag=false 时静默失效**。
- move_top/bottom 先移除 `g`(`:160-162`)。
- 原生白名单净化 `flag.replace(/[^dgimsuvy]/g,'')`(`:167`),去重(`:170`),空则兜底 `'u'`(`:172-174`)。
- `<cbs>`:`input = risuChatParser(input)` 把 IN 当 CBS 模板解析后再作正则(`:176-179`);缓存键在未剥离阶段用 `flag?.includes('<cbs>')` 判断并预解析 IN(`:77`)。

### Tavern:`/pattern/flags` + substituteRegex(无自定义 flag 体系)
`regexFromString`(`utils.js:1388-1403`):支持 `/pattern/flags`,flags 白名单 `[gmixXsuUAJ]`,非法 flags 退化为 `RegExp(input)`。编译缓存 `RegexProvider`(LRU 1000,`get()` 重置 lastIndex 处理 `g`/`y`,`engine.js:40-90`)。
- **宏替换替代 flag 功能**:`substituteRegex`(0/1/2)控制 findRegex 是否 `substituteParams`,`ESCAPED(2)` 还转义正则元字符(`sanitizeRegexMacro`,`engine.js:304-324`)。
- 无 order/inject/move 概念——顺序靠数组拖拽 + 作用域优先级。

**结论**:Risu 用 flag 字符串内嵌指令(功能强但隐蔽);Tavern 用结构化字段显式表达。

---

## 5. 替换语义(OUT / replaceString)对比

| 能力 | Risu | Tavern |
|---|---|---|
| 数字组 `$1` | ✅ 原生 replace(`$1`~`$99`) | ✅ 函数内手动 `$n` |
| 整段 `$&` / `{{match}}` | ✅ `{{data}}`→`$&` | ✅ `{{match}}`→`$0` |
| 命名组 | 文档写 `$(name)`,**实际只支持 `$<name>`**(`scripts.ts:231-237`) | ✅ `$<name>` |
| 特殊 `$n`→换行 | ✅ 自定义(`:154` `replaceAll("$n","\n")`,**一切替换前执行**,`$$n` 转义无效) | ❌ 无 |
| 尾部 `>` 自动补换行 | ✅(`:163-165`,除非 `no_end_nl`) | ❌ 无 |
| 函数替换 | ❌ 不支持 | ❌ 不支持(注释明示) |
| trim | ❌ 无 | ✅ `trimStrings[]`(`engine.js:457-464`) |
| 结果宏替换 | ✅ 替换后必再过 CBS(`:248,291`) | ✅ 结果过 `substituteParams`(`engine.js:444`) |
| `@@` 特殊效果 | ✅ `@@emo` 等(§3) | ❌ 无 |

### Risu OUT 预处理(`scripts.ts:15,154-165`)
```ts
const dreg = /{{data}}/g                                // :15
let outScript2 = script.out.replaceAll("$n", "\n")     // :154  $n → 换行(自定义,一切替换前)
let outScript  = outScript2.replace(dreg, "$&")        // :155  {{data}} → $&(整体匹配)
if(outScript.endsWith('>') && !pscript.actions.includes('no_end_nl')){
    outScript += '\n'                                  // :163-165  OUT 以 > 结尾自动补换行
}
```
普通路径 `data.replace(reg, outScript)`(`:248,291`)用**原生 JS `String.prototype.replace`**,故 `$1`/`$&`/``$` ``/`$$`/`$<name>` 按 JS 语义生效。

**文档与实现不一致**(Risu):
- `$(name)` 文档宣称支持(`lang/en.ts:70`、`lang/cn.ts:67` 等),实现无任何 `$(` 转换逻辑,真正生效是 `$<name>`;move_top/bottom 路径显式 `/(?<!\$)\$<([^>]+)>/g`(`:231-237`)。
- move_top/bottom 路径还手动实现 `$n`(`/(?<!\$)\$[0-9]+/g`,`:223-229`)与 `$&`(`:230`),带负向断言避免处理 `$$`。
- **函数替换不支持**:所有路径把 outScript 当字符串传给 replace。

### Tavern 替换实现(`engine.js:419-445`)
```js
newString = rawString.replace(findRegex, function (match) {
    const args = [...arguments];
    const replaceString = regexScript.replaceString.replace(/{{match}}/gi, '$0');
    const replaceWithGroups = replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
        if (num) match = args[Number(num)];
        else if (groupName) { const groups = args[args.length-1]; match = groups[groupName]; }
        if (!match) return '';
        return filterString(match, regexScript.trimStrings, { characterOverride });  // 先裁剪
    });
    return substituteParams(replaceWithGroups);         // 最后宏替换
});
```
- replaceString 是字符串模板,不支持 JS 函数;支持 `{{match}}`/`$1`/`$<name>`;trimStrings 在组引用处裁剪;最终整体再过 `substituteParams`。
- trimStrings 逐条 `substituteParams` 后 `replaceAll('')` 删除(`:457-464`)。
- 注释明确 "Currently does not support the Overlay strategy"(`:418`)。
- **输入文本 rawString 不做宏替换**(引擎不替换);findRegex 宏仅当 `substituteRegex≠NONE`(`:397-409`)。

**结论**:Risu 的 OUT 语义更"重"(`@@` 动作 + 自动换行 + `$n`);Tavern 更"纯替换"(trim + 宏替换)。功能侧重不同。

---

## 6. 作用域与优先级对比

### Risu 合并顺序(`scripts.ts:134`)
```
db.presetRegex → char.customscript → getModuleRegexScripts()
```
- 逐条执行,前一条输出作为后一条输入(`:335-341`)。
- `getModuleRegexScripts()`(`modules.ts:476-489`)聚合已启用模块(`getModules`,`:426-472`)的 `module.regex`;模块 "Apply" 到角色时逐个 push 进 `char.customscript`(`modules.ts:536-539`)。
- `<order n>` 存在时整体降序排序(§8)。
- **坑**:设置页 `GlobalRegex.svelte:11` 编辑的是 `db.globalscript`,**不参与执行**(全库仅被 `GlobalRegex.svelte` 和 `exportRegex()` 默认参数引用,`scripts.ts:32`);真正"全局"是 `db.presetRegex`(bot preset 一部分:`saveCurrentPreset` 导出 `:2104`,`setPreset` 载入 `:2229`,UI 在 `BotSettings.svelte:788`)。
- 导入导出:`exportRegex`/`importRegex`(`:30-66`)以 `{type:'regex',data:[...]}` 格式;模块导入支持 `type==='regex'` 转模块(`modules.ts:340-347`)。

### Tavern 作用域 `SCRIPT_TYPES`(`engine.js:11-16`,注释 "ORDER MATTERS")
```
GLOBAL: 0 (extension_settings.regex) → SCOPED: 1 (角色 extensions.regex_scripts) → PRESET: 2 (preset 的 'regex_scripts')
```
- `getRegexedString` 固定传 `allowedOnly:true`(`:346`):scoped 需 `character_allowed_regex` 含角色 avatar,preset 需 `preset_allowed_regex[apiId]` 含 preset 名(`:108-133`)。
- 首次遇到角色/preset 自带脚本会弹窗询问(accountStorage 记 `AlertRegex_*` 键,`index.js:1606-1633,1650-1677`)。
- 执行按枚举值顺序 `GLOBAL→SCOPED→PRESET`(`:99`),类型内按数组顺序(可拖拽,`index.js:1912-1953`)。
- 默认初始化:`extensions.js:178-185`。

**结论**:Risu 顺序可运行时覆盖(`<order n>`),来源固定三段;Tavern 三段优先级硬编码,顺序靠拖拽。

---

## 7. 联动:流式 / 翻译 / 宏 / 缓存

### 流式(方向相反)
| 方面 | Risu | Tavern |
|---|---|---|
| 机制 | `editoutput` 在输出到达(流式/非流式/重卷)时处理 `reformatContent` | 流式**每 chunk 在 `cleanUpMessage`(`script.js:3600→6422`)对累计全文重跑**;非 markdown 脚本每 chunk 生效,markdownOnly 在 `messageFormatting`(`1809`)生效,收尾再跑一遍 |
| 显示 vs 数据 | `editdisplay` 仅改显示 | markdownOnly 仅显示,promptOnly 仅 prompt |
| 已知行为 | — | 对累计全文重复应用,替换随 chunk 叠加;最终消息还可能在 `saveReply`/重新渲染中被再次应用 |

### 翻译(Risu 独有,`translator.ts`)
- (a) 翻译后重跑 `editdisplay`(`:365-408`),由 `db.combineTranslation` 触发(`:436-438`)。
- (b) `edittrans` 专用脚本(`:621-639`):翻译流程末尾应用(`:295,306,492`),UI 为 "Edit Translation Display"(`lang/en.ts:1092`)。**注意**:顺序只有"模块→角色"(不含 presetRegex);独立简陋实现(只处理 `$n`,无 `@@`/自定义 flag/`<cbs>`,`new RegExp(script.in, script.ableFlag ? script.flag : 'g')`)。

### 宏联动对比
| 位置 | Risu | Tavern |
|---|---|---|
| 数据源 | `processScriptFull` 内先 `risuChatParser(data)` 整体过宏(`scripts.ts:133`) | 引擎不替换输入文本宏 |
| findRegex(IN) | 仅 flag 含 `<cbs>` 时展开(`:176-179`) | 仅 `substituteRegex≠NONE`(RAW/ESCAPED) |
| replaceString(OUT) | 替换后必再跑 `risuChatParser`(`:248,291`) | **总是** `substituteParams`(`engine.js:444`) |
| trimStrings | ❌ 无 | 每条 `substituteParams`(`:457-464`) |
| 上下文先后 | — | 显示:先 `substituteParams`(仅 messageId 0,`script.js:1761`)再 regex(`1809`);流式 cleanUpMessage:先宏拼 user_prompt_bias(`6401`)再 regex(`6422`);prompt:先 regex(`4447`),宏在后续组装阶段 |

**结论**:Risu 的"输入先整体过宏、OUT 后再过宏、IN 可选";Tavern 的"replaceString/trim 恒宏替换、findRegex 可选且可转义"。功能等价,实现位置不同。

### 缓存
- Risu:`processScriptCache` LRU 1000(`scripts.ts:68-97`),键含 data+mode+各同 mode 脚本的(IN/OUT/chatID/flag/ableFlag)(`:71-80`);`resetScriptCache()`(`:95`)。
- Tavern:`RegexProvider` LRU 1000(`engine.js:40-90`)。

---

## 8. 排序 / 导入导出 / 已知坑

### Risu `<order n>` 排序(`scripts.ts:332-334`)
```ts
if(orderChanged){ parsedScripts.sort((a, b) => b.order - a.order) }  // 降序,order 越大越先,默认 0
```
- 仅当至少一个脚本声明 `<order n>`(`orderChanged=true`,`:309`)才排序;否则保持数组原始顺序。现代 JS `sort` 稳定,同 order 保持原相对顺序。
- 排序作用域是**全部脚本**(跨模式);不匹配当前 mode 的只是执行时被 `:152` 跳过。
- "higher order shown first" = higher order 先被处理,后执行脚本基于其结果叠加。

### Risu 其它值得注意的坑
- **`<inject>` 语义与文档相反**:文档说"注入",实现是"把当前中间态 `data` 写回 `message[chatID].data` 再删匹配"(`:207-211`)。
- **`@@emo` 表情历史限 4 个**并去重(`:191-205`)。
- **HypaV3 联动**:`hypaV3.ts:40,1801` 的 `processRegexScript` 开关("重新生成时应用正则脚本",`OtherBotSettings.svelte:1222`)控制摘要重卷时是否用 editprocess(`modal-footer.svelte:33,45,51`、`modal-summary-item.svelte:215`)。
- **MCP 工具**可读写删角色 regex(`mcp/risuaccess/characters.ts:730-910`,字段 `:749-757`)与模块 regex(`mcp/risuaccess/modules.ts:649-760`)。

### Tavern 导入导出 / 预设
- **无内置脚本**;新建默认 markdownOnly=true、runOnEdit=true、placement=[USER_INPUT](`index.js:797-809`)。
- **RegexPreset**(与"preset 作用域"是两回事,`index.js:47-478`):存 `extension_settings.regex_presets`(`extensions.js:180-181`),元素 `{id,name,isSelected,global:[{id}],scoped:[{id}],preset:[{id}]}`——只记**启用脚本 id 快照**(`regexListToPresetItems` `:400-406` 过滤 disabled);方法 `applyPreset`(`:369`)/`savePreset`(`:414`)/`deletePreset`(`:455`);斜杠命令 `/regex-preset`(`:264-309`)。
- 导入导出:单个导出 `index.js:700-704`(JSON 下载 `regex-<名>.json`);批量 `:1900-1910`;导入 `:1750-1767`(`importTarget.html` 选作用域),`onRegexImportFileChange`(`1540`)支持数组,`onRegexImportObjectChange`(`1499`)**重新分配 UUID**;保存 `saveScriptsByType`(`engine.js:141-159`)。
- 斜杠命令:`/regex`(`:2051`)、`/regex-state`(`:2071`)、`/regex-toggle`(`:2102`)。
- **placement 0/4 已废弃**(旧版 interrupt/start/in-chat 语义已移除,迁移逻辑 `index.js:1374`)。

---

## 9. 双侧关键结论(供 round6 spec 引用)

**Risu**:少字段 + 字符串 flag 内嵌指令(`<order>/<move_top>/<inject>/<cbs>`) + `@@` 动作 + 固定三段来源(预设→角色→模块)+ `<order n>` 降序 + 自动换行/`$n`→换行/`{{data}}`→`$&`。

**Tavern**:多字段 + placement/markdownOnly/promptOnly/depth/substituteRegex 显式控制 + trim + 宏替换 + 三段作用域(GLOBAL→SCOPED→PRESET,拖拽排序)+ 流式每 chunk 对累计全文重跑。

**映射要点**(细节见 `round6-converter-spec.md` §4):Tavern 13 字段 → Risu customscript 6 字段 + flag 指令;placement → type 拆分;markdownOnly/promptOnly → editdisplay/editprocess 拆分;minDepth/maxDepth → OUT `{{#if}}`(round5 §7);trimStrings/runOnEdit → 丢弃报告;substituteRegex RAW→`<cbs>`,ESCAPED→人工。
