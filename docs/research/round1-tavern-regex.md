# SillyTavern 正则脚本(Regex)系统源码调研报告 — Round 1

日期:2026-08-09
来源:子代理源码调研(`SillyTavern/SillyTavern-src`)
范围:数据结构、执行流程、placement、匹配替换、过滤作用域、流式联动、与宏关系、导入导出

核心文件: `public/scripts/extensions/regex/engine.js`(引擎)、`index.js`(UI/配置)、`public/scripts/char-data.js`(数据结构)、`public/script.js`(聊天管线)

---

## 1. 正则脚本的数据结构

### 1.1 权威定义:JSDoc 类型 `RegexScriptData`
`public/scripts/char-data.js:88-102`

```js
@typedef {object} RegexScriptData
@property {string} id            - UUID of the script
@property {string} scriptName     - 脚本名称
@property {string} findRegex      - 要查找的正则
@property {string} replaceString  - 替换字符串
@property {string[]} trimStrings  - 需要裁剪的字符串数组
@property {number[]} placement    - 生效位置(数组)
@property {boolean} disabled      - 是否禁用
@property {boolean} markdownOnly  - 是否仅对 Markdown(显示)生效
@property {boolean} promptOnly    - 是否仅对 prompt(发送给 LLM)生效
@property {boolean} runOnEdit     - 是否在编辑消息时运行
@property {number} substituteRegex- findRegex 是否做宏替换(0/1/2)
@property {number} minDepth       - 最小深度
@property {number} maxDepth       - 最大深度
```

### 1.2 实际落盘字段(新建脚本时构造)
`public/scripts/extensions/regex/index.js:848-868`:

```js
const newRegexScript = {
    id, scriptName, findRegex, replaceString,
    trimStrings: String(...).split('\n').filter(e => e.length !== 0) || [],
    placement: [勾选的 "Affects" 复选框的值数组],   // 1/2/3/5/6
    disabled, markdownOnly, promptOnly, runOnEdit,
    substituteRegex: Number(...),   // 0/1/2
    minDepth: parseInt(...), maxDepth: parseInt(...),
};
```

### 1.3 两个枚举常量
- `regex_placement`:`engine.js:281-292`
- `substitute_find_regex`:`engine.js:298-302`(`NONE=0 / RAW=1 / ESCAPED=2`)

### 1.4 三种存储作用域 `SCRIPT_TYPES`
`engine.js:11-16`,注释明确"ORDER MATTERS: defines the regex script priority":

```js
GLOBAL: 0,   // extension_settings.regex (全局限)
PRESET: 2,   // preset 的 extension 字段 'regex_scripts'
SCOPED: 1,   // characters[this_chid].data.extensions.regex_scripts (角色)
```

默认值初始化在 `public/scripts/extensions.js:178-185`(`regex: []`、`regex_presets: []`、`character_allowed_regex: []`、`preset_allowed_regex: {}`)。

---

## 2. 执行流程:getRegexedString → runRegexScript

### 2.1 入口函数
`engine.js:334` `getRegexedString(rawString, placement, { characterOverride, isMarkdown, isPrompt, isEdit, depth })`:
1. 扩展被禁用 / 空串 / placement undefined → 直接返回 (`engine.js:342-344`)
2. `getRegexScripts({ allowedOnly: true })` 拉取全部脚本 (`engine.js:346`)
3. 逐脚本过滤(第 3/5 节)后调用 `runRegexScript` (`engine.js:375`)

### 2.2 调用链
```
getRegexedString (engine.js:334)
 ├─ getRegexScripts (engine.js:98)
 │   └─ getScriptsByType ×3 (engine.js:108)  [GLOBAL/SCOPED/PRESET]
 └─ runRegexScript (engine.js:391)
     ├─ getRegexString() 按 substituteRegex 决定 findRegex 是否宏替换 (engine.js:397-409)
     ├─ RegexProvider.instance.get(regexString)  (engine.js:411)
     └─ rawString.replace(findRegex, function(match){...})  (engine.js:419)
         ├─ filterString(trimStrings)  (engine.js:438→457)
         └─ substituteParams(结果)  (engine.js:444)
```

