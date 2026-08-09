# Risu vs SillyTavern 正则系统对比 — 第 1 轮调研

日期:2026-08-09
范围:正则脚本(Regex Script)引擎、数据结构、执行流程、flags、替换语义、作用域、排序
方法:两路子代理并行源码调研(Risu: `rius/risuai-src`,Tavern: `SillyTavern/SillyTavern-src`)

---

## 1. 术语对照

| 概念 | RisuAI | SillyTavern |
|---|---|---|
| 正则脚本 | `customscript`(代码内类型名,UI 叫 Regex Script) | `RegexScriptData` |
| 脚本存放(角色) | `character.customscript` | `characters[this_chid].data.extensions.regex_scripts`(SCOPED) |
| 脚本存放(全局) | `Database.presetRegex`(实际生效) / `Database.globalscript`(不生效,死代码) | `extension_settings.regex`(GLOBAL) |
| 脚本存放(预设/模块) | `RisuModule.regex`(模块)、bot preset 的 `regex` 字段 | preset 的 extension 字段 `regex_scripts`(PRESET) |
| 处理入口 | `processScriptFull` / `processScript` (`src/ts/process/scripts.ts:99`) | `getRegexedString` (`public/scripts/extensions/regex/engine.js:334`) |

---

## 2. 数据结构对比

### Risu `customscript`(database.svelte.ts:1307-1313)
```ts
{ comment, in, out, type, flag?, ableFlag? }
```
- 仅 **6 个字段**,无 id、无顺序号(顺序由 `<order n>` 运行时解析)、无深度、无独立启用开关。
- **启用/禁用 = `type === 'disabled'`**,因为执行时按 `script.type === mode` 过滤。
- 类型:`editinput` / `editoutput` / `editprocess` / `editdisplay` / `edittrans`(仅翻译用)/ `disabled`。

### Tavern `RegexScriptData`(char-data.js:88-102)
```js
{ id, scriptName, findRegex, replaceString, trimStrings[], placement[],
  disabled, markdownOnly, promptOnly, runOnEdit,
  substituteRegex(0/1/2), minDepth, maxDepth }
```
- **13 个字段**,包含 UUID、深度过滤、trim、宏替换开关、仅显示/仅 prompt 标志等。
- 独立 `disabled` 布尔。

**结论**:Tavern 字段更丰富,细粒度控制(深度、trim、substitute、markdown/prompt 分离)远多于 Risu。Risu 更简,靠"模式+flag 字符串"组合。

---

## 3. 执行流程对比

### Risu:单一入口 + 四种模式(调用点不同,引擎相同)
- 所有模式共用 `executeScript`(`scripts.ts:152` 按 `script.type === mode` 过滤)。
- 调用点:
  - `editinput` → 用户发送时 `DefaultChatScreen.svelte:194`(注意:仅角色,群聊不处理)
  - `editoutput` → 模型输出到达时 `process/index.svelte.ts:1657,1716,1742,1806,1810`
  - `editprocess` → 组装 prompt 时,开场白 `:873`、每条历史 `:902`
  - `editdisplay` → 渲染 Markdown 时 `parser/parser.svelte.ts:755`
- 额外:可缓存(LRU 1000)、可跑 Lua 触发器、pluginV2 钩子、CBS 预处理。

### Tavern:单一入口 + placement 驱动
- `getRegexedString(rawString, placement, opts)`(`engine.js:334`)按传入的 placement 过滤脚本。
- 调用点(核心三处):
  - prompt 构建 `script.js:4447`(isPrompt:true)
  - 显示渲染 `script.js:1809`(isMarkdown:true)
  - 消息收尾 `cleanUpMessage` `script.js:6422`(流式每 chunk + 收尾)
  - 其它:世界书 `world-info.js:5086`、开场白 `7660`、编辑 `8100`、斜杠命令等。

**结论**:两者都是"一个引擎 + 调用点决定语义"。Risu 用 `type` 字段挑选脚本;Tavern 用 `placement` 参数 + 脚本的 placement 数组匹配。

---

## 4. flags 处理对比(核心差异)

### Risu(scripts.ts:296-341)
- **自定义 flag 先剥离后拼回**:`ableFlag` 开启且 flag 含 `<` 时,用正则 `/<(.+?)>/g` 剥离 `<...>`,逗号分隔拆出 `order n` 与 actions(`inject/move_top/move_bottom/repeat_back/cbs/no_end_nl`),剩余原生 flags(`[^dgimsuvy]` 白名单净化、去重、空则兜底 `u`)传给 `new RegExp`。
- 自定义 flags:`<inject>` `<move_top>` `<move_bottom>` `<repeat_back>` `<order n>` `<cbs>`。
- **细节坑**:`ableFlag=false` 时强设 `flag='g'`,且 `<...>` 不会剥离 → 自定义 flag 静默失效。
- `move_top/bottom` 会临时移除 `g`,只处理第一个匹配。
- `<cbs>`:IN 先经 `risuChatParser` 大括号语法解析再当正则。

### Tavern
- 无自定义 flag 体系。findRegex 支持 `/pattern/flags` 形式(`utils.js:1388` `regexFromString`),flags 白名单 `[gmixXsuUAJ]`。
- **宏替换替代 flag 功能**:`substituteRegex`(0/1/2)控制 findRegex 是否做 `substituteParams`(宏)替换,`ESCAPED(2)` 还会转义正则元字符。
- 无 order/inject/move 概念 —— 顺序靠数组拖拽 + 作用域优先级。

**结论**:Risu 用 flag 字符串内嵌指令(功能强但隐蔽);Tavern 用结构化字段(markdownOnly/promptOnly/runOnEdit/substituteRegex)显式表达。

