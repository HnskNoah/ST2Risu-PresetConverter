# RisuAI 触发器(Trigger)系统调研报告 — Round 5

日期:2026-08-09
来源:子代理源码调研(`rius/risuai-src`)
范围:触发器数据结构、六种模式、正则效果、写回消息能力、条件系统、注入能力、与正则脚本的等效对比、执行成本

核心文件:`src/ts/process/triggers.ts`(2821 行,引擎全在此)、`src/ts/process/scripts.ts`、`src/ts/storage/database.svelte.ts`、`src/ts/process/index.svelte.ts`

---

## 1. 数据结构

### 1.1 一个 trigger 对象的字段(`triggers.ts:20-26`)

```ts
export interface triggerscript{
    comment: string;
    type: 'start'|'manual'|'output'|'input'|'display'|'request'
    conditions: triggerCondition[]
    effect:triggerEffect[]
    lowLevelAccess?: boolean
}
```

- `comment`:触发器名(manual 模式靠它按名匹配,`triggers.ts:1228-1231`)。
- `type`:六种模式。
- `conditions`:条件数组,全部通过才执行(`triggers.ts:1237-1313`)。
- `effect`:效果数组,顺序执行,支持 V2 缩进块(if/loop)。
- `lowLevelAccess`:是否放行危险效果(showAlert/sendAIprompt/runLLM/checkSimilarity/extractRegex/runImgGen 等,`triggers.ts:1426-1544`)。

### 1.2 条件类型(3 种,`triggers.ts:51-74`)

```ts
triggerConditionsVar    = { type:'var'|'value', var, value, operator:'='|'!='|'>'|'<'|'>='|'<='|'null'|'true' }
triggerConditionsChatIndex = { type:'chatindex', value, operator:... }
triggerConditionsExists = { type:'exists', value, type2:'strict'|'loose'|'regex', depth:number }
```

### 1.3 效果类型
- V1 效果(`triggers.ts:31`):cutChat, modifyChat, systemprompt, impersonate, command, extractRegex, setvar, showAlert, runtrigger, stop, sendAIprompt, runLLM, runAxLLM, checkSimilarity, runImgGen。
- V2 效果(`triggers.ts:32-49`):约 100 种。
- 代码效果 `triggerCode`:`type:'triggercode'|'triggerlua'`(`triggers.ts:58-61`)。

### 1.4 存放位置
- `character.triggerscript: triggerscript[]`(`database.svelte.ts:1365`);模块 `trigger`(`modules.ts`);`chat.scriptstate` 存触发器持久变量(`database.svelte.ts:1815-1836`)。

触发器变量系统:`getVar`/`setVar`(`triggers.ts:1176-1219`)——存于 `chat.scriptstate['$'+key]`,写回当前 chat 与 DB 的 `scriptstate`,实现跨次发送持久;另支持 `defaultVariables` 初始值(`triggers.ts:1086`)。

---

## 2. 六种模式的调用时机与可拿数据

| 模式 | 调用点 | 时机 | 传入 arg |
|---|---|---|---|
| **start** | `index.svelte.ts:888` | 每次发送、组装 prompt 前 | `{chat: currentChat}`(整个历史消息数组) |
| **input** | `DefaultChatScreen.svelte:187` | 用户点击发送、**新消息入队之前** | `{chat: char.chats[char.chatPage]}` |
| **output** | `index.svelte.ts:1763`(流式)、`:1871`(非流式) | 角色回复已写入历史消息之后 | `{chat: currentChat}` |
| **request** | `request/request.ts:249` | 每个请求**发出前**,在 fallback 重试循环内 | `{chat, displayMode:true, displayData: JSON.stringify(formated)}` |
| **display** | `scripts.ts:109`(由 `processScriptFull` 的 `editdisplay` 触发,`parser.svelte.ts:755` 每次渲染) | 每次消息显示渲染时 | `{chat, displayMode:true, displayData: <待显示文本>}` |
| **manual** | `Chat.svelte:249`、`command.ts:230`、递归 `triggers.ts:1395/1793` | 按需 | `{chat, manualName}` |

`runTrigger` 签名:`triggers.ts:1058-1068`,返回 `{additonalSysPrompt, chat, tokens, stopSending, sendAIprompt, displayData, tempVars}`(`:2819`)。

**非 display/request 模式会 `safeStructuredClone(char/chat)`**(`triggers.ts:1070,1087`)——在副本上操作,只有调用方把返回的 `chat` 写回 DB 才生效(start 用 `setCurrentChat`,`index.svelte.ts:890-891`;output 用 `DBState...chats[...] = currentChat`,`:1770/:1873`;input 用 `cha = triggerResult.chat.message`,`DefaultChatScreen.svelte:189`)。

