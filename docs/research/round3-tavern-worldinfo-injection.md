# SillyTavern 世界书(World Info)与提示词注入系统调研报告 — Round 3

日期:2026-08-09
来源:子代理源码调研(`SillyTavern/SillyTavern-src`)
范围:世界书数据结构、扫描/激活逻辑、插入位置/深度、内容宏、与正则脚本的关系、注入系统(extension_prompts/AN)、最终 prompt 组装顺序

核心文件:`public/scripts/world-info.js`(6289 行)、`public/script.js`(12537 行)、`public/scripts/extensions/regex/engine.js`(465 行)、`public/scripts/macros.js`、`public/scripts/authors-note.js`、`public/scripts/PromptManager.js`、`public/scripts/openai.js`

---

## 1. 世界书条目数据结构 (WorldInfoEntry)

### 1.1 条目的"定义字典":`newWorldInfoEntryDefinition`

`world-info.js:4002` 定义了全部字段及默认值,`world-info.js:4047` 通过过滤 `excludeFromTemplate` 字段生成写入磁盘的模板:

```js
export const newWorldInfoEntryDefinition = {
    key: { default: [], type: 'array' },
    keysecondary: { default: [], type: 'array' },
    comment: { default: '', type: 'string' },
    content: { default: '', type: 'string' },
    constant: { default: false, type: 'boolean' },   // 常驻
    vectorized: { default: false, type: 'boolean' },
    selective: { default: true, type: 'boolean' },
    selectiveLogic: { default: world_info_logic.AND_ANY, type: 'enum' },  // 次级关键词逻辑
    addMemo: ...,
    order: { default: 100, type: 'number' },         // 插入顺序
    position: { default: 0, type: 'number' },        // 插入位置
    disable: { default: false, type: 'boolean' },    // 禁用
    ignoreBudget: { default: false, type: 'boolean' },
    excludeRecursion: { default: false, type: 'boolean' },  // 递归扫描时排除
    preventRecursion: { default: false, type: 'boolean' },  // 激活后不触发递归
    matchPersonaDescription / matchCharacterDescription / matchCharacterPersonality /
    matchCharacterDepthPrompt / matchScenario / matchCreatorNotes: boolean,  // 扫描额外来源
    delayUntilRecursion: { default: 0, type: 'number' },  // 延迟到递归阶段
    probability: { default: 100, type: 'number' },   // 激活概率
    useProbability: { default: true, type: 'boolean' },
    depth: { default: DEFAULT_DEPTH/*4*/, type: 'number' },   // atDepth 位置的深度
    outletName: { default: '', type: 'string' },     // 出口(outlet)名
    group / groupOverride / groupWeight: ...,
    scanDepth: { default: null, type: 'number?' },   // 覆盖全局扫描深度
    caseSensitive: { default: null, type: 'boolean?' },   // 覆盖全局，null=跟随全局
    matchWholeWords: { default: null, type: 'boolean?' },
    useGroupScoring: { default: null, type: 'boolean?' },
    automationId / role / sticky / cooldown / delay / characterFilterNames /
    characterFilterTags / characterFilterExclude / triggers: ...,
};
```

**注意:没有 `useRegex` 字段**。关键词正则通过"以 `/.../` 包裹的字符串"隐式识别(见 §2.2)。

### 1.2 新条目构造与缺失字段补齐

- `createWorldInfoEntry`(`world-info.js:4057`):`const newEntry = { uid: newUid, ...structuredClone(newWorldInfoEntryTemplate) }`,`uid` 是条目唯一 id。
- `addMissingWorldInfoFields`(`world-info.js:2104`):加载时按模板补齐缺失字段、确保 `key`/`keysecondary` 是数组、`characterFilter` 是 `{isExclude,names,tags}`。

### 1.3 磁盘格式

世界书文件结构为 `{ entries: { [uid]: entry }, ... }`。`getGlobalLore`(`world-info.js:4415`)/`getCharacterLore`(`world-info.js:4363`)读取时给每条注入 `world` 来源字段:

