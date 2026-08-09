# RisuAI 正则脚本(Regex Script)系统调研报告 — Round 1

日期:2026-08-09
来源:子代理源码调研(`rius/risuai-src`)
范围:数据结构、执行流程、四种类型、flags 解析、OUT 语义、作用域、与翻译联动、排序

---

## 0. 术语与命名约定

| 代码中的命名 | 含义 |
|---|---|
| `customscript` | 正则脚本的类型名(代码中没有 `RegexScript` 类型,这个名称只出现在翻译字符串中) |
| `Regex Script` / `正则表达式` | UI 与文档中的人类可读名称 |
| `type` 字段值 | `editinput` / `editoutput` / `editprocess` / `editdisplay` / `edittrans` / `disabled` |

核心引擎集中在 `src/ts/process/scripts.ts`(391 行,单文件实现)。

---

## 1. 数据结构 / 类型定义

### 类型定义

`src/ts/storage/database.svelte.ts:1307-1313`:
```ts
export interface customscript{
    comment: string;   // 名称
    in:string          // 正则
    out:string         // 替换模板
    type:string        // 四种模式之一(字符串,非枚举)
    flag?:string       // 原生flags + 自定义 <...> flags
    ableFlag?:boolean  // 是否启用自定义 flag(即 UI 中的 "Custom Flag" 开关)
}
```

**注意**:没有"顺序号"字段存储,`<order n>` 是在运行时从 `flag` 字符串解析出来的。也没有单独的"启用"布尔字段——**启用/禁用靠 `type === 'disabled'`**,因为执行时 `script.type === mode` 永远无法匹配 `disabled`。

### 存放位置

- 角色/群聊: `character.customscript` — `database.svelte.ts:1364`、`groupChat.customscript` — `database.svelte.ts:1524`
- 全局(preset): `Database.presetRegex` — `database.svelte.ts:1134`;遗留字段 `Database.globalscript` — `database.svelte.ts:905`
- 模块: `RisuModule.regex` — `src/ts/process/modules.ts:23`

### UI 编辑器字段

`src/lib/SideBars/Scripts/RegexData.svelte:112-124`: `comment`、`type`(下拉: editinput/editoutput/editprocess/editdisplay/edittrans/disabled)、`in`、`out`、`flag`(通过 UI 开关/数值框间接编辑)、`ableFlag`(复选框)。UI 提供的原生 flags 只有 `g/i/m/u/s`(RegexData.svelte:81-90)。

---

## 2. 执行流程:在管线中的调用位置与输入源

所有模式共用同一入口 `processScriptFull`(`scripts.ts:99`),`processScript`(`scripts.ts:26`)只是它的包装(chatID=-1)。

### 四个模式的调用点(输入源)

| 模式 | 触发时机 | 输入源 | 调用位置 |
|---|---|---|---|
| **editinput** (Modify Input) | 用户按下发送、消息存入聊天 | 用户原始输入 `messageInput` | `src/lib/ChatScreens/DefaultChatScreen.svelte:194` |
| **editoutput** (Modify Output) | 模型输出到达(流式/非流式/重卷) | 角色输出文本 `reformatContent(prefix+result)` | `src/ts/process/index.svelte.ts:1657,1716,1742,1806,1810` |
| **editprocess** (Modify Request Data) | 组装发送给模型的 prompt 时 | 开场白、每条历史消息 | `index.svelte.ts:873`(firstMessage)、`:902`(ms 循环内) |
| **editdisplay** (Modify Display) | 消息渲染为 Markdown 时 | 显示文本(仅展示,不改数据) | `src/ts/parser/parser.svelte.ts:755` |

### editinput 细节

`DefaultChatScreen.svelte:194` 中,`editinput` 的结果**被写入聊天记录** `cha.push({role:'user', data: await processScript(char,messageInput,'editinput'), ...})`。注意只有 `char.type === 'character'` 走此分支,群聊(`group`)直接存原始输入(`DefaultChatScreen.svelte:198-204`)。

### editprocess 细节

`index.svelte.ts:873` 对开场白、`:902` 对每条历史消息调用,然后才进行 token 化与 HTTP 请求。HypaV3 摘要重新生成时也复用:`src/lib/Others/HypaV3Modal/utils.ts:98-118`(`processRegexScript` 以 `editprocess` 调用)。