### ⚠️ input/output 模式能否拿到"单条消息文本"做正则改写?
- **不能直接拿单条消息作为输入串**,只拿到整个 `chat.message` 数组。但可以**先读出再改写再写回**:
  - 读:`v2GetLastMessage`(`:1953`)、`v2GetMessageAtIndex`(`:1957`)、`v2GetMessageCount`(`:1962`)、`v2GetLastCharMessage`(`:2301`)、`v2GetLastUserMessage`(`:2296`)。
  - 改写:`v2ReplaceString`/`v2ExtractRegex` 等字符串效果。
  - 写回:`v2ModifyChat`(按 index 改 `message[index].data`,`:1830-1836`)、`v2CutChat`(`:1817`)、`v2Impersonate`(`:1843`)。
- **input 模式局限**:在用户新消息 **push 之前**执行,看不到当前输入。用户输入只能被正则脚本 `editinput` 处理(`DefaultChatScreen.svelte:194`)。→ "提取用户输入"触发器**做不了**。

---

## 3. 正则相关效果(重点)

### 3.1 v2ReplaceString(正则替换,`triggers.ts:955-969` 定义 / `:2754-2791` 实现)
参数:`source/sourceType`、`regex/regexType`、`flags/flagsType`、`result(result 模板)`、`replacement`、`outputVar`。实现:

```ts
const regex = new RegExp(regexPattern, flags)
const result = source.replace(regex, (...args) => {
    const match = args[0], groups = args.slice(1,-2)
    const targetGroupMatch = resultFormat.match(/^\$(\d+)$/)
    if (targetGroupMatch) { ... }           // 支持 $0..$n 组模板 + 组内替换
    return resultFormat.replace(/\$[0-9]+/g, ...).replace(/\$&/g, match)...
})
setVar(outputVar, result)
```
- 能对 source 文本做正则替换,模板支持 `$0`、`$1..$n`(捕获组)、`$&`(整匹配)、`$$`(字面 `$`)。
- **结果写入 `outputVar`(脚本变量)**,不会自动写回消息——需要再配合 `v2ModifyChat`/`v2SetDisplayState`/`v2SetRequestState` 落位。
- 出错时回退返回 `source` 原值(`:2786-2789`)。

### 3.2 v2ExtractRegex(正则提取,`triggers.ts:329-341` / `:1932-1951`)
用 `regex.exec(value)` 取**第一个匹配**,把 `$0/$1/…/$&` 按 `result` 模板拼成字符串存入 `outputVar`。无匹配时按空组替换(`:1946-1948`)。

### 3.3 v2RegexTest(正则判断,`triggers.ts:758-768` / `:2596-2607`)
`new RegExp(regex, flags).test(value)`,返回 `1`/`0` 存入 `outputVar`(非布尔),出错为 `0`。

### 3.4 v2QuickSearchChat(历史深度搜索,`triggers.ts:729-738` / `:2432-2453`)
在 `chat.message.slice(0-depth)`(最近 depth 条)拼接文本上做:
```ts
strict: da.split(' ').includes(value)        // 整词
loose : da.toLowerCase().includes(value.toLowerCase())  // 子串
regex : new RegExp(value).test(da)           // 正则
```
结果 `1`/`0` 存入 `outputVar`。

### 3.5 V1 extractRegex(仅 lowLevelAccess,`triggers.ts:114-121` / `:1509-1524`)
`regex.exec(value)` + `$0/$n` 模板→ `setVar(effect.inputVar, result)`。需要 `char.lowLevelAccess`。

### 3.6 辅助字符串/数组效果
`v2SplitString`(支持 `/re/flags` 正则分隔,`:2061-2093`)、`v2JoinArrayVar`(`:2095`)、`v2ConcatString`(`:2290`)、`v2SetCharAt`(`:2052`)、`v2ToLowerCase/UpperCase`(`:2042/:2047`)、`v2GetCharCount`(`:2037`)、`v2Calculate`(算术,`:2738`)、全套数组/字典效果(`:2147-2288`, `:2627-2737`)。结果均为字符串,统一存 `outputVar`。

---

## 4. 效果能否写回消息/prompt

**结论:能,但取决于模式**(allowlist 限制):