```js
const newEntries = data ? Object.keys(data.entries).map(x => data.entries[x])
    .map(({ uid, ...rest }) => ({ uid, world: worldName, ...rest })) : [];
```

### 1.4 条目内嵌装饰符 (decorators)

`parseDecorators`(`world-info.js:4540`)在 `getSortedEntries` 里解析内容开头的 `@@` 行,`KNOWN_DECORATORS = ['@@activate','@@dont_activate']`(`world-info.js:102`)。`@@activate` 强制激活、`@@dont_activate` 强制跳过(`world-info.js:4734-4742`)。

---

## 2. 扫描 / 激活逻辑(`checkWorldInfo`,world-info.js:4597)

### 2.1 整体流程

`generate` 主流程在 `script.js:4576` 调用 `getWorldInfoPrompt(chatForWI, maxContext, dryRun, globalScanData)`;`getWorldInfoPrompt`(`world-info.js:892`)内部调用 `checkWorldInfo`。`chatForWI` 构造如下(`script.js:4573`):

```js
const chatForWI = coreChat.map(x => world_info_include_names ? `${x.name}: ${x.mes}` : x.mes).reverse();
```

即:**倒序**的聊天文本(最新在最前),配合 `world_info_include_names` 是否带名字前缀。

### 2.2 匹配算法(`WorldInfoBuffer.matchKeys`,world-info.js:347)

```js
matchKeys(haystack, needle, entry) {
    const keyRegex = parseRegexFromString(needle);   // 以 /xxx/ 包裹 => 正则
    if (keyRegex) return keyRegex.test(haystack);     // 正则优先，覆盖 caseSensitive/wholeWord
    haystack = this.#transformString(haystack, entry);
    const transformedString = this.#transformString(needle, entry);
    const matchWholeWords = entry.matchWholeWords ?? world_info_match_whole_words;
    if (matchWholeWords) {
        if (keyWords.length > 1) return haystack.includes(transformedString);
        else { const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedString)})(?:$|\\W)`); ... }
    } else {
        return haystack.includes(transformedString);
    }
}
```

- `parseRegexFromString`(`world-info.js:2821`):`/^\/...\/([gimsuy]*)$/`,匹配到 `/pattern/flags` 则编译为正则,否则返回 `null`(走普通匹配)。
- `#transformString`(`world-info.js:269`):大小写由 `entry.caseSensitive ?? world_info_case_sensitive` 控制,不敏感时 `toLowerCase()`。
- **关键词先做宏替换**:主关键词 `const substituted = substituteParams(key)`(`world-info.js:4803`),次级关键词 `substituteParams(keysecondary)`(`world-info.js:4835`)——所以 `{{char}}`、`{{user}}` 等可以出现在关键词里。

### 2.3 扫描缓冲(`WorldInfoBuffer.get`,world-info.js:299)

- 深度 = `entry.scanDepth ?? this.getDepth()`,`getDepth()` = `world_info_depth + skew`(`world-info.js:400`);全局 `world_info_depth` 默认 2(`world-info.js:69`)。
- 扫描内容 = 最近的 `depth` 条消息 + 各 `matchXxx` 开关对应的 persona/character 描述 + **注入缓冲**(`#injectBuffer`)+ **递归缓冲**(`#recurseBuffer`,MIN_ACTIVATIONS 阶段除外)。
- 扩展注入:`checkWorldInfo` 开头(`world-info.js:4607-4612`)把所有 `scan:true` 的 extension prompt(如开启 `allowWIScan` 的 AN、memory 等)经 `getExtensionPromptByName` 取出后 `buffer.addInject(prompt)` 加入扫描区。

### 2.4 激活判定链(`checkWorldInfo`,world-info.js:4665-4905)

依次过滤:`disable` → `triggers` 触发类型 → `characterFilter`(名字/标签)→ `delay`/`cooldown`/`sticky` → `delayUntilRecursion` → `excludeRecursion`(递归阶段)→ 装饰符 → 外部激活 → `constant` 常驻 → `sticky` 激活 → 主关键词匹配 → 次级关键词按 `selectiveLogic`(AND_ANY / NOT_ALL / NOT_ANY / AND_ALL,枚举在 `world-info.js:33`)判定。

