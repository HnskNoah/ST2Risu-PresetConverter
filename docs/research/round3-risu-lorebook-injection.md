# RisuAI 世界书(Lorebook)与提示词注入(Prompt Injection)系统调研报告 — Round 3

日期:2026-08-09
来源:子代理源码调研(`rius/risuai-src`)
范围:世界书数据结构、激活/扫描逻辑、位置/深度、内容宏、与正则脚本的关系、注入系统(触发器)、最终 prompt 组装顺序

核心文件:`src/ts/process/lorebook.svelte.ts`、`src/ts/process/index.svelte.ts`、`src/ts/process/scripts.ts`、`src/ts/process/triggers.ts`、`src/ts/parser/parser.svelte.ts`、`src/ts/storage/database.svelte.ts`

---

## 1. 世界书条目的数据结构

### 1.1 `loreBook` 接口(`database.svelte.ts:1319-1339`)

```ts
export interface loreBook{
    key:string                     // 关键词,逗号分隔的字符串
    secondkey:string               // 次级关键词
    insertorder: number            // 插入顺序(同时充当"优先级")
    comment: string                // 条目名称
    content: string                // 条目正文
    mode: 'multiple'|'constant'|'normal'|'child'|'folder',
    alwaysActive: boolean          // 常驻激活(跳过关键词扫描)
    selective:boolean              // 是否启用 secondkey(次级关键词联合匹配)
    extentions?:{ risu_case_sensitive:boolean }
    activationPercent?:number      // 激活概率
    loreCache?:{key:string, data:string[]}
    useRegex?:boolean              // ★ 正则匹配开关
    bookVersion?:number
    id?:string                     // 用于 child 模式/本地激活(LorePlus)
    folder?:string                 // 所属文件夹(key 以 \uf000folder: 开头)
}
```

- `insertorder` 在扫描时被同时赋给 `order` 和 `priority` 两个变量(`lorebook.svelte.ts:290-291`),既参与 token 预算内的**优先级排序**,又参与最终**段落内排序**。
- 每条目的启用开关为 `alwaysActive`;UI 中还提供 `activationPercent`(概率激活)、`selective`(次级关键词)与 `useRegex`(正则)。

### 1.2 每角色级设置 `loreSettings`(`database.svelte.ts:1500-1504`)

```ts
export interface loreSettings{
    tokenBudget: number        // token 预算
    scanDepth:number           // 扫描深度
    recursiveScanning: boolean // 递归扫描
    fullWordMatching?: boolean // 全词匹配
}
```

全局默认值 `loreBookDepth=5`、`loreBookToken=800`(`database.svelte.ts:76-80`)。

### 1.3 存储位置

- 角色级:`character.globalLore`(`database.svelte.ts:1355`)、聊天级:`chat.localLore`、模块级:`getModuleLorebooks()`(`modules.ts`)。
- UI 字段编辑:`src/lib/SideBars/LoreBook/LoreBookData.svelte:225-281`(name / activationKeys / secondkey / activationPercent / insertOrder / alwaysActive / selective / **useRegexLorebook** 复选框)。

---

## 2. 世界书的激活(扫描)逻辑

主函数:`loadLoreBookV3Prompt()`(`lorebook.svelte.ts:75-663`)。

### 2.1 扫描源与参数(`lorebook.svelte.ts:82-98`)

```ts
const fullLore = safeStructuredClone(characterLore.concat(chatLore).concat(moduleLorebook))
const loreDepth = char.loreSettings?.scanDepth ?? DBState.db.loreBookDepth
const loreToken = char.loreSettings?.tokenBudget ?? DBState.db.loreBookToken
const fullWordMatchingSetting = char.loreSettings?.fullWordMatching ?? false
const recursiveScanning = char.loreSettings?.recursiveScanning ?? true
```

### 2.2 匹配算法 `searchMatch`(`lorebook.svelte.ts:100-186`)

