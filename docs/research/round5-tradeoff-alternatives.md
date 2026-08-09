# 缺口取舍与替代方案:Tavern 正则 → Risu 子系统矩阵 — 第 5 轮调研

日期:2026-08-09
范围:对第 4 轮发现的"正则转换缺口",逐项给出取舍决策,并评估用 Risu 的 lorebook(世界书)/模块/触发器作为替代载体的可行性矩阵
方法:基于工作区 tavern preset 12 个正则实测分类 + 两路子代理专项调研(触发器 `round5-trigger-alternative.md`、模块 `round5-module-carrier.md`)+ Round 1/3 的正则与世界书结论

---

## 0. 结论速览

| 问题 | 答案 |
|---|---|
| 缺口怎么取舍? | 5 类缺口:**可接受丢弃 2 类**(minDepth/maxDepth 大多可用触发器替代、trimStrings 可弃)、**必须拆解 1 类**(markdownOnly+promptOnly 双开)、**建议保留正剧 1 类**(单条消息字符串变换)、**必须换引擎 1 类**(提取用户输入只能用 editinput) |
| 代替方案? | 有。**触发器**替代"深度过滤+跨消息协同+注入";**世界书 useRegex+inject**替代 WORLD_INFO 型正则;一切可打包进**模块**统一分发 |
| 12 个实测正则怎么落? | 8 个直接映射 Risu 正则,3 个拆成双脚本,深度过滤类用触发器补强 |

---

## 1. 实测 12 个 tavern 正则的分类(来自 preset `extensions.regex_scripts`)

| # | 功能(乱码名解码) | placement | 双开 | 深度 |
|---|---|---|---|---|
| 1 | 思考块美化(think/inner_flow → HTML 折叠) | AI_OUTPUT | M | ≤10 |
| 2 | [重要]删除历史思考块(不发给 AI) | AI_OUTPUT | **M+P** | 无 |
| 3 | 小 COT 折叠美化(Breakpoint) | AI_OUTPUT | M | ≤5 |
| 4 | 删除 COT/状态小 cot | AI_OUTPUT | **M+P** | ≥5 |
| 5 | Choice 选择块显示 | AI_OUTPUT | M | ≤1 |
| 6 | Forum 论坛块显示 | AI_OUTPUT | M | ≤1 |
| 7 | 删除(小剧场+html 注释) | AI_OUTPUT | **M+P** | 无 |
| 8 | [重要]提取用户输入 | **USER_INPUT** | P | 0~1 |
| 9 | 总结-摘要 11-50 楼删除的 | AI_OUTPUT | P | 11~50 |
| 10 | 总结-总总结 51+ 删除摘要的 | AI_OUTPUT | P | ≥51 |
| 11 | 总结-移除用户输入 | **USER_INPUT** | P | ≥11 |
| 12 | 总结-摘要美化(Flux 折叠) | AI_OUTPUT | M | ≤5 |