### processScriptFull 内部处理顺序

`scripts.ts:99-144`:
1. `runLuaEditTrigger`(Lua 触发器)—— `scripts.ts:102`
2. `editdisplay` 专属: `runTrigger(currentChar,'display', ...)` —— `scripts.ts:104-122`
3. pluginV2 插件钩子 —— `scripts.ts:124-131`
4. `data = risuChatParser(data, ...)`(CBS 大括号语法预处理)—— `scripts.ts:133`
5. 合并脚本源: `(db.presetRegex ?? []).concat(char.customscript).concat(getModuleRegexScripts())` —— `scripts.ts:134`
6. 缓存查/写(键见第 4 节)—— `scripts.ts:135-144`
7. 逐条执行 `executeScript` —— `scripts.ts:335-341`
8. 动态资源(dynamicAssets)模糊匹配后处理 —— `scripts.ts:345-382`

---

## 3. 四种类型的实现

**重要结论:四种类型没有各自的引擎,完全共享同一个 `executeScript` 函数**。`type` 只决定"哪些脚本参与本次处理":`executeScript` 内 `if(script.type === mode)`(`scripts.ts:152`)过滤。模式的差异体现在**调用点**而非处理逻辑。

### `executeScript` 内部行为(scripts.ts:145-294)

核心分支(`scripts.ts:182`):当 OUT 以 `@@` 开头 **或** 存在自定义 actions 时走"特殊效果"路径,否则走普通 `String.replace`:

| OUT 前缀 / action | 行为 | 位置 |
|---|---|---|
| `@@emo <name>` | 命中则设置角色表情(写入 `CharEmotion`,限 4 个、去重),`emoChanged=true` | `scripts.ts:184-206` |
| `@@inject` / `<inject>` | 把当前 `data` 写回 `message[chatID].data`,再从 data 中删除匹配 | `scripts.ts:207-211` |
| `@@move_top`/`@@move_bottom` / `<move_top>`/`<move_bottom>` | 把匹配内容整块移到文本顶部/底部 | `scripts.ts:212-246` |
| `@@repeat_back` / `<repeat_back>` | 当前文本无匹配时,回溯同 role 的上一消息取其匹配结果拼入(支持 `end`/`start`/`end_nl`/`start_nl`) | `scripts.ts:252-287` |
| 其它(含空 action) | `data.replace(reg, outScript)` 后再次跑 `risuChatParser` | `scripts.ts:248,291` |

### 备注

- 移动型 move_top/bottom 的匹配数:`scripts.ts:160-162` 会把 `g` 从 flag 中临时移除(注释 `//temperary fix`),导致 `scripts.ts:216` 的 `flag.includes('g')` 为 false,**只处理第一个匹配**。
- `@@` 系列只有正则命中(`reg.test(data)`)时才生效;未命中且无 repeat_back 时什么都不做(`scripts.ts:183,251`)。
- 另有一种**文档未提及**的 `edittrans` 类型,只被翻译器使用(见第 7 节),`processScript` 从不处理它。

---

## 4. flags 的解析逻辑

### 关键流程(scripts.ts:296-341)

自定义 `<...>` flags 在**执行前统一"剥离"**,剥离后剩下的原生 flags 再传给 `new RegExp`:

**剥离阶段** `scripts.ts:298-330`:
```ts
if(script.ableFlag && script.flag?.includes('<')){
    const rregex = /<(.+?)>/g
    ...
    scriptData.flag = scriptData.flag?.replace(rregex, (v, p1) => {
        const meta = p1.split(',').map((v) => v.trim())   // 支持逗号分隔
        for(const m of meta){
            if(m.startsWith('order ')){
                order = parseInt(m.substring(6))           // <order n>
                orderChanged = true
            } else {
                actions.push(m)                             // 其余全部进 actions
            }
        }
        return ''                                          // 从 flag 中移除
    })
}
```

- 自定义 flags 只产生两类产物:`order`(数字)与 `actions`(字符串数组: `inject`/`move_top`/`move_bottom`/`repeat_back`/`cbs`/`no_end_nl`)。
- 例如 `gi<cbs><move_top>` → 原生部分 `gi` 保留,`cbs`、`move_top` 进入 actions。