- 截取最近 `searchDepth` 条消息做匹配对象(`messages.slice(messages.length - arg.searchDepth)`),每条消息构造成 `{source, prompt, data}`(`lorebook.svelte.ts:118-142`)。用户消息前缀为 `\x01{{username}}:`,角色消息前缀 `\x01{{char名}}:`。
- **正则分支**(`lorebook.svelte.ts:143-165`):当 `arg.regex` 为真时:
  - 要求关键词以 `/` 开头(否则直接 `return false`);
  - 取末尾 `/flags` 作为正则标志;
  - `new RegExp(pattern, flags)` 对**每条消息的 `data`** 执行 `regex.test()`;
  - 正则**不经过小写化**(大小写敏感,除非带 `i` 标志)。
- **字符串分支**(`lorebook.svelte.ts:167-210`):先 `toLocaleLowerCase()`,并剥掉 `{{//...}}` 注释与 `{{comment:...}}`(`lorebook.svelte.ts:168-173`);默认做**去空格子串包含匹配**(`mText.replace(/ /g,'')` 后 `includes`);若 `fullWordMatching` 则按空格分词后做全词相等比较(`splited.includes(key)`)。

### 2.3 扫描主循环(递归扫描)`lorebook.svelte.ts:218-605`

```
while(matching){                 // 递归扫描循环,直到没有新条目被激活
    for(i of fullLore){
        if 已激活 → continue
        if !alwaysActive && !key → continue
        content = CCardLib.decorator.parse(fullLore[i].content, ...)  // 解析装饰器
        组装 searchQueries:
            - 主关键词 key.split(',')                     (lorebook.svelte.ts:522)
            - 若 selective → secondkey.split(',')         (lorebook.svelte.ts:528)
            - 装饰器 <additional_keys> / <exclude_keys> / <exclude_keys_all> (440/447/454)
        对每个 query 调 searchMatch;negative 取反 (538-549)
        forceState('activate'/'dont_activate') 覆盖结果
        若激活 → push 到 actives,记录 matchLog,标记 activatedIndexes
        若 recursive → recursivePrompt.push(...) 并 matching=true  (573-603)
    }
}
```

### 2.4 `useRegexLorebook` 开关 — 确认存在

- 字段为 `loreBook.useRegex`(UI 绑定 `LoreBookData.svelte:280`,lang 文案"使用正则表达式" `cn.ts:1030` 及说明 `cn.ts:115`:"激活后,世界书将改用正则表达式(Regex)搜索,而不再使用字符串匹配。格式为 /regex/flags。")。
- 传入点:`lorebook.svelte.ts:535` `regex: fullLore[i].useRegex`。

### 2.5 是否先展开宏?

**是,被扫描的"历史消息"先展开了 CBS 宏,但关键词本身不展开。**

- 扫描发生前,`sendChat` 先调用 `runCurrentChatFunction`(`index.svelte.ts:146`):对 `chat.message` 每条 `msg.data` 执行 `risuChatParser(v.data, {chara: currentChar, runVar: true})` —— 即**先就地展开宏(且允许副作用 runVar)**,再在 `index.svelte.ts:498` 调用 `loadLoreBookV3Prompt()`。
- 匹配用的关键词是**原始字符串**(`fullLore[i].key.split(',')`),不经过宏解析;但正则脚本的 `<cbs>` 标志会对其 IN 模式先跑 `risuChatParser`(`scripts.ts:262-264`),那是另一条线。

---

## 3. 插入位置(position)与深度(depth)处理

### 3.1 位置来源:内容装饰器(`lorebook.svelte.ts:300-438`)

`CCardLib.decorator.parse(fullLore[i].content, cb)` 解析内容里的 `<tag>` 装饰器,决定:

| 装饰器 | 效果 |
|---|---|
| `<end>` | `pos='depth'; depth=0`(即 postEverything) |
| `<depth n>` / `<reverse_depth n>` | 指定插入深度 |
| `<position pt_xxx>` / `after_desc`/`before_desc`/`personality`/`scenario` | 指定插入锚点 |
| `<inject_lore>` | 合并进另一个世界书条目(`inject.lore=true`) |
| `<inject_at>` / `<inject_prepend>` / `<inject_replace>` | 注入到 prompt 模板卡片的指定位置 |
| `<role>` | 覆盖该条目的消息角色(system/user/assistant) |
| `<scan_depth>` / `<priority>` / `<ignore_on_max_context>` | 覆盖扫描深度 / 优先级(-1000) |
| `<activate_only_after>` / `<activate_only_every>` / `<is_greeting>` / `<probability>` | 额外激活条件 |
| `<keep_activate_after_match>` / `<dont_activate_after_match>` | 借助 `__internal_ka_*` / `__internal_da_*` 聊天变量锁定激活状态(`lorebook.svelte.ts:327-345`、`570-578`) |
| `<recursive>` / `<unrecursive>` / `<no_recursive_search>` | 递归扫描控制 |

### 3.2 在 `index.svelte.ts` 中的落点

| 条件 | 落点 | 位置 |
|---|---|---|
| `pos==='' && inject===null` | `unformated.lorebook` 段 | `index.svelte.ts:527-538` |
| `pos==='after_desc'/'before_desc'/'personality'/'scenario'` | `unformated.description` 段(前后包裹) | `index.svelte.ts:543-558` |
| `pos==='depth' && depth===0 && role!=='assistant'` | `unformated.postEverything` | `index.svelte.ts:582-590` |
| `pos==='depth' && depth===0 && role==='assistant'` | `postEverything` 末尾(assistant 预填) | `index.svelte.ts:593-610` |
| `pos==='depth' && depth>0` 或 `reverse_depth` | **splice 进 `unformated.chats` 历史数组指定深度** | `index.svelte.ts:1185-1194` |
| `{{position::xxx}}` 宏 | 模板卡片内动态展开(支持 5 层嵌套) | `index.svelte.ts:500-521` |
| `inject && !inject.lore` | 通过 `positionParser` 注入模板卡片文本 | `index.svelte.ts:611-640` |
| `inject.lore` | 合并到目标世界书条目文本(append/prepend/replace) | `lorebook.svelte.ts:627-660` |

深度具体算法(`index.svelte.ts:1193-1194`):
```ts
const depth = depthPrompt.pos === 'depth' ? (depthPrompt.depth) : (unformated.chats.length - depthPrompt.depth)
unformated.chats.splice(depth, 0, chat)
```

### 3.3 排序与叠加(token 预算 + 优先级)

`lorebook.svelte.ts:608-624`:
```ts
activesSorted = actives.sort((a,b) => b.priority - a.priority)      // 优先级降序
activesFiltered = activesSorted.filter(按 tokens 累加 <= loreToken)  // token 预算裁剪
activesResorted = activesFiltered.sort((a,b) => b.order - a.order)  // 段落内顺序降序
// 返回值 actives: activesResorted.reverse()
```
- 同一位置的多个条目**顺序叠加**(push 进同一段);token 预算按优先级从高到低填充,超出的丢弃。

---

## 4. 世界书条目内容中的宏

**结论:条目内容由 `risuChatParser`(CBS 宏解析器)解析,且解析发生在两个时点:**

1. **扫描期做 token 统计**:`lorebook.svelte.ts:576`
   ```ts
   tokens: await tokenize(risuChatParser(content, {chara: char})),
   ```
   (注释明确说明:针对 CBS 求值后的文本计数,使裁剪反映实际到达上下文的 token;`runVar` 保持 false,避免 setvar 等副作用。)

2. **落位期真正展开**:`index.svelte.ts:537`、`:548`、`:588`、`:609`(以及 depth 条目的 `:1063`、`:1191`)统一为:
   ```ts
   content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar})
   ```
   即先 `resolvePosition` 解析 `{{position::xxx}}`(最多 5 层嵌套,`index.svelte.ts:512-521`),再由 `risuChatParser` 展开所有 CBS 宏(`{{char}}`、`{{#if}}`、`{{getvar}}` 等)。