### 2.3 全部调用点(聊天管线)
| 位置 | 用途 | placement / flags |
|---|---|---|
| `public/script.js:1809` | 聊天显示渲染 `messageFormatting` | 动态(用户/旁白/AI/推理)，`isMarkdown:true`，带 depth |
| `public/script.js:4447` | **构造发送给 LLM 的 prompt** | 用户→USER_INPUT，AI→AI_OUTPUT，`isPrompt:true`，带 depth |
| `public/script.js:4486` | prompt 中注入 reasoning | `REASONING`，`isPrompt:true` |
| `public/script.js:5444` | 非流式响应中的 reasoning | `REASONING` |
| `public/script.js:5816` | `sendMessageAsUser` 用户消息 | `USER_INPUT` |
| `public/script.js:6422` | **`cleanUpMessage` 内(流式/非流式收尾)** | 模拟→USER_INPUT，否则 AI_OUTPUT |
| `public/script.js:7660/7665` | 开场白/备用开场白 | `AI_OUTPUT`，depth:0 |
| `public/script.js:8100` | 编辑消息 | 按角色类型，`isEdit:true` |
| `public/scripts/world-info.js:5086` | 世界书条目 | `WORLD_INFO`，`isPrompt:true`，depth=WI深度 |
| `public/scripts/welcome-screen.js:277` | 欢迎屏开场白 | `AI_OUTPUT` |
| `public/scripts/reasoning.js:409/1009/1188/1506/1555` | 推理块 | `REASONING`，1188 为 `isEdit:true` |
| `public/scripts/slash-commands.js:4715/5716/5943/6086` | 旁白/角色扮演等 STscript | `SLASH_COMMAND` |

---

## 3. placement 的含义与实现

### 3.1 当前版本的枚举(注意:与旧版"interrupt/start/in-chat"语义不同)
`engine.js:281-292`:

```js
MD_DISPLAY: 0,   // 已废弃(仅用于迁移)
USER_INPUT: 1,   // 用户消息
AI_OUTPUT: 2,    // AI 输出
SLASH_COMMAND: 3,// STscript/旁白消息
// 4 - sendAs (legacy, 旧版值)
WORLD_INFO: 5,   // 世界书条目
REASONING: 6,    // 推理块
```

**本版本源码中不存在 interrupt/start、"messages 开头"、"in chat / not in chat / only in chat" 这类 placement**(已 grep 确认无残留)。这些是旧版(1.x)的概念。当前 placement 是"Affects"复选框数组(`editor.html:80-109`,值为 1/2/3/5/6),一个脚本可多选。

### 3.2 匹配判断
`engine.js:374`:`script.placement.includes(placement)` —— 传入的 placement 属于脚本勾选集合才执行。

### 3.3 旧值迁移
`index.js:1374-1414` `migrateSettings()`:
- 无 `id` 补 UUID;无 `placement` 数组补 `[]`
- 含 `MD_DISPLAY(0)` → 移除 0,并设 `markdownOnly=true; promptOnly=true`
- 含旧 `4(sendAs)` → 替换为 `[SLASH_COMMAND]`

### 3.4 markdownOnly / promptOnly 的"三分法"过滤
`engine.js:348-354`:

```js
(script.markdownOnly && isMarkdown) ||                       // 仅显示
(script.promptOnly && isPrompt) ||                           // 仅 prompt
(!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)  // 默认
```

结论:
- `markdownOnly=true` → 只在 `isMarkdown:true` 的显示路径跑(`script.js:1809`)
- `promptOnly=true` → 只在 `isPrompt:true` 的 prompt 构建路径跑(`script.js:4447`、world-info)
- 两者都 false → 只在"既非显示也非 prompt"的路径跑:流式 `cleanUpMessage`(`script.js:6422`)、用户输入(`5816`)、旁白/斜杠命令、编辑(`8100`)、开场白(`7660`)
- 编辑器默认新脚本:markdownOnly=true、runOnEdit=true、placement=[USER_INPUT](`index.js:797-809`)

---

## 4. 正则匹配与替换实现

### 4.1 用原生 JS RegExp,经 `regexFromString` 构造
`public/scripts/utils.js:1388-1403`:

```js
export function regexFromString(input) {
    var m = input.match(/(\/?)(.+)\1([a-z]*)/i);
    // 校验 flags 无重复且属于 [gmixXsuUAJ]
    if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) return RegExp(input);
    return new RegExp(m[2], m[3]);  // 解析 /pattern/flags
}
```

- 支持 `/pattern/flags` 形式,flags 支持 `g m i x X s u U A J`;非法 flags 时退化为 `RegExp(input)`。
- 编译缓存:`engine.js:40-90` `RegexProvider`(LRU,容量 1000,`get()` 会重置 `lastIndex` 以处理 `g`/`y`)。

### 4.2 替换使用「函数形式的 String.replace」
`engine.js:419-445`:

```js
newString = rawString.replace(findRegex, function (match) {
    const args = [...arguments];
    const replaceString = regexScript.replaceString.replace(/{{match}}/gi, '$0');
    const replaceWithGroups = replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
        if (num)        match = args[Number(num)];              // 数字捕获组 $1 $2
        else if (groupName) { const groups = args[args.length-1]; match = groups[groupName]; } // 命名组 $<name>
        if (!match) return '';
        return filterString(match, regexScript.trimStrings, { characterOverride });  // 先裁剪
    });
    return substituteParams(replaceWithGroups);                  // 最后做宏替换
});
```