| 效果 | 作用 | 可用模式 |
|---|---|---|
| `setvar`/`v2SetVar` | 写脚本变量(持久化到 `scriptstate`) | 除 display(写 tempVars)外的所有模式 |
| `cutchat`/`v2CutChat` | `chat.message = chat.message.slice(start,end)`(删历史) | start/input/output/manual |
| `modifychat`/`v2ModifyChat` | `chat.message[index].data = value`(改写单条历史/回复) | 同上 |
| `v2Impersonate` | push 一条 user/char 消息 | 同上 |
| `systemprompt`/`v2SystemPrompt` | 累积到 `additonalSysPrompt[location]` | 同上 |
| `v2SetDisplayState` | 覆盖 `arg.displayData`(要显示文本) | **仅 display**(allowlist) |
| `v2SetRequestState`/`v2SetRequestStateRole` | 覆盖请求数组 `json[index].content/role` | **仅 request**(allowlist;实现 `:2389-2421`) |
| `v2SetCharacterDesc`/`v2SetPersonaDesc`/`v2SetReplaceGlobalNote`/`v2SetAuthorNote`/`v2SetLorebookActivation`/`v2ModifyLorebook` 等 | 直接改角色/数据库 | 所有模式 |
| `v2StopPromptSending`/`stop` | 置 `stopSending`,start 模式直接终止本次发送 | 所有模式 |
| `v2UpdateChatAt`/`v2UpdateGUI` | 触发 UI 刷新 | 所有模式 |

- **allowlist 机制**:display 模式只执行 `displayAllowList`(safeSubset + 两个 displayState 效果);request 模式只执行 `requestAllowList`。其余效果直接 `continue` 跳过(`triggers.ts:1320-1325`)。`safeSubset` 见 `:985-1021`(setVar/if/loop/regex/数组/字符串,不含任何读写历史消息的效果)。
- **注意**:没有 `v2SetMessage`/`modifyMessage`。改写单条消息对应 `v2ModifyChat`(按 index 覆盖 `data`)与 request 态 `v2SetRequestState`。
- display 模式回写:引擎把 `arg.displayData` 原样返回(`:2819`),`scripts.ts:115` 收走:`data = d?.displayData ?? data`。

---

## 5. 条件系统

- **condType 枚举**:`'var' | 'value' | 'chatindex' | 'exists'`(`triggers.ts:1239`)。
- **operator 枚举**:`'=' | '!=' | '>' | '<' | '>=' | '<=' | 'null' | 'true'`(`triggers.ts:55`)。
- **求值逻辑** `triggers.ts:1238-1313`:
  - `var`:取 `getVar(condition.var)`(`scriptstate.$var` → defaultVariables → `'null'`);
  - `chatindex`:取 `chat.message.length.toString()`(消息条数);
  - `value`:取 `condition.var` 字面值;
  - 左右两侧过 `risuChatParser` 解析模板(`:1249-1250`),`'true'` 判 `'true'`/`'1'`,`'>'/'<'` 用 `Number()` 比较;
  - `exists`(`:1296-1308`):最近 `depth` 条消息文本拼接后,`strict`=整词、`loose`=小写子串、`regex`=`new RegExp(val).test(...)`。
- **v2 块内条件** `v2If`/`v2IfAdvanced`(`triggers.ts:1612-1724`):操作符 `∈ ∋ ∉ ∌ ≒ ≡`(包含/近似/真值判断)。
- **条件能针对什么判断**:只有"变量值 / 消息条数 / 最近 N 条历史文本"。**不能在条件里直接针对单条消息内容做正则匹配**——需靠效果(`v2RegexTest`/`v2GetMessageAtIndex`+分支)实现。

---

## 6. 注入能力

- **`systemprompt`/`v2SystemPrompt` 效果**(`triggers.ts:1367-1370`、`:1838-1841`):`additonalSysPrompt[location] += value + "\n\n"`,`location: 'start'|'historyend'|'promptend'`。
- **落位** `index.svelte.ts:1197-1216`:
  - `start` → `unformated.lastChat.unshift`(历史最前);
  - `historyend` → `unformated.lastChat.push`(历史末尾);
  - `promptend` → `unformated.postEverything.push`(整个 prompt 最末)。
- `additonalSysPrompt` 类型:`triggers.ts:170-174`。start/output 模式返回后由主流程拼接,并计入 token 预算(`triggers.ts:2799-2808`)。
- 这是"注入 prompt 各位置"的唯一内置途径,等效 Tavern 的深度注入但位置更精细。

---

## 7. 与正则脚本的等效对比(四类需求逐条评估)