分类:
- **显示美化类**(M,#1,3,5,6,12):只在显示时把思考块/标签包成 HTML 折叠 → 最佳目标 **`editdisplay`**。
- **删除类**(P,#2,4,7,9,10):从发给模型的文本里删思考块/注释 → 最佳目标 **`editprocess`**。
- **提取/改写用户输入类**(USER_INPUT,#8,11):→ **`editinput`**。
- **深度过滤类**(#9,10,11 有 minDepth 11~51+;其它有 maxDepth):Risu 正则无深度,需取舍或触发器替代。

---

## 2. 缺口取舍决策表

| 缺口(第 4 轮) | 影响 | 取舍决策 | 代替方案 |
|---|---|---|---|
| `minDepth`/`maxDepth`(深度过滤) | 高(#9/10/11 就是靠它区分 11-50/51+/0-1) | **接受丢弃 → 用触发器/条件补** | 触发器 `exists` 条件自带 `depth`(`triggers.ts:1296-1308`)、`v2QuickSearchChat` 自带深度、`chatindex` 按消息条数门控。**触发器是唯一能表达深度的地方** |
| `markdownOnly+promptOnly` 双开(#2,4,7) | 高(同一个脚本既删 prompt 又只显示) | **必须拆两个 Risu 脚本** | 拆成 `editprocess`(删)+ `editdisplay`(仅显示)。Risu 单脚本单 type,不可复用 |
| `trimStrings[]`(#1,2,3,4,7 有 2 个) | 中(裁掉首尾的 `<`/`>` 等) | **接受丢弃** | 若重要,可把 trim 逻辑写进 `out`(如 `$&` 后再裁),或忽略(多为显示细节) |
| `runOnEdit` | 低(编辑消息时是否跑) | **接受丢弃** | Risu editinput/editoutput 默认覆盖编辑/重卷场景,行为略宽松 |
| `substituteRegex`(findRegex 宏) | 低(示例中全为 0) | **按需转换** | `≠0` → Risu `<cbs>` flag(Round 4 §1.3) |
| 单条消息字符串变换 | 高(所有 12 个的本质) | **保留正则脚本** | 见 §3.1:触发器做单条替换要 4~6 节点,不划算 |
| 提取用户输入(#8) | 高 | **必须用 editinput** | 触发器 input 模式拿不到新输入(`DefaultChatScreen.svelte:187-197`),**不可替代** |
| `placement` 含 WORLD_INFO/REASONING/SLASH_COMMAND | 中 | 见 §3.3 | 世界书 useRegex + `{{}}` 宏可做条件激活;Risu 无 reasoning/slash 概念 |

---

## 3. 替代方案矩阵:Tavern 正则功能 → Risu 子系统

### 3.1 四条替代路径的定位

| Risu 子系统 | 本质 | 适合替代哪类 tavern 正则 |
|---|---|---|
| **正则脚本 `customscript`**(presetRegex/角色/模块) | 逐条消息字符串替换(editinput/process/output/display) | **主体**:单条消息的删除/美化/提取(直接映射,首选) |
| **触发器 `trigger`** | 块式逻辑引擎,可读改写整个 `chat.message`、条件深度、注入三位置 | **深度过滤**、跨消息协同、`systemprompt` 注入、条件门控(替代 minDepth/maxDepth 与注入类) |
| **世界书 `lorebook`** | 关键词/正则激活 + 内容注入 + `<inject_*>` 装饰器 | **WORLD_INFO 型正则**、基于内容的动态注入(替代"检测到 X 才注入 Y") |
| **模块 `module`** | 承载 regex+lorebook+trigger+assets+toggle 的容器 | **打包载体**:把转换产物打包成单个模块统一启用/分发(不是替代,是组织) |

### 3.2 逐功能替代建议

| Tavern 正则功能 | 首选落点 | 备选 | 取舍点 |
|---|---|---|---|
| 显示美化(HTML 折叠) | `editdisplay` 正则脚本 | display 触发器(`v2SetDisplayState`) | editdisplay 足够;display 触发器不能读其他消息,仅美化可用 |
| 从 prompt 删除内容 | `editprocess` 正则脚本(逐条零配置) | start/output 触发器(`v2LoopNTimes`+`v2GetMessageAtIndex`+`v2ReplaceString`+`v2ModifyChat`) | **首选正则**;触发器能做但每脚本 4~6 节点且无法一步循环到无匹配 |
| 深度过滤(只处理 11~50 楼等) | **触发器**:`exists` 条件(depth)+ 正则效果 | 拆成多脚本人工区分 | 触发器是唯一带 depth 的地方,这是**触发器超越正则脚本**的场景 |
| 提取/改写用户输入 | **`editinput` 正则脚本** | ❌ 触发器不可替代 | 触发器 input 模式拿不到新输入 |
| 检测到关键词才注入 | 世界书(`useRegex` + 内容 + `<inject_at>`/`<inject_lore>`) | 触发器 `exists regex` 条件 + `systemprompt` 效果 | 世界书是"被动检索+注入";触发器更主动 |
| 仅显示不占 token | `editdisplay`(Risu 天然如此) | — | Risu 无 markdownOnly/promptOnly 字段,靠 type 区分 |

### 3.3 世界书作为替代的边界

- 世界书 `useRegex=true`(格式 `/regex/flags`)可做正则激活(`lorebook.svelte.ts:143-165`),但匹配对象是"历史消息文本",**关键词不展开宏**,且不修改文本、只注入内容。
- 因此世界书适合替代的 tavern 正则:**"检测到某模式 → 把某段内容注入 prompt"** 这一型(如人物状态跟踪、环境描述注入)。不适合替代"删除/改写已有文本"型(那是正则/触发器的活)。
- 世界书内容只走宏、不过正则(Round 3 结论)——所以**不能**用世界书+正则脚本组合来清洗世界书文本(与 tavern 相反)。

### 3.4 触发器作为替代的边界(关键约束)

- display/request 模式**不能**通过效果读历史消息(allowlist 限制,`triggers.ts:985-1036`),只能读 `displayData`。
- 触发器改写单条消息必须走"循环+取下标+替换+写回",工程成本高;单条字符串变换仍优先正则脚本。
- 触发器 `v2ReplaceString` 结果落在 `outputVar`,需再 `v2ModifyChat` 写回,不支持"一步到位"。
- 群聊角色不跑触发器(`request.ts:247` 等 `type!=='group'` 判断),但模块触发器仍生效。

---

## 4. 模块作为最终打包载体(推荐方案)

**最佳实践:把转换产物打包成一个 Risu 模块**(同时带 `regex` + `trigger` + 可选 `lorebook`):

```
{
  name: "<preset名> 正则体系",
  description: "从 SillyTavern preset <名> 转换",
  regex: [ <8~12 个 customscript,按 §2 取舍/拆解> ],
  trigger: [ <深度过滤型触发器,替换 minDepth/maxDepth> ],
  lorebook: [ <WORLD_INFO 注入型可选的条目> ],
  assets: [ <HTML/JS 素材可作 asset> ],
  namespace: "<一键启用用的命名空间>"
}
```

- 模块导入格式:`.json`(裸 `risuModule` JSON,`modules.ts:256-355`)最易生成;也可导出 `.module`(charx v3)分发。
- 启用:全局 `enabledModules` 或角色 `character.modules`;用 `namespace` + `moduleIntergration` 批量启用。
- 优先级:模块 regex 在 `presetRegex → char.customscript → 模块` 最后,但可用 `flag` 里 `<order 100>` 覆盖(`scripts.ts:296-334`)。
- 变量:模块无 variables 字段,需用触发器 `setvar` effect 或 `customModuleToggle` 表达(Round 5 模块报告 §8)。
- 不依赖 `cjs`(死字段)。

**相比直接进 presetRegex 的优势**:模块是独立分发单元,不污染全局 preset,可单角色/单聊启用,可同时携带触发器与世界书完成"正则做不了的部分"。

---

## 5. 12 个正则的最终落地方案(实操)

| # | 名称 | 落地 |
|---|---|---|
| 1 | 思考块美化 | `editdisplay` 正则(直接映射);trimStrings 丢弃 |
| 2 | [重要]删除历史思考块 | **拆**:`editprocess`(删,发给模型)+ `editdisplay`(可选保留 HTML 效果给历史显示)。tavern 双开 → Risu 两脚本 |
| 3 | 小 COT 折叠 | `editdisplay`;maxDepth≤5 丢弃(或触发器门控) |
| 4 | 删除 COT | **拆**:`editprocess`(删)+ `editdisplay`;minDepth≥5 → 触发器 `exists`+depth 或接受全局 |
| 5 | Choice 块 | `editdisplay`;maxDepth≤1 → 触发器或接受 |
| 6 | Forum 块 | `editdisplay`;maxDepth≤1 同上 |
| 7 | 删除小剧场/注释 | **拆**:`editprocess` + `editdisplay` |
| 8 | [重要]提取用户输入 | `editinput`(唯一可靠落点) |
| 9 | 摘要 11-50 楼删除 | **触发器**(depth 11~50)+ `v2ReplaceString`;或 `editprocess` + 接受全局(推荐触发器) |
| 10 | 总总结 51+ 删摘要 | **触发器**(depth 51+);或 `editprocess` + 接受 |
| 11 | 移除用户输入 | `editinput` + 触发器门控(≥11 楼) |
| 12 | 摘要美化 | `editdisplay`;maxDepth≤5 → 触发器或接受 |

### 简化策略(取舍降级)
如果不想引入触发器复杂度,**可接受的降级**:
- 深度过滤类(#9/10/11)→ 直接 `editprocess`/`editinput` 全局生效(结果:低楼摘要也被删,行为略过)。对"摘要管理"型 preset 通常影响可接受。
- 双开类(#2/4/7)→ 只保留 `editprocess`(删),丢弃显示美化分支(最简)。
- 显示美化类 → 全 `editdisplay`(无 token 成本,零风险)。

---

## 6. 一句话总结

> **取舍**:minDepth/maxDepth、trimStrings、runOnEdit 三缺口可接受丢弃或降级;markdownOnly+promptOnly 必须拆双脚本;提取用户输入必须用 editinput(触发器做不到)。
> **替代**:单条消息变换 → Risu 正则(首选);深度过滤/跨消息/注入 → **触发器**(唯一带 depth 的引擎);检测+注入 → **世界书 useRegex+inject**;打包分发 → **模块**(regex+trigger+lorebook+assets 一体)。
> **实操**:12 个正则中 8 个直接映射、3 个拆双脚本、深度型用触发器补强,全部装进一个模块即可随 preset 一同分发。

---

## 7. 重要修正:Risu 正则 OUT 可原生做深度过滤(不必全靠触发器)

**发现**(2026-08-09,用户提供示例 + 源码验证):Risu 正则脚本的 `out` 支持 CBS 宏 `{{chatindex}}`/`{{lastmessageid}}`,配合 `{{#if}}` 条件块,可以在正则脚本内部直接实现 tavern 的 `minDepth`/`maxDepth` 语义——**无需触发器**。这推翻了 §2 决策表"触发器是唯一能表达深度的地方"和上一轮的"显示路径深度过滤触发器救不了"结论。

### 7.1 用户示例(保留最近 6 条消息内的 `<img>`,旧消息删除)

```
in:   <img="(.*?)">[\s\S]*
out:  {{#if {{greater_equal::{{chat_index}}::{{? {{lastmessageid}}-5}}}}}}$&{{/if}}
flag: <cbs>
```

### 7.2 源码证据链

| 环节 | 证据 |
|---|---|
| `{{chat_index}}` = `{{chatindex}}` 宏 | `cbs.ts:416-423`,别名 `chat_index`,返回 `matcherArg.chatID`;无消息上下文时返回 `-1` |
| `{{lastmessageid}}` 宏 | `cbs.ts:738-746`,返回 `chat.message.length - 1`(最后一条索引,0-based) |
| `{{greater_equal}}` 宏 | `cbs.ts:927-932`,别名 `greater_equal`,数值 `>=` 比较返回 `1/0` |
| `{{? 表达式}}` 数学宏 | `parser.svelte.ts:1038-1041`(`calcString`),先展开内部宏再计算 |
| `{{#if}}` 块判定 | `parser.svelte.ts:1152-1161`:state 为 `true`/`1` 输出块(`parse`),否则忽略块(`ignore`) |
| **三种模式 chatID 均 = 消息索引** | editdisplay:`ChatBody.svelte:249` `markParsing(msgDisplay, character, idx)` → `ParseMarkdown(..., idx)` → `processScriptFull(...,'editdisplay', idx)`;editprocess:`process/index.svelte.ts:902` `processScriptFull(...,'editprocess', index)`;editoutput:`process/index.svelte.ts:1657` 等 `processScriptFull(...,'editoutput', msgIndex)` |
| OUT 中宏生效 | `scripts.ts:248,291`:`data.replace(reg, outScript)` 后再跑 `risuChatParser(data, {chatID, cbsConditions})` |

### 7.3 depth ↔ chatindex 换算公式(关键)

| 概念 | Tavern | Risu |
|---|---|---|
| 最新一条消息 | depth 0 | `chatindex` = `{{lastmessageid}}` |
| 第 d 层深度 | depth d | `chatindex` = `lastmessageid - d` |
| 深度范围 `[minDepth, maxDepth]` | minDepth(默认0,最新)~ maxDepth(默认∞,最老) | `lastmessageid - maxDepth <= chatindex <= lastmessageid - minDepth` |

即单脚本等价写法(AND 用 `{{and::}}`,见 `cbs.ts:955` 附近):

```
{{#if {{and::
  {{greaterequal::{{chatindex}}::{{? {{lastmessageid}}-{{maxDepth}}}}}} ::
  {{lessequal::{{chatindex}}::{{? {{lastmessageid}}-{{minDepth}}}}}} }}
}}$&{{/if}}
```

示例对照(tavern 深度范围 → Risu 条件):
- `minDepth=11, maxDepth=50`(herebetween #9)→ `chatindex >= last-50 AND chatindex <= last-11`
- `minDepth=51`(#10)→ `chatindex <= last-51`
- `maxDepth=5`(#1/#3/#12)→ `chatindex >= last-5`

### 7.4 对既有结论的修正

- **§2 决策表**:深度过滤不再"只能触发器"——正则 OUT 条件块是更简单、更贴近原语义的落点;**触发器仍有价值**的场景只剩跨消息协同(需要读/改写多条历史)、注入、以及"正则一遍替换不到"的循环型操作。
- **上一轮"显示路径深度过滤触发器救不了"**:结论作废。editdisplay 时 `chatID = idx`(`ChatBody.svelte:249`),所以显示路径同样可用本技巧。
- **边界提醒**:
  - OUT 若不含 `$&` 且 `#if` 为假,整块被忽略 → 输出空 → 匹配内容被删除;为真则输出 `$&`。这正是"按新旧删/留"的开关。
  - `in` 需吞掉尾部换行(如 `[\s\S]*`),否则 `#if` 为假删除后留空行。
  - `{{chatindex}}` 在"无特定消息上下文"时返回 `-1`(如编辑模式/翻译路径未传 idx 的场合),条件会落到假分支,行为需实测。
  - 需要 `flag` 含 `<cbs>`(OUT 里用宏的前提,见 `scripts.ts:77`)。