3. 内容中的 `<end>`、`<position>` 等**装饰器在扫描时已被 `CCardLib.decorator.parse` 剥离**(`lorebook.svelte.ts:300`),不会进入最终 prompt。

---

## 5. 正则脚本(editprocess)与世界书的关系

### 5.1 处理顺序:世界书扫描 → 正则脚本

- 世界书扫描:**`index.svelte.ts:498`** `const lorepmt = await loadLoreBookV3Prompt()`。
- 历史消息跑 editprocess 正则脚本:**`index.svelte.ts:902`**:
  ```ts
  let formatedChat = (await processScriptFull(nowChatroom, risuChatParser(msg.data, ...), 'editprocess', index, {...})).data
  ```
- 开场白跑 editprocess:`index.svelte.ts:873-875`。
- **结论:世界书激活判定发生在 editprocess 正则脚本之前**。扫描时读到的是"已展开宏但未经正则脚本处理"的历史文本(`index.svelte.ts:146` 只跑了宏)。正则脚本随后修改的是**即将发送的历史文本**,不会反过来影响已完成的匹配。

### 5.2 世界书内容不经过正则脚本

世界书条目内容从扫描到落位只走 `risuChatParser`(宏)+ `resolvePosition`,**从不进入 `processScriptFull(..., 'editprocess', ...)`**。正则脚本(editprocess)只作用于:开场白(`index:873`)、每条历史消息(`index:902`)、输入(`DefaultChatScreen.svelte:194` editinput)、输出(`index:1657/1716/1742/1806/1810` editoutput)、显示(editdisplay)。

### 5.3 正则脚本内部流程(`scripts.ts:85-364`)

```
processScriptFull:
  1) runLuaEditTrigger(char, mode, data)              // Lua 编辑脚本
  2) pluginV2[mode] 插件
  3) risuChatParser(data)                              // 先展开宏
  4) 按 <order n> 排序后逐个执行正则替换:
     - 标志 @@inject / @@move_top / @@move_bottom / @@repeat_back / <cbs> / <order n>
     - OUT 支持 $1、$&、$$、$n、命名组;flag 清洗后 new RegExp(input, flag)
     - 每次替换后再跑 risuChatParser(scripts.ts:296,322)
```
- `<cbs>` 标志表示 IN 模式也解析大括号宏(`scripts.ts:262-264`),这是正则脚本与 CBS 宏联动的关键点。

---

## 6. 提示词注入(Prompt Injection)系统

### 6.1 主体:触发器系统(`triggers.ts`)

`runTrigger(char, mode, arg)`(`triggers.ts:1058`),五种模式 `'start'|'manual'|'output'|'input'|'display'|'request'`。调用点:

| 模式 | 调用处 | 时机 |
|---|---|---|
| `start` | `index.svelte.ts:888` | 组装前(生成前) |
| `input` | `DefaultChatScreen.svelte:187` | 发送输入前(先于 editinput) |
| `output` | `index.svelte.ts:1763`、`:1871` | 生成后 |
| `display` | `scripts.ts:109`(editdisplay 内) | 仅显示处理 |
| `request` | `request.ts:249` | **最终 prompt JSON 提交给模型前**(displayData=JSON 化 formated,可改) |
| `manual` | `command.ts:230`、`Chat.svelte:249` | 手动触发 |

### 6.2 注入机制:`additonalSysPrompt`

- 触发器 `systemprompt` 效果把解析后的文本追加到 `additonalSysPrompt[location]`(`triggers.ts:1337-1340`),location ∈ `'start'|'historyend'|'promptend'`。
- 落位(`index.svelte.ts:1199-1211`):
  - `promptend` → `unformated.postEverything.push`
  - `historyend` → `unformated.lastChat.push`
  - `start` → `unformated.lastChat.unshift`(历史最前)
- 这等价于在世界书之外的第二套"注入锚点"。

### 6.3 触发器与正则脚本、宏的关系