### 2.5 概率、预算与递归

- 激活候选排序后逐条 `verifyProbability()`(`world-info.js:4916`):`useProbability && probability<100` 时 `Math.random()*100 <= probability` 通过,失败加入 `failedProbabilityChecks`。
- 预算 `budget = round(world_info_budget * maxContext / 100)`,`world_info_budget` 默认 25%(`world-info.js:73`),另有 `world_info_budget_cap`。
- 递归:`world_info_recursive` 开启且 `!preventRecursion` 的条目内容拼进递归缓冲,触发下一轮扫描(`scan_state.RECURSION`,`world-info.js:4996`);`world_info_max_recursion_steps` 限制轮数(`world-info.js:4650`)。
- 最小激活数 `world_info_min_activations`:激活数不足时 `buffer.advanceScan()` 加深扫描(`world-info.js:5010`)。

---

## 3. 插入位置与深度(决定 prompt 中排序)

### 3.1 位置枚举(world-info.js:855)

```js
export const world_info_position = {
    before: 0,      // 角色卡之前(顶部)
    after: 1,       // 角色卡之后(底部)
    ANTop: 2,       // 作者注之上
    ANBottom: 3,    // 作者注之下
    atDepth: 4,     // 聊天历史指定深度
    EMTop: 5,       // 示例对话开头
    EMBottom: 6,    // 示例对话末尾
    outlet: 7,      // 命名出口(可被 {{outlet::名}} 引用)
};
export const wi_anchor_position = { before: 0, after: 1 };   // 866
```

### 3.2 组装(world-info.js:5084-5147)

```js
[...allActivatedEntries.values()].sort(sortFn).forEach((entry) => {   // 5084
    const regexDepth = entry.position === world_info_position.atDepth ? (entry.depth ?? DEFAULT_DEPTH) : null;
    const content = getRegexedString(entry.content, regex_placement.WORLD_INFO, { depth: regexDepth, isMarkdown: false, isPrompt: true });  // 5086
    ...
    switch (entry.position) {
        case world_info_position.before: WIBeforeEntries.unshift(content); break;
        case world_info_position.after:  WIAfterEntries.unshift(content);  break;
        case world_info_position.EMTop:  EMEntries.unshift({position: before, content}); break;
        case world_info_position.EMBottom: EMEntries.unshift({position: after, content}); break;
        case world_info_position.ANTop / ANBottom: ANTopEntries / ANBottomEntries.unshift(content);
        case world_info_position.atDepth: WIDepthEntries 按 depth+role 分组; break;
        case world_info_position.outlet: WIOutletEntries[outletName].push(content);
    }
});
```

- **排序 `sortFn = (a,b) => b.order - a.order`**(`world-info.js:89`):`order` 值越大越靠前(默认 100)。同名分组内用 `unshift` 保持后激活的在前。
- **`worldInfoBefore`/`worldInfoAfter`**:`world-info.js:5164` 分别 `join('\n')` 返回,供 story string 或 OAI 系统提示使用。
- **ANTop/ANBottom 合并进 AN**(`world-info.js:5099-5104`,受 `shouldWIAddPrompt` 门控):
  ```js
  const originalAN = context.extensionPrompts[NOTE_MODULE_NAME].value;
  const ANWithWI = `${ANTopEntries.join('\n')}\n${originalAN}\n${ANBottomEntries.join('\n')}`...;
  context.setExtensionPrompt(NOTE_MODULE_NAME, ANWithWI, ...);
  ```
- **atDepth 与 EM 条目回流**:在 `script.js:4593-4601`,`worldInfoDepth` 通过 `setExtensionPrompt(inject_ids.CUSTOM_WI_DEPTH_ROLE(depth, role), ..., IN_CHAT, depth, false, role)` 注入聊天;EM 条目在 `script.js:4585-4591` 插入 `mesExamplesArray`(`baseChatReplace` + `parseMesExamples`)。`outletEntries` 经 `script.js:4602-4606` 注册为 `CUSTOM_WI_OUTLET` 扩展提示。