结论:
- `replaceString` 是**字符串模板**,不支持 JS 函数。
- 支持 `{{match}}`(整段匹配)、`$1` 等数字组、`$<name>` 命名组;`trimStrings` 在组引用处裁剪;最终结果整体再过一遍 `substituteParams`。
- `trimStrings` 逐条 `substituteParams` 后 `replaceAll('')` 删除(`engine.js:457-464`)。
- 代码注释明确 "Currently does not support the Overlay strategy"(`engine.js:418`)。

### 4.3 substituteRegex(findRegex 的宏替换)
`engine.js:298-302` + `397-409`:
- `NONE(0)`:直接用 `regexScript.findRegex`
- `RAW(1)`: `substituteParamsExtended(findRegex)`
- `ESCAPED(2)`: `substituteParamsExtended(findRegex, {}, sanitizeRegexMacro)` —— 宏替换后转义所有正则元字符(`sanitizeRegexMacro`,`engine.js:304-324`)

---

## 5. 过滤与作用域

### 5.1 逐脚本过滤(在 `getRegexedString` 内)
`engine.js:346-378` 依次:
1. markdownOnly/promptOnly 三分法(`348-354`)
2. `isEdit && !runOnEdit` → 跳过(`356-359`)
3. 深度过滤(`362-372`):
   - `minDepth >= -1 && depth < minDepth` → 跳过
   - `maxDepth >= 0 && depth > maxDepth` → 跳过
4. placement 匹配(`374`)
5. `runRegexScript` 内部再校验 `!regexScript || regexScript.disabled || !findRegex || !rawString` → 跳过(`393`)

深度语义:0=最后一条,1=倒数第二条(见 `script.js:4445`、`editor.html:112` tooltip)。display 路径深度计算在 `script.js:1804-1806`。

### 5.2 作用域实现
`engine.js:108-133` `getScriptsByType(scriptType, { allowedOnly })`:

| 类型 | 数据源 | allowedOnly 限制 |
|---|---|---|
| GLOBAL | `extension_settings.regex` | 无 |
| SCOPED | `characters[this_chid]?.data?.extensions?.regex_scripts` | 需 `character_allowed_regex` 包含该角色 avatar |
| PRESET | `getPresetManager().readPresetExtensionField({path:'regex_scripts'})` | 需 `preset_allowed_regex[apiId]` 包含当前 preset 名 |

- `getRegexedString` 固定传 `allowedOnly: true`(`engine.js:346`),未允许的 scoped/preset 脚本不生效。
- 允许/禁止函数:`allowScopedScripts/disallowScopedScripts`(`175/194`)、`allowPresetScripts/disallowPresetScripts`(`228/247`)。
- 首次遇到角色/preset 自带脚本会弹窗询问(accountStorage 记 `AlertRegex_*` 键避免重复),`index.js:1606-1633`、`1650-1677`。
- 排序/优先级:执行时按 `SCRIPT_TYPES` 枚举值顺序 `GLOBAL(0)→SCOPED(1)→PRESET(2)`(`engine.js:99`),每个类型内部再按数组顺序(可拖拽排序,`index.js:1912-1953`)。

---

## 6. 与流式输出的联动

**本版本没有 StreamingMask**(已搜索无命中)。流式联动靠 `cleanUpMessage` 在**每个 chunk 对累计全文**重跑正则:

### 6.1 流式路径
`public/script.js:3481` `StreamingProcessor`:
- `onProgressStreaming`(`script.js:3600`)**每收到一段 text 就调用 `cleanUpMessage`,其中 `6422` 调 `getRegexedString`** → 正则按"累计全文"增量应用(非增量 delta)。
- 之后 `3656` 调用 `messageFormatting` 渲染,`messageFormatting` 内(`1809`)再次以 `isMarkdown:true` 应用**markdownOnly** 脚本。
- 因此流式中:
  - 非 markdownOnly/promptOnly 脚本 → 每 chunk 在 `cleanUpMessage` 生效(`6422`);
  - markdownOnly 脚本 → 每 chunk 在 `messageFormatting` 生效(`1809`);
  - 两阶段都会在最终收尾时**再次**执行(`streamingProcessor.generate()` 返回后 `script.js:5338` 再跑一次 `cleanUpMessage`)。

### 6.2 非流式路径
`onSuccess`(`script.js:5436-5457`)同样经 `cleanUpMessage` → regex。

### 6.3 注意(已知行为)
由于对"整个累计文本"重复应用,正则替换会随 chunk 累积叠加;最终消息还可能在生成完成后的 `saveReply`/重新渲染中被再次应用。

---

## 7. 与宏(macros)的关系