---

## 5. 替换(OUT / replaceString)语义对比

| 能力 | Risu | Tavern |
|---|---|---|
| 数字组 `$1` | ✅ 原生 replace | ✅ 函数内手动 `$n` |
| 整段 `$&` / `{{match}}` | ✅ `{{data}}`→`$&` | ✅ `{{match}}`→`$0` |
| 命名组 | 文档写 `$(name)`,**实际只支持 `$<name>`**(`scripts.ts:231-237`) | ✅ `$<name>` |
| 特殊 `$n`→换行 | ✅ 自定义(`:154` `$n`→`\n`) | ❌ 无 |
| 尾部 `>` 自动补换行 | ✅(`scripts.ts:163-165`,除非 `no_end_nl`) | ❌ 无 |
| 函数替换 | ❌ 不支持 | ❌ 不支持(注释明示) |
| trim | ❌ 无 | ✅ `trimStrings[]`(`engine.js:457-464`) |
| 结果宏替换 | ❌ 无(文档未提,实现无) | ✅ 结果过 `substituteParams`(`engine.js:444`) |
| `@@` 特殊效果 | ✅ `@@emo` 等(见下) | ❌ 无 |

### Risu 特有:OUT 以 `@@` 开头 → 特殊效果(scripts.ts:182-246)
- `@@emo <name>`:设置角色表情
- `@@inject`/`<inject>`:把当前中间态写回消息 data 再删除匹配
- `@@move_top/bottom`/`<move_top/bottom>`:整块移到顶部/底部
- `@@repeat_back`/`<repeat_back>`:当前无匹配时回溯上一消息取匹配结果
- 普通路径 `data.replace(reg, outScript)` 后再次跑 `risuChatParser`。

**结论**:Risu 的 OUT 语义更"重",内置 `@@` 动作 + 自动换行 + `$n`;Tavern 更"纯替换",但加了 trim 与宏替换。功能侧重不同。

---

## 6. 作用域与优先级对比

### Risu 合并顺序(scripts.ts:134)
```
db.presetRegex → char.customscript → getModuleRegexScripts()
```
- 逐条执行,前一条输出作为后一条输入。
- `<order n>` 存在时整体降序排序(`order` 越大越先执行,默认 0)。
- 坑:设置页 `GlobalRegex.svelte` 编辑的是 `db.globalscript`,**不参与执行**;真正"全局"是 bot preset 的 `presetRegex`。

### Tavern 作用域优先级(engine.js:11-16 SCRIPT_TYPES)
```
GLOBAL(0) → SCOPED(1) → PRESET(2)
```
- 每种类型内部按数组顺序(可拖拽)。
- `allowedOnly` 限制:scoped 需角色在 `character_allowed_regex`,preset 需 preset 在 `preset_allowed_regex`,首次遇到会弹窗询问。
- 无 order 字段,顺序 = 拖拽顺序。

**结论**:Risu 顺序可运行时覆盖(`<order n>`),但来源固定三段;Tavern 三段优先级硬编码,顺序靠 UI 拖拽。

---

## 7. 与流式输出联动对比

| 方面 | Risu | Tavern |
|---|---|---|
| 机制 | `editoutput` 在输出到达(流式/非流式/重卷)时处理 `reformatContent` | 流式每 chunk 在 `cleanUpMessage`(script.js:3600→6422)对**累计全文**重跑;非 markdown 脚本每 chunk 生效,markdownOnly 在 `messageFormatting`(`1809`)生效,收尾再跑一遍 |
| 显示 vs 数据 | `editdisplay` 仅改显示 | markdownOnly 仅显示,promptOnly 仅 prompt |
| 已知行为 | — | 对累计全文重复应用,替换随 chunk 叠加 |

---

## 8. 与翻译联动(Risu 独有)

- 翻译后重跑 `editdisplay`(`translator.ts:365-408`,由 `db.combineTranslation` 触发)。
- 专用 `edittrans` 类型(`translator.ts:621-639`):翻译结果末尾应用,仅"模块→角色"两级,简陋实现(只处理 `$n`,无 `@@`/自定义 flag)。
- Tavern 无对应内置。

---

## 9. 其它值得注意的坑

1. **Risu 文档与实现不一致**:`$(name)` 文档宣称支持,实际只认 `$<name>`;`<inject>` 文档说"注入",实现是"写回 data 再删匹配"。
2. **Risu 缓存**:`processScriptCache` LRU 1000,键含 data+mode+同 mode 脚本的 IN/OUT/chatID/flag/ableFlag。
3. **Risu `edittrans` 无 UI 文档入口**,仅翻译器内部使用。
4. **Tavern 无内置正则脚本**,新建默认 `markdownOnly=true, runOnEdit=true, placement=[USER_INPUT]`。
5. **Tavern 预设(RegexPreset)= 启用脚本 id 快照**,非脚本本体;导入导出为 JSON 且重新分配 UUID。
6. **Tavern placement 0/4 已废弃**(旧版 interrupt/start/in-chat 语义已移除,迁移逻辑在 index.js:1374)。

---

## 10. 一句话总结

> **Risu 正则 = 少字段 + 字符串 flag 内嵌指令(`<order>/<move_top>/<inject>/<cbs>`) + `@@` 动作 + 固定三段来源(预设→角色→模块)**;
> **Tavern 正则 = 多字段 + placement/markdownOnly/promptOnly/depth/substituteRegex 显式控制 + trim + 宏替换 + 三段作用域(Global→Scoped→Preset,拖拽排序)**。
> Risu 胜在"flag 魔法"紧凑,Tavern 胜在"结构化细粒度"。