### 3.3 深度语义

- **`scanDepth`/`world_info_depth`**(§2.3)= 往回扫描多少条消息;
- **`depth`**(默认 `DEFAULT_DEPTH=4`,`world-info.js:96`)= atDepth 插入到聊天第几层;
- atDepth 的 `role`(system/user/assistant,`extension_prompt_roles`,`script.js:493`)决定注入角色。

---

## 4. 世界书条目内容中的宏替换时机

### 4.1 两处宏替换

1. **关键词宏**:`world-info.js:4803`(主)/ `world-info.js:4835`(次级)——匹配前替换。
2. **内容宏**:概率通过后、入预算前(`world-info.js:4939`):
   ```js
   // Substitute macros inline, for both this checking and also future processing
   entry.content = substituteParams(entry.content);
   newContent += `${entry.content}\n`;
   ```
   之后 `entry.content`(已替换)用于:预算统计、递归缓冲(`world-info.js:5038`)、以及最终的 `getRegexedString`(§5)。

### 4.2 宏引擎

`substituteParams`(`script.js:2922`)根据 `power_user.experimental_macro_engine` 分派到:
- 新引擎:`MacroEngine.evaluate(content, env)` + `MacroEnvBuilder.buildFromRawEnv`(`script.js:2960-2963`);
- 旧引擎:`substituteParamsLegacy`(`script.js:2772`)→ `evaluateMacros(content, environment, postProcessFn)`(`macros.js:610`),内建 `preEnvMacros`(`<USER>`/`<BOT>`/骰子/instruct 宏等,`macros.js:619-637`)与 `postEnvMacros`(`{{lastMessage}}`、`{{maxPrompt}}`、`{{outlet::}}`、`{{trim}}`、`{{noop}}`、`{{random::}}`、`{{pick::}}` 等,`macros.js:639-670`),以及由调用方传入的 `environment` 变量(`{{description}}`、`{{char}}`、`{{user}}`、`{{wiBefore}}` 等,由 `substituteParamsLegacy` 组装,`script.js:2848-2876`)。

**结论**:世界书内容 = 先宏替换 → 后正则(顺序见 §5)。

---

## 5. 正则脚本与世界书的关系

### 5.1 正则引擎(`regex/engine.js`)

- **放置点枚举**(`engine.js:352`):`MD_DISPLAY:0, USER_INPUT:1, AI_OUTPUT:2, SLASH_COMMAND:3, //4 sendAs, WORLD_INFO:5, REASONING:6`。
- 脚本类型 `SCRIPT_TYPES`(`engine.js:16`):GLOBAL(0)/PRESET(2)/SCOPED(1),`getRegexScripts` 按序合并(全局 → 预设 → 角色)。
- 脚本字段(`char-data.js:88-104` `RegexScriptData`):`findRegex`、`replaceString`、`trimStrings`、`placement`(数组,含 WORLD_INFO 则作用)、`markdownOnly`、`promptOnly`、`runOnEdit`、`substituteRegex`、`minDepth`/`maxDepth`、`disabled`。
- `getRegexedString`(`engine.js:397`):
  ```js
  if (script.markdownOnly && isMarkdown) || (script.promptOnly && isPrompt) || (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)
  ```
  命中后检查 `minDepth/maxDepth`(对 `atDepth` 条目,depth 即 `regexDepth`)与 `script.placement.includes(placement)`,再 `runRegexScript`。
- `runRegexScript`(`engine.js:443`):
  - **find 侧可宏替换**:`substituteRegex` 为 RAW → `substituteParamsExtended(findRegex)`;ESCAPED → 经 `sanitizeRegexMacro` 转义后再替换(`engine.js:459-470`);
  - **replace 侧**:把 `{{match}}`→`$0`、`$1`/`$<name>` 分组回填后,**末尾再 `substituteParams(replaceWithGroups)`**(`engine.js:481-494`)。