| 位置 | 宏是否处理 | 证据 |
|---|---|---|
| `replaceString`(替换结果) | **是** | `engine.js:444` `substituteParams(replaceWithGroups)`(在组引用/裁剪之后) |
| `trimStrings` | **是** | `engine.js:460` `substituteParams(trimString, { name2Override })` |
| `findRegex` | 仅在 `substituteRegex≠NONE` | `engine.js:397-409`(RAW/ESCAPED) |
| 被处理的输入文本 rawString | **否**(引擎不替换) | 输入直接 `rawString.replace(...)` |

上下文先后顺序:
- 显示路径:`messageFormatting` 内先 `substituteParams`(仅 messageId 0,`script.js:1761`)再 regex(`1809`);一般消息渲染时宏在 `chats.js:697/812` `converter.makeHtml(substituteParams(text))`。
- 流式 `cleanUpMessage`:先宏替换 user_prompt_bias 拼入(`script.js:6401`),再 regex(`6422`)。
- prompt 构建:先 regex(`script.js:4447`),宏在后续 prompt 组装阶段替换。
- 宏引擎入口:`script.js:2922` `substituteParams`(实验性宏引擎走 `MacroEnvBuilder`/`MacroEngine`),`substituteParamsExtended` 是其包装(`script.js:2756-2758`)。

结论:正则的**替换串、trim 串、可选 findRegex** 都支持 `{{macro}}`;正则不负责替换输入文本中的宏。

---

## 8. 内置脚本(preset)/导入导出

### 8.1 无内置脚本
源码中没有任何硬编码的"内置正则脚本"。新建脚本时的默认值:markdownOnly=true、runOnEdit=true、placement=[USER_INPUT](`index.js:797-809`)。

### 8.2 正则预设(RegexPreset,注意与"preset 作用域"是两回事)
`index.js:47-478` `RegexPresetManager`:
- 存储:`extension_settings.regex_presets`(`extensions.js:180-181`),元素 `{id, name, isSelected, global:[{id}], scoped:[{id}], preset:[{id}]}` —— 只记录**启用脚本的 id** 快照(`index.js:29-45`,`regexListToPresetItems` 在 `400-406` 过滤 `disabled`)。
- 关键方法:`applyPreset`(`369`,把各 id 快照应用到对应作用域)、`savePreset`(`414`)、`deletePreset`(`455`)、`checkUnsavedChanges`(`123`)。
- 斜杠命令 `/regex-preset`(`index.js:264-309`)。

### 8.3 导入导出
- 单个导出:模板按钮 `scriptTemplate.html:25-27`,处理器 `index.js:700-704` → `JSON.stringify(script)` 下载 `regex-<名>.json`。
- 批量导出:`index.js:1900-1910`(勾选脚本)。
- 导入:UI 入口 `index.js:1750-1767`;`importTarget.html` 选择目标作用域(global/scoped/preset);`onRegexImportFileChange`(`1540`)解析 JSON(支持数组),`onRegexImportObjectChange`(`1499`)**重新分配 UUID** 后 `push` 到目标数组并保存。
- 数据保存:`saveScriptsByType`(`engine.js:141-159`)按类型写入 settings / 角色扩展字段 / preset 扩展字段。

### 8.4 其他斜杠命令
`/regex`(按名执行脚本,`index.js:2051`)、`/regex-state`(`2071`)、`/regex-toggle`(`2102`)。

---

## 关键结论摘要

1. 数据结构共 13 个字段,定义于 `char-data.js:88-102`,保存构造于 `index.js:848-868`。
2. 引擎入口 `getRegexedString`(engine.js:334),被聊天管线三处核心位置调用:prompt 构建(`script.js:4447`)、显示(`script.js:1809`)、消息收尾 `cleanUpMessage`(`script.js:6422`)。
3. placement 当前是 0-6 的"Affects"数组(1/2/3/5/6 + 废弃的 0/4),无旧版 interrupt/in-chat 语义;`markdownOnly`/`promptOnly` 决定只在显示 / 只在 prompt / 默认路径生效(`engine.js:348-354`)。
4. 用原生 JS RegExp(`utils.js:1388`),LRU 缓存(`engine.js:40`);replaceString 为字符串模板,支持 `{{match}}`/`$n`/`$<name>` + trimStrings + 末尾宏替换,不支持函数。
5. 过滤链:三分法 → runOnEdit → min/maxDepth → placement → disabled → allowedOnly 作用域。
6. 流式无 StreamingMask;每个 chunk 在 `cleanUpMessage`(`script.js:3600→6422`)对累计全文应用非 markdown 脚本,`messageFormatting`(`1809`)应用 markdownOnly 脚本,收尾再跑一遍。
7. 宏:replaceString/trimStrings 总是被宏替换,findRegex 仅当 substituteRegex≠NONE;输入文本的宏不在引擎内处理。
8. 无内置脚本;预设 = 启用脚本 id 快照;导入导出为 JSON(UUID 重新生成)。