- **触发器条件的 `exists` 类型**支持 `'strict'|'loose'|'regex'`(`triggers.ts:1240-1290`),其中 regex 直接 `new RegExp(val).test(da)` —— 触发器可用正则。
- **触发器的所有效果值与条件值都先经 `risuChatParser` 展开宏**才能使用(如 `triggers.ts:1268` 等大量调用)。
- **`extractRegex` 效果**用正则提取并支持 `$1`/`$&` 替换(`triggers.ts:1487-1497`);V2 有 `v2ExtractRegex`、`v2RegexTest`、`v2ReplaceString`(正则替换)、`v2QuickSearchChat`(loose/strict/regex 搜历史)。
- **触发器可读写世界书**:`v2ModifyLorebook`(`triggers.ts:1966`)、`v2GetLorebook`(1982)、`v2GetLorebookCount`(1989)、`v2GetLorebookEntry`、`v2SetLorebookActivation`(2003)、`v2GetLorebookIndexViaName`、`v2CreateLorebook`(2500)、`v2SetLorebookAlwaysActive` 等 —— 触发器是"主动脚本",世界书是"被动检索",二者通过这类 V2 效果互通。
- `display`/`request` 模式下用 `displayAllowList`/`requestAllowList` 限制可执行效果子集(`triggers.ts:1000-1056`);`displayData` 是传输 JSON 化 prompt 的载体(脚本或插件可改写请求体)。
- **正则脚本与触发器还有一条直接联动**:`processScriptFull` 的 editdisplay 分支会调用 `runTrigger(...,'display', {displayData: data})` 并把 `d.displayData` 写回(`scripts.ts:108-120`)。

---

## 7. 发送给模型前的最终 Prompt 组装顺序

### 7.1 默认段落顺序(`database.svelte.ts:74`、`:1999`)

```ts
formatingOrder = ['main','description', 'personaPrompt','chats','lastChat','jailbreak','lorebook', 'globalNote', 'authorNote']
```
末尾强制追加 `'postEverything'`(`index.svelte.ts:1222-1224`)。最终按 `formatOrder` 逐个 `pushPrompts`(`index.svelte.ts:1464-1468`);`pushPrompts` 会把相邻的同 role system 段合并(`index.svelte.ts:1233-1256`)。若使用 `promptTemplate`(自定义模板卡片),则按卡片 `type` 排列并逐段应用 `positionParser`/`risuChatParser`(`index.svelte.ts:1269-1462`)。

### 7.2 各段落内容与宏/正则时机

| 顺序 | 段落 | 内容来源 | 宏(CBS) | 正则(editprocess) |
|---|---|---|---|---|
| 1 | **main** | 主系统提示 + additionalPrompt(受 `promptPreprocess` 控制) | `risuChatParser` @ `index:433` | 无 |
| 2 | **description** | 角色卡 desc + personality + scenario + 附加信息 + before/after_desc 世界书 | `risuChatParser` @ `index:467-480,548,556` | 无 |
| 3 | **personaPrompt** | 用户人设 | `risuChatParser` @ `index:561-564` | 无 |
| 4 | **chats** | 示例对话(`exampleMessage`,`index:804`) + `[Start a new chat]` 标记(`index:810`) + 开场白 + 历史消息;深度世界书 spliced 进此段(`index:1191-1194`) | 历史先于扫描展开 @ `index:146`(runVar=true);落位再展开 @ `index:902` | **有**:开场白 `index:873`、每条消息 `index:902`(`processScriptFull 'editprocess'`) |
| 5 | **lastChat** | 最后一条消息 + 触发器 `start`/`historyend` 注入 | @ `index:1165,1205,1211` | 否 |
| 6 | **jailbreak** | 越狱提示(开关控制) | `risuChatParser` @ `index:436` | 无 |
| 7 | **lorebook** | 世界书 normalActives(位置为默认的条目) | `risuChatParser(resolvePosition())` @ `index:535-537` | 无 |
| 8 | **globalNote** | 全局便签 | `risuChatParser` @ `index:439` | 无 |
| 9 | **authorNote** | 作者便签(聊天级优先) | `risuChatParser` @ `index:447-455` | 无 |
| 10 | **postEverything** | CoT 指令(`:460`)、群聊系统消息(`:491`)、深度0世界书(`:586,609`)、触发器 promptend(`:1199`)、[Continue](`:1229`) | 各 `risuChatParser` | 无 |