### 5.2 世界书何时经过正则

唯一入口在 `world-info.js:5086`:所有已激活条目的内容统一以 `regex_placement.WORLD_INFO` 过一遍 `getRegexedString`,且带 `isPrompt:true`(因此 `promptOnly` 脚本生效)、atDepth 条目附带 `depth` 以便脚本做深度过滤。

### 5.3 处理顺序(关键结论)

对世界书条目内容:
```
匹配(关键词, 关键词已宏替换)  →  概率/预算  →  宏替换 content(4939)  →  正则 WORLD_INFO(5086)
```
即**先宏后正则**。正则的 replace 字符串里若引入新宏,会在 `runRegexScript` 末尾再次被 `substituteParams`。正则脚本确实能修改/过滤世界书内容(改 find 匹配到的子串,或经 replace 整条改写);`getRegexedString` 返回空串则条目被丢弃(`world-info.js:5087-5090`)。

### 5.4 其它放置点时机(对照)

- 聊天消息(user/assistant 历史):`script.js:4447` 以 `USER_INPUT`/`AI_OUTPUT` + `depth` 处理,早于 WI 扫描(`getWorldInfoPrompt` 在 4576)。
- 用户输入:`script.js:5816`;AI 输出:`script.js:6422`;首条消息:`script.js:7660`;推理:`script.js:5444`。
- AN、Jailbreak、Instruct 前缀等扩展提示走 `getExtensionPrompt`/`preparePrompt`,**只宏替换、不经过正则引擎**(见 §6)。

---

## 6. 提示词注入系统

### 6.1 统一的扩展提示槽(`extension_prompts`)

`setExtensionPrompt(key, value, position, depth, scan, role, filter)`(`script.js:8866`)存入全局 `extension_prompts`,`position` 枚举(`script.js:483`):
```js
NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2
```
`role` 枚举(`script.js:493`):`SYSTEM:0, USER:1, ASSISTANT:2`。`depth` 上限 `MAX_INJECTION_DEPTH=10000`(`script.js:500`)。

读取:`getExtensionPrompt(position, depth, separator, role, wrap)`(`script.js:3241`)——只做 `substituteParams`(`script.js:3264`),**不做正则**;`getAllExtensionPrompts`(`script.js:3172`)同。`getExtensionPromptByName`(`script.js:3198`)同样只宏替换。

### 6.2 作者注 Author's Note(`authors-note.js`)

- `MODULE_NAME = '2_floating_prompt'`(`authors-note.js:24`),元数据 `note_prompt/note_interval/note_depth/note_position/note_role`(`authors-note.js:28`)。
- `setFloatingPrompt`(`authors-note.js:324`):按用户消息间隔判断是否注入,`shouldWIAddPrompt`(`authors-note.js:26`)指示"本次是否真正注入 AN/WI";随后 `context.setExtensionPrompt(MODULE_NAME, prompt, note_position, note_depth, allowWIScan, note_role)`(`authors-note.js:383`)。
  - `allowWIScan` = `scan` 参数 → 决定 AN 是否参与 WI 扫描缓冲(§2.3)。
  - AN 内宏:`{{authorsNote}}`/`{{charAuthorsNote}}`/`{{defaultAuthorsNote}}` 由 `registerAuthorsNoteMacros` 注册(`authors-note.js:566`)。
- AN 的注入位置即 `extension_prompt_types`(after/scenario=IN_PROMPT 0,chat=IN_CHAT 1,before_scenario=BEFORE_PROMPT 2,见 `setNotePositionCommand` `authors-note.js:74`)。
- **WI ANTop/ANBottom 合并进 AN** 见 §3.2(`world-info.js:5099`)。

### 6.3 其它注入来源