**执行阶段** `scripts.ts:156-181`:
- `ableFlag` 为 false 时强制 `flag = 'g'`(`scripts.ts:156-159`)——此时若有 `<...>` 也不会被剥离(因为剥离以 `ableFlag` 为前提),它们会被净化正则直接丢弃,即自定义 flag 在 ableFlag=false 时静默失效。
- move_top/bottom 先移除 `g`(`scripts.ts:160-162`)。
- 原生 flag 白名单净化: `flag.replace(/[^dgimsuvy]/g, '')`(`scripts.ts:167`),再去重(`scripts.ts:170`),空则兜底 `'u'`(`scripts.ts:172-174`)。
- `<cbs>` 特殊处理: `input = risuChatParser(input, ...)` 把 IN 当作 CBS 模板解析后再作为正则(`scripts.ts:176-179`)。缓存键也在原始(未剥离)阶段用 `script.flag?.includes('<cbs>')` 判断并预解析 IN(`scripts.ts:77`)。

**总结**:自定义 flags 确实是"先剥离、后拼回"——先剥离开 `order`/actions,原生部分净化后用于 `new RegExp`。

---

## 5. OUT(替换模式)的语义

### 预处理(scripts.ts:15,154-165)

```ts
const dreg = /{{data}}/g                                // :15
let outScript2 = script.out.replaceAll("$n", "\n")     // :154  $n → 换行(自定义)
let outScript  = outScript2.replace(dreg, "$&")        // :155  {{data}} → $&(整体匹配)
if(outScript.endsWith('>') && !pscript.actions.includes('no_end_nl')){
    outScript += '\n'                                  // :163-165  OUT 以 > 结尾自动补换行
}
```

### 普通路径:`data.replace(reg, outScript)`