### 7.3 组装后 → 发送前

1. 角色级 `depth_prompt` 在倒数 `depth` 位插入(`index.svelte.ts:1481-1487`);
2. `runLuaEditTrigger(currentChar, 'editRequest', formated)` 全局改写(`index.svelte.ts:1493`);
3. token 复核裁剪(移除 `removable` 消息,`index:1500-1525`);
4. `requestChatData` 内:插件 `replacerbeforeRequest` → **`runTrigger('request')` 对 JSON 化 prompt 做最后注入/改写**(`request.ts:236-262`)→ 提交;
5. 生成后 `output` 触发器(`index:1763,1871`)与 `editoutput` 正则脚本(`index:1657...`)处理回复。

### 7.4 宏观时序总结(一次 sendChat)

```
历史消息宏展开(index:146)
  → 组装 main/desc/persona/authornote/postEverything 原文并逐段展开宏(index:433-491)
  → ★ 世界书扫描 loadLoreBookV3Prompt(index:498)(内部:装饰器解析→关键词/正则匹配→token预算裁剪→排序;内容宏用于计数)
  → 世界书段落落位并 risuChatParser+resolvePosition(index:535-640)
  → promptTemplate 或 formatOrder 逐段 token 预算计算(index:689-805)
  → 开场白+历史逐条 editprocess:risuChatParser → 正则脚本(index:873,902)
  → start 触发器(index:888)
  → 深度世界书 spliced 进历史(index:1185-1194)
  → 触发器 additonalSysPrompt 注入(start/historyend/promptend)(index:1199-1211)
  → 按 formatOrder 拼接 final formated(index:1464)
  → 角色 depth_prompt + runLuaEditTrigger editRequest(index:1481-1493)
  → 发送前 request 触发器 + 插件改写(request.ts:236-262)
  → 模型 → output 触发器 + editoutput 正则脚本处理回复
```

---

## 关键结论

1. **世界书字段**:`key/secondkey/insertorder/comment/content/mode/alwaysActive/selective/activationPercent/useRegex/id/folder`(`database.svelte.ts:1319-1339`)。
2. **正则匹配确认存在**:每条目 `useRegex` 开关(lang `useRegexLorebook`"使用正则表达式",UI `LoreBookData.svelte:280`),格式 `/regex/flags`,匹配对象是"已展开宏但未跑正则脚本"的历史文本;关键词本身不展开宏(`lorebook.svelte.ts:143-165`)。
3. **位置/深度**:由内容装饰器(`<position>`/`<depth>`/`<reverse_depth>`/`<inject_*>`)决定,落在 10 个 prompt 段落之一或历史指定深度(`index.svelte.ts:535-640,1185-1194`);排序 = 优先级降序→token 预算→段落内降序。
4. **内容宏**:条目内容经 `risuChatParser` 解析两次(扫描期计数 `lorebook.svelte.ts:576`,落位期展开 `index:537/548/588/609`),装饰器在扫描期剥离。
5. **正则脚本与世界书**:世界书扫描(`index:498`)在 editprocess 正则脚本(`index:902`)**之前**;世界书内容不进正则脚本,仅走宏。
6. **注入系统**:触发器系统(`triggers.ts`)是主要注入机制(`start/input/output/display/request` 五时机 + `additonalSysPrompt` 三锚点 + `request` 模式 JSON 改写),自带正则(条件 `exists regex`、`v2RegexTest`、`v2ReplaceString`)并可读写世界书;世界书另有 `inject_at`/`{{position::}}` 模板注入通道。
7. **最终组装顺序**:`main → description → personaPrompt → chats(+depth 世界书) → lastChat → jailbreak → lorebook → globalNote → authorNote → postEverything`,随后 `editRequest` Lua 改写与 `request` 触发器注入后发送。