- **Jailbreak / 系统提示 / Instruct 前缀**:Text Completion 路径在 `script.js:4666-4711`——`system`/`jailbreak` 经 `baseChatReplace`(`script.js:3282`,仅宏替换)或 `substituteParams` 处理后拼接/推入 `coreChat`;Instruct 的聊天行格式化 `formatInstructModeChat`(`instruct-mode.js:387`,前缀/后缀经 `substituteParams`,`instruct-mode.js:439/442`)。
- **story string(故事串模板)**:`renderStoryString`(`power-user.js:2234`)= Handlebars 编译 `power_user.context.story_string`(默认模板 `power-user.js:90`:`{{system}} {{description}} {{char}}'s personality {{scenario}} {{persona}}`)→ 再 `substituteParams`。`storyStringParams`(`script.js:4626-4645`)含 `wiBefore/wiAfter/loreBefore/loreAfter/anchorBefore/anchorAfter/mesExamples` 等,**默认模板不含 WI 字段**,需用户自定义模板才会把 before/after 条目带进 story string。
- **in-chat 深度注入**:`doChatInject`(`script.js:5569`)把 `extension_prompts` 中 `IN_CHAT` 且对应 `depth` 的内容按角色 system/user/assistant 拼成消息 `splice` 进倒序聊天数组(AN、WI atDepth、story string(IN_CHAT) 均在此)。`flushWIInjections`(`script.js:5619`)在生成后清理 `CUSTOM_WI_DEPTH`/`CUSTOM_WI_OUTLET` 临时槽。
- **Chat Completion (OAI) 的注入**:
  - `preparePromptsForChatCompletion`(`openai.js:1358`)把 `worldInfoBefore/worldInfoAfter`(经 `formatWorldInfo` `openai.js:780`,套 `wi_format` 模板,如 `<World Info: {{text}}>`)、AN(`2_floating_prompt`,`openai.js:1390`)、memory/vectors/smart context、persona、其余 `BEFORE_PROMPT/IN_PROMPT` 扩展提示统一并入 `promptManager` 的 Prompt 集合,标识符分别为 `worldInfoBefore/worldInfoAfter/authorsNote/...`(`openai.js:1365`)。
  - `promptManager.preparePrompt`(`PromptManager.js:1277`)对每个 prompt 只做 `substituteParams`(含 group 成员替换)——**OAI 路径下 WI/AN 内容的正则在 `world-info.js:5086` 已提前做过,扩展提示不再过正则**。
  - in-chat 注入:`populationInjectionPrompts`(`openai.js:810`)按 `injection_depth` 逐层读取 `getExtensionPrompt(IN_CHAT, i, ...)` 插入消息流。
  - 会话历史 `setOpenAIMessages`(`openai.js:561`),示例对话 `setOpenAIMessageExamples`(`openai.js:647`)。

---

## 7. 最终 Prompt 组装顺序

### 7.1 Text Completion(`script.js` generate 主流程)

最终串(`getCombinedPrompt`/`checkPromptSize`,`script.js:5133-5166` / `5050-5054`):
```
combinedStoryString + mesExmString + mesSendString + generatedPromptCache
```
各段及宏/正则时机:

| 段落 | 内容来源 | 宏 | 正则 |
|---|---|---|---|
| `combinedStoryString` | `renderStoryString` 产出(`script.js:4663`,含 system/description/personality/scenario/persona + 可选 wiBefore/wiAfter/anchorBefore/anchorAfter/mesExamples);instruct 时再 `formatInstructModeStoryString`(`instruct-mode.js:478`) | ✓(substituteParams / Handlebars) | ✗ |
| `mesExmString` | 角色卡示例对话 `mesExamplesArray`(WI EM 条目已 `baseChatReplace` 后插入,`script.js:4585`) | ✓ | ✗(AI_OUTPUT 在 7660 预处) |
| `mesSendString` | 聊天历史:每条消息已 `getRegexedString(USER_INPUT/AI_OUTPUT)`(`script.js:4447`);in-chat 注入消息(AN、WI atDepth、story string-IN_CHAT)由 `doChatInject`(`script.js:5569`)splice 进历史;Jailbreak 消息 `script.js:4696` | ✓(格式化时) | ✓(历史消息在 4447) |
| `generatedPromptCache` | continue 时上一轮输出 / cycle prompt | ✓ | ✓(AI_OUTPUT 时) |
| 行尾拼接 | `modifyLastPromptLine`:quiet prompt、instruct 输出序列、`name2:` 等(`script.js:5037-5093`) | ✓ | ✗ |