`scripts.ts:248,291` 直接调用 **原生 JS `String.prototype.replace`**,因此 `$1`、`$&`、`` $` ``、`$$`、`$<name>`(命名组)均按 JS 语义生效。

### 文档与实现的不一致

- **`$(name)` 文档声称支持,但实现不支持**:官方文档(`lang/en.ts:70`、`lang/cn.ts:67` 等)宣称 `$(name)` 插入命名群组,但代码中没有任何 `$(` 的转换逻辑。JS 原生只认 `$<name>`。真正生效的是 `$<name>`——而且 `move_top/bottom` 路径正是显式用 `/(?<!\$)\$<([^>]+)>/g` 处理的(`scripts.ts:231-237`)。
- 同一路径还手动实现了 `$n`(`/(?<!\$)\$[0-9]+/g`,`scripts.ts:223-229`)与 `$&`(`scripts.ts:230`),并带负向断言避免处理 `$$`。
- **函数替换不支持**:所有路径都把 `outScript` 作为字符串传给 `replace`,没有任何位置传入函数作为替换参数。

---

## 6. 全局脚本 vs 角色脚本:合并规则

### 合并规则(scripts.ts:134)

```ts
const scripts = (db.presetRegex ?? []).concat(char.customscript).concat(getModuleRegexScripts())
```

优先级/顺序 = **bot preset 的 regex(`presetRegex`) → 角色 `customscript` → 模块 `regex`**。

- `getModuleRegexScripts()`(`src/ts/process/modules.ts:476-489`)聚合所有已启用模块(`getModules`,`modules.ts:426-472`)的 `module.regex`。
- 模块 "Apply" 到角色时,是直接把 `module.regex` 逐个 push 进 `char.customscript`(`modules.ts:536-539`)。

### 重要发现:设置页"全局正则"与执行管线脱节

- 设置页 `src/lib/Setting/Pages/GlobalRegex.svelte:11` 编辑的是 **`db.globalscript`**。
- 但执行管线 `scripts.ts:134` 用的是 **`db.presetRegex`**。
- `db.globalscript` 在整个代码库中**只**被 `GlobalRegex.svelte` 和 `exportRegex()` 的默认参数(`scripts.ts:32`)引用,**不参与任何处理**。
- 真正生效的"全局正则"是 `db.presetRegex`——它其实是**bot preset 的一部分**: `saveCurrentPreset` 时导出(`database.svelte.ts:2104` `regex: db.presetRegex`),`setPreset` 时载入(`database.svelte.ts:2229` `db.presetRegex = newPres.regex ?? []`),UI 编辑入口在 `src/lib/Setting/Pages/BotSettings.svelte:788`。

### 导入导出

`exportRegex`/`importRegex`(`scripts.ts:30-66`)以 `{type:'regex', data:[...]}` 格式读写,可导出/导入任意数组;模块导入也支持 `type==='regex'` 转成模块(`modules.ts:340-347`)。

---

## 7. 与翻译(translator)的联动

`src/ts/translator/translator.ts` 有两处正则脚本关联:

**(a) 翻译后重跑 editdisplay**(`translator.ts:365-408`):
```ts
if (!reprocessDisplayScript) { node.textContent = translated; return; }
const { data: processedTranslated } = await processScriptFull(
    alwaysExistChar, translated, "editdisplay", chatID
);
```
- 由 `db.combineTranslation` 开关触发(`translator.ts:436-438`)。即翻译后对译文重新执行角色的 editdisplay 正则。

**(b) `edittrans` 专用脚本**(`translator.ts:621-639`):
```ts
function applyEdittransRegex(text, charArg, alwaysExistChar): string {
    scripts = (getModuleRegexScripts() ?? []).concat(alwaysExistChar?.customscript ?? [])
    for (const script of scripts) {
        if (script.type === 'edittrans') {
            const reg = new RegExp(script.in, script.ableFlag ? script.flag : 'g')
            let outScript = script.out.replaceAll("$n", "\n")
            text = text.replace(reg, outScript)
        }
    }
    return text
}
```
- 在翻译流程末尾应用:`translator.ts:295`(LLM 翻译)、`:306`(Bergamot)、`:492`(HTML 翻译序列化后)。这是 **UI 中 "Edit Translation Display" 选项**(`lang/en.ts:1092`)。
- **注意顺序与主流程不同**:这里只有"模块 → 角色",**不含 `presetRegex`**;且是**独立、简陋的替换实现**(只处理 `$n` 换行,无 `@@`/自定义 flag/`<cbs>` 等能力,直接用 `script.flag` 原样传入 `new RegExp`)。

---

## 8. 排序 / 优先级规则

### 基础顺序(无 `<order>` 时)

按合并数组顺序: `presetRegex → char.customscript → getModuleRegexScripts()`(`scripts.ts:134`),逐条执行、前一条的输出作为后一条的输入(`scripts.ts:335-341`,即"先执行的先改变 data")。

### `<order n>` 排序

`scripts.ts:332-334`:
```ts
if(orderChanged){
    parsedScripts.sort((a, b) => b.order - a.order) //sort by order
}
```
- **降序**:`order` 越大越靠前执行。默认 0。
- 只有当**至少一个脚本声明了 `<order n>`** 时(`orderChanged=true`,`scripts.ts:309`)才触发排序;否则保持数组原始顺序。现代 JS `sort` 稳定,因此同 order 的脚本保持原相对顺序。
- 细节:排序作用域是**全部脚本**(跨模式),不匹配当前 mode 的脚本只是执行时被 `script.type === mode` 跳过(`scripts.ts:152`)。
- 因为每个脚本的产物会传给下一个脚本,文档所说"higher order shown first"在实现上等于"higher order 先被处理、后执行的脚本基于其结果叠加"。

---

## 附:其它值得注意的实现细节

- **结果缓存**:`processScriptCache`(LRU,上限 1000,`scripts.ts:68-97`)。键由 data+mode+各同 mode 脚本的(IN/OUT/chatID/flag/ableFlag)组成(`scripts.ts:71-80`);`resetScriptCache()` 在 `scripts.ts:95`。
- **`@@emo` 表情历史限 4 个**并去重(`scripts.ts:191-205`)。
- **`<inject>` 的实际语义与文档相反**:文档说"把结果注入当前字符串",实现却是把当前中间态 `data` 写回 `message[chatID].data` 再删掉匹配(`scripts.ts:207-211`)。
- **HypaV3 联动**:`hypaV3.ts:40,1801` 的 `processRegexScript` 开关("重新生成时应用正则脚本",UI 在 `OtherBotSettings.svelte:1222`)控制 HypaV3 摘要重卷时是否用 `editprocess` 处理消息(`modal-footer.svelte:33,45,51`、`modal-summary-item.svelte:215`)。
- **MCP 工具**可读/写/删角色的 regex scripts(`mcp/risuaccess/characters.ts:730-910`,字段组织见 `:749-757`)与模块的 regex(`mcp/risuaccess/modules.ts:649-760`)。