| 需求(对应 tavern 正则) | 正则脚本现状 | 触发器能否实现 | 程度 |
|---|---|---|---|
| **删除历史消息中的思考块**(editprocess) | editprocess 每次发送对每条历史消息跑正则(`index.svelte.ts:902-904`) | ✅ 能 | **能做但繁琐**:`start`/`input` 模式对 `chat.message` 用 `v2LoopNTimes(条数)` + `v2GetMessageAtIndex` → `v2ReplaceString(正则,空)` → `v2ModifyChat` 写回,再 `v2UpdateChatAt` 刷新。需 4~6 个效果节点,且无法一步"循环直到无匹配"。正则脚本仅 1 行。**不推荐替代** |
| **仅显示时美化**(editdisplay) | editdisplay 正则脚本 + 显示触发器都在 `processScriptFull` 里跑(`scripts.ts:104-122` 触发器在前,`:133+` 正则在后) | ✅ 完全能 | display 触发器拿到 `displayData`,用 safeSubset 内正则效果处理后 `v2SetDisplayState` 写回。**但 display 态无法读取其他历史消息**(allowlist 不含消息读取),只能针对当前这条文本;且不能改历史消息本身。对"纯美化"足够 |
| **提取用户输入**(editinput) | editinput 直接改写 `messageInput`(`DefaultChatScreen.svelte:194`) | ❌ 基本不能 | input 触发器在用户消息**入队前**运行,拿不到新输入(`DefaultChatScreen.svelte:187-197`)。只能读上一条 user 消息(`v2GetLastUserMessage`)。**不可替代** |
| **按消息深度过滤后再处理**(tavern minDepth/maxDepth) | 本仓库正则脚本**不支持** minDepth/maxDepth(flag meta 仅 order/cbs/inject/move_top/move_bottom/repeat_back/no_end_nl,`RegexData.svelte:75-78`、`scripts.ts:299-330`) | ✅ 能(更强) | `exists` 条件自带 `depth`(`triggers.ts:1296-1308`),`v2QuickSearchChat` 自带深度(`:2432-2453`),`chatindex` 条件按消息数门控。**这是触发器超越当前正则脚本的地方** |

**总体结论**:
- 触发器是"图灵完备的块式逻辑引擎",在 **start/output/input** 模式下拥有对历史消息的完整读写(删除/改写/追加/注入/中止发送)。
- 但在**单一消息正则改写**这件事上,正则脚本的 `editinput/editprocess/editoutput` 是逐条消息零配置处理,触发器需要循环+变量+写回,工程上明显更重。
- 二者互补:**正则脚本适合"每条消息的字符串变换",触发器适合"基于变量/深度的条件流程控制、跨消息协同、注入与中止"**。

---

## 8. 执行成本 / 限制

- **执行频率**:每次发送跑 start+input 各一次;output 每次生成后一次;request **每次请求尝试都跑**(含 fallback 重试,`request.ts:222-260`);display **每次渲染每条消息都跑**(性能开销被 `console.log('Trigger time')` 记录,`scripts.ts:116`)。
- **防滥用机制**(很少):
  - `runtrigger`/`v2RunTrigger` 递归深度上限 **10**(`triggers.ts:1393,1791`);
  - 循环保护:loopTimes>100 时 `sleep(1)` 让出(`:1765-1769`);
  - 危险效果全部要求 `lowLevelAccess`(`:1426-1544`, `:1858-1897`);
  - **无发送频率/条数限制,无超时限制**。
- **能否访问历史消息数组**:能——`arg.chat` 传入整个 `chat.message`。但 **display/request 两种模式下不能通过效果读历史**(allowlist 限制),只能读 `displayData`。
- **其他限制**:
  - 群聊角色不跑触发器(`request.ts:247`、`DefaultChatScreen.svelte:186`、`scripts.ts:106` 均有 `type !== 'group'` 判断),但模块可带触发器(`getModuleTriggers`,`triggers.ts:1084`)。
  - `triggercode`/`triggerlua` 作首效果时忽略 type 模式匹配(`:1225`),会跑 Lua 脚本引擎(`scriptings.ts:52-...`,沙箱 API 有 setChat/cutChat/addChat 等,`:154-261`)。

---

## 附:关键代码速查表

| 事项 | 位置 |
|---|---|
| runTrigger 入口 | `triggers.ts:1058` |
| 六种模式枚举 | `triggers.ts:107` |
| 条件求值 | `triggers.ts:1238-1313` |
| allowlist(display/request) | `triggers.ts:985-1036` |
| v2ReplaceString | `triggers.ts:2754-2791` |
| v2ExtractRegex | `triggers.ts:1932-1951` |
| v2RegexTest | `triggers.ts:2596-2607` |
| v2QuickSearchChat | `triggers.ts:2432-2453` |
| v2ModifyChat / v2CutChat | `triggers.ts:1830-1836` / `:1817-1828` |
| v2SetDisplayState | `triggers.ts:2356-2362` |
| v2SetRequestState | `triggers.ts:2389-2399` |
| additonalSysPrompt 落位 | `index.svelte.ts:1197-1216` |
| input 调用点 | `DefaultChatScreen.svelte:187-197` |
| start 调用点 | `index.svelte.ts:888-898` |
| output 调用点 | `index.svelte.ts:1763`、`:1871` |
| request 调用点 | `request.ts:249-260` |
| display 调用点 | `scripts.ts:104-122`、`parser.svelte.ts:755` |
| 触发器递归/循环保护 | `triggers.ts:1393,1791,1765-1769` |