**世界书实际进入的位置**:
- before/after 条目 → `worldInfoBefore/After`(`world-info.js:5164`)→ 作为 `{{wiBefore}}/{{loreBefore}}` 等 story string 参数(`script.js:4632-4641`),**默认模板不含则默认不出现**;
- atDepth 条目 → `CUSTOM_WI_DEPTH` 注入(`script.js:4593`)→ `doChatInject` 插到历史对应深度;
- ANTop/ANBottom 条目 → 合并进 AN(`world-info.js:5099`)→ AN 作为 `IN_CHAT` 扩展提示注入;
- EM 条目 → 插入示例对话段;
- outlet 条目 → `{{outlet::名}}` 宏按需内联(`macros.js:660`)。

### 7.2 Chat Completion(openai.js)

`prepareOpenAIMessages`(`openai.js:1531`):
1. 全部系统/注入提示经 `promptManager` 排序(标记序:main → worldInfoBefore → worldInfoAfter → charDescription → charPersonality → scenario → ... → jailbreak,`openai.js:1358`),每条 `preparePrompt`(宏替换);
2. `populateChatCompletion`(`openai.js:1176`)合并 system 消息、in-chat 深度注入、示例对话、历史消息,按 token 预算裁剪;
3. `squashSystemMessages` 可选合并(`openai.js:1574`)。
这里 WI/AN 的正则已在 `world-info.js:5086` 完成;其余扩展提示不做正则。

### 7.3 全局时序(一次 generate)

```
构造 coreChat(排除系统消息, 4442)
消息级正则 USER_INPUT/AI_OUTPUT (4447)
setFloatingPrompt 决定 shouldWIAddPrompt (4567)
WI 扫描 checkWorldInfo: 关键词(宏)匹配 → 概率/预算 → content 宏替换(4939) → content 正则(5086) (4576)
EM 条目入示例 / atDepth、outlet 注入 / AN 合并 WI(4593-4606)
system/jailbreak 宏替换 (4666-4711)
renderStoryString(Handlebars+宏) (4663)
doChatInject 深度注入 (5569)
裁剪至 maxContext → 发送
```

---

## 关键结论

1. **世界书条目没有 `useRegex` 布尔字段**;正则关键词用 `/.../flags` 字符串隐式启用(`world-info.js:2821`、`347`)。
2. **扫描 = 关键词(先宏替换)在倒序消息+可选注入/递归缓冲中匹配**,`scanDepth` 控制回看条数,`constant`/`sticky`/`probability`/`delay`/`cooldown`/`group`/`triggers`/`characterFilter`/装饰符构成完整激活链。
3. **宏与正则的严格次序**:content 先 `substituteParams`(`world-info.js:4939`),后 `getRegexedString(WORLD_INFO)`(`world-info.js:5086`);正则 replace 末尾还会再宏替换一次(`engine.js:494`)。正则脚本确实能改写/删除世界书条目内容。
4. **注入系统是统一的 `extension_prompts` 槽**(`setExtensionPrompt` `script.js:8866`),AN(`authors-note.js`)只是其一;in-chat 类注入(含 WI atDepth)由 `doChatInject` 插层,OAI 由 PromptManager + `populationInjectionPrompts` 插层。扩展提示普遍**只宏替换、不过正则**(例外:WI 内容在 5086 单独过正则)。
5. **默认故事串不含 WI**,before/after 条目须用户模板引用 `{{wiBefore}}` 才会进入 Text Completion 主提示;而 ANTop/ANBottom、atDepth、EM、outlet 均有独立注入通道,不依赖模板。
