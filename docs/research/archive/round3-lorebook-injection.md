# Risu vs SillyTavern 世界书/注入系统对比 — 第 3 轮调研

日期:2026-08-09
范围:世界书(Lorebook / World Info)系统、提示词注入系统,以及它们与正则脚本、宏的联动
方法:两路子代理并行源码调研(Risu: `rius/risuai-src`,Tavern: `SillyTavern/SillyTavern-src`)
原始报告:见 `round3-risu-lorebook-injection.md`、`round3-tavern-worldinfo-injection.md`

---

## 1. 世界书数据结构对比

| 方面 | RisuAI `loreBook` | SillyTavern `WorldInfoEntry` |
|---|---|---|
| 关键词 | `key`(逗号分隔字符串)、`secondkey` | `key[]`、`keysecondary[]`(数组) |
| 常驻激活 | `alwaysActive` | `constant`、`sticky`(更强:吸附激活) |
| 次级关键词逻辑 | `selective` 布尔 | `selectiveLogic` 枚举(AND_ANY / NOT_ALL / NOT_ANY / AND_ALL) |
| 正则匹配 | **`useRegex` 布尔开关**,关键词格式 `/regex/flags` | **无 useRegex 字段**,以 `/regex/flags` 字符串隐式启用(`parseRegexFromString`,world-info.js:2821) |
| 位置 | 由内容 `<tag>` 装饰器决定(`<position>`/`<depth>`/`<inject_*>` 等) | `position` 字段枚举(before/after/ANTop/ANBottom/atDepth/EMTop/EMBottom/outlet) |
| 深度 | `<depth n>` 装饰器 | `depth` 字段(默认 4) |
| 优先级/顺序 | `insertorder`(同时充优先级与顺序) | `order`(默认 100,越大越靠前)+ 激活顺序 |
| 概率 | `activationPercent` | `probability` + `useProbability` |
| 附加条件 | 内容装饰器 `<activate_only_after>`/`<is_greeting>`/`<forceState>` | 字段:triggers / characterFilter / delay / cooldown / delayUntilRecursion / excludeRecursion / preventRecursion / matchXxx |
| 禁用 | 无独立开关(靠关键词为空 + 非 alwaysActive) | `disable` 布尔 |
| 扫描深度设置 | `loreSettings.scanDepth`(默认 5) | `scanDepth`/`world_info_depth`(默认 2) |
| token 预算 | `loreSettings.tokenBudget`(默认 800 token,绝对值) | `world_info_budget`(默认 25% of maxContext)+ cap |
| 唯一 id | `id`(可选) | `uid`(必填,世界书文件以 uid 为键) |
| 输出(Outlet) | — | `outletName` + `{{outlet::名}}` |

**结论**:Tavern 世界书字段明显更丰富(激活链复杂:sticky/cooldown/characterFilter/group/outlet 等);Risu 用"内容装饰器"承载位置/深度/附加条件,更贴近"角色卡内嵌指令"风格。正则匹配双方都支持,Risu 用开关显式声明,Tavern 用 `/pattern/` 隐式识别。

---

## 2. 扫描/激活逻辑对比

| 步骤 | RisuAI | SillyTavern |
|---|---|---|
| 扫描对象 | 最近 `searchDepth` 条消息,构造 `{source,prompt,data}`,用户/角色加名字前缀 | 倒序 `coreChat`(最新在前),可带名字,深度 = `world_info_depth + skew` |
| 正则匹配 | `useRegex=true` 时对每条消息 `data` 做 `regex.test()`,大小写敏感除非 `i` | 关键词以 `/.../` 开头则 `keyRegex.test(haystack)`,**正则优先于 caseSensitive/wholeWord** |
| 字符串匹配 | 去空格子串 `includes`;`fullWordMatching` 时全词相等 | `caseSensitive ?? 全局` 控制大小写;`matchWholeWords` 用 `\W` 边界正则 |
| 关键词宏 | **不展开宏**(原始字符串匹配) | **先 `substituteParams(key)` 再匹配**(`{{char}}` 可作关键词) |
| 扫描内容附加源 | 仅聊天历史 | 历史 + `matchXxx` 角色字段 + **extension 注入缓冲**(AN/memory 若 `allowWIScan`)+ 递归缓冲 |
| 递归扫描 | `recursiveScanning` + `<recursive>` 装饰器,while 循环直至无新条目 | `world_info_recursive` + `preventRecursion`/`excludeRecursion`,`scan_state.RECURSION`,`max_recursion_steps` 限制 |
| 概率 | `activationPercent` | `verifyProbability`(`Math.random()*100 <= probability`) |
| 常驻 | `alwaysActive` 跳过关键词 | `constant`/`sticky` |
| 预算裁剪 | `actives.sort(priority desc)` → 按 token 累加 <= budget → 段落内 `order desc` | 排序后逐条入预算,`ignoreBudget` 可豁免 |
| 强制激活/禁用 | 装饰器 `<forceState>` / `<activate_only_after>` | 内容装饰符 `@@activate` / `@@dont_activate` |

**结论**:扫描骨架相似(深度窗口 + 递归 + 预算),但 Tavern 在匹配前对关键词做宏替换、支持扩展注入缓冲;Risu 匹配的是"已展开宏"的历史消息而关键词本身不展开。Risu 无 characterFilter/group/outlet/cooldown 等高级激活条件。

---

## 3. 插入位置与深度对比

| 位置语义 | RisuAI | SillyTavern |
|---|---|---|
| 角色卡前/后 | `<position after_desc/before_desc>` → 落到 description 段 | `before`(0)/`after`(1) → `worldInfoBefore/After` → 故事串或 OAI 系统提示 |
| 指定深度插入 | `<depth n>` / `<reverse_depth n>` → `splice` 进 `chats` 数组 | `atDepth`(4) + `depth` 字段 → `CUSTOM_WI_DEPTH` 扩展提示 → `doChatInject` 插层(带 role) |
| 示例对话位置 | —(示例与历史同段) | `EMTop`/`EMBottom`(5/6) → 插入 `mesExamplesArray` |
| 作者注附近 | —(无 AN 系统,Risu 用"作者便签 authorNote"段落) | `ANTop`(2)/`ANBottom`(3) → 合并进 AN 再注入 |
| 整体前后端 | `<end>` → `postEverything` 末尾;`<position pt_xxx>` 模板锚点 | 默认 `lorebook` 段落 / 故事串引用 |
| 命名出口 | — | `outlet`(7) + `{{outlet::名}}` 按需内联 |
| 模板动态位置 | `{{position::xxx}}` 宏(支持 5 层嵌套) | 故事串 + `{{wiBefore}}/{{wiAfter}}` 参数 |

**结论**:两者都支持"角色卡前后 + 指定深度"两大类插入;Risu 更依赖模板卡片的 `{{position::}}` 与内容装饰器,Tavern 用结构化 position 枚举 + 统一的扩展提示注入管线(`doChatInject` / OAI PromptManager)。

---

## 4. 世界书内容:宏与正则的先后次序(关键差异)

| 处理项 | RisuAI | SillyTavern |
|---|---|---|
| 宏展开时机 | 扫描期(仅用于 token 计数,`runVar=false`)+ **落位期**(`risuChatParser(resolvePosition(content))`) | **匹配通过后一次性** `substituteParams(entry.content)`(用于预算/递归/后续正则,world-info.js:4939) |
| 正则处理 | **世界书内容不进正则脚本**(只走宏) | **每条已激活内容过 `getRegexedString(WORLD_INFO)`**(world-info.js:5086,`isPrompt:true`) |
| 正则能否改内容 | 否 | 能(可改写甚至删除条目) |
| 顺序 | 宏(落位) | **先宏后正则**,正则 replace 末尾还会再宏替换一次 |
| 历史消息 | 扫描前先 `risuChatParser(runVar=true)`,正则脚本(editprocess)**晚于扫描** | 消息级正则(USER_INPUT/AI_OUTPUT)**早于** WI 扫描 |

**结论(第 3 轮核心)**:**
- Risu:世界书扫描在 editprocess 正则脚本之前;世界书内容只被 CBS 宏处理,正则脚本不触碰世界书;正则脚本只作用于开场白/历史/输入/输出/显示。
- Tavern:消息正则先于 WI 扫描;世界书内容 = 宏替换 → WORLD_INFO 正则,正则脚本可改写世界书。
方向几乎相反:**Risu 的正则管"数据流"(消息),Tavern 的正则管"数据流 + 世界书内容"**。

---

## 5. 注入系统对比

| 方面 | RisuAI | SillyTavern |
|---|---|---|
| 主机制 | **触发器系统**(triggers.ts):`start/input/output/display/request/manual` 六模式 | **统一扩展提示槽**(`setExtensionPrompt`):IN_PROMPT(0)/IN_CHAT(1)/BEFORE_PROMPT(2) + depth + role |
| 注入锚点 | `additonalSysPrompt[location]`:`start`/`historyend`/`promptend` | extension_prompts 槽位 + `doChatInject` 插层(TC)/`populationInjectionPrompts`(OAI) |
| 作者注 | `authorNote` 段落(简单) | `authors-note.js`(间隔/深度/位置/role + `allowWIScan` 参与扫描 + `{{authorsNote}}` 宏) |
| Jailbreak/Instruct | `jailbreak` 段落 + Instruct 模板 | jailbreak/system 经 `baseChatReplace`;Instruct 前缀宏(`formatInstructModeChat`) |
| 发送前改写 | `runTrigger('request')` 对 JSON 化 prompt 改写 + 插件 `replacerbeforeRequest` | OAI PromptManager + STscript 管道;TC 无 request 级钩子(靠 `/commands` 前处理) |
| 正则能力 | 触发器条件 `exists` 支持 regex;`v2RegexTest`/`v2ReplaceString`/`v2ExtractRegex` | 扩展提示本身**不经过正则**(仅 WI 内容在 world-info.js:5086 过正则) |
| 宏能力 | 触发器条件/效果值先 `risuChatParser` | 扩展提示读取时 `substituteParams` |
| 可读写世界书 | 触发器 `v2ModifyLorebook` 等 V2 效果 | extension 通过 `SillyTavern.getContext().extensionPrompts` / WI API |

**结论**:Risu 的注入以"触发器 = 主动脚本"为主,自带正则/宏/读写世界书能力,是功能最强的注入层;Tavern 以"被动槽位 + 宏替换"为主,结构化(位置/深度/角色)但本身不过正则,正则脚本唯一进入世界书的通道是 WORLD_INFO placement。

---

## 6. 最终 Prompt 组装顺序对比

### RisuAI(formatOrder,index.svelte.ts:1464)
```
main → description(含 before/after_desc 世界书) → personaPrompt
→ chats(示例 + 开场白 + 历史 + depth 世界书 spliced,逐条 editprocess)
→ lastChat(含触发器 start/historyend 注入)
→ jailbreak → lorebook(常规激活条目) → globalNote → authorNote
→ postEverything(CoT/群聊消息/深度0世界书/触发器 promptend)
之后:角色 depth_prompt → Lua editRequest → token 裁剪 → request 触发器注入 → 发送
```

### SillyTavern Text Completion(script.js:5133)
```
combinedStoryString(Handlebars+宏;system/desc/personality/scenario/persona + 可选 wiBefore/After)
+ mesExmString(示例对话,WI EM 条目插入)
+ mesSendString(历史,已过 USER_INPUT/AI_OUTPUT 正则;in-chat 注入 doChatInject;jailbreak 消息)
+ generatedPromptCache(continue/cycle)
之后:modifyLastPromptLine → 裁剪至 maxContext → 发送
```

### SillyTavern Chat Completion(openai.js:1358)
```
PromptManager 排序(main → worldInfoBefore → worldInfoAfter → charDescription → charPersonality → scenario → ... → jailbreak)
每条 preparePrompt(宏替换;WI/AN 正则已在 5086 完成)
populateChatCompletion(system 合并 + in-chat 注入 + 示例 + 历史) → squashSystemMessages → 发送
```

---

## 7. 核心差异总结(正则 × 宏 × 世界书/注入)

1. **正则与世界的接触面**:
   - Risu:世界书"只读"宏,正则脚本不作用世界书;世界书扫描先于 editprocess 正则。
   - Tavern:世界书内容"先宏后正则"(WORLD_INFO placement),正则可改写/删除条目;消息正则先于扫描。

2. **宏与关键词**:
   - Risu:关键词不展开宏,扫描对象(历史)先展开宏。
   - Tavern:关键词先做宏替换;内容匹配后宏替换一次,正则后还会再宏替换。

3. **注入架构**:
   - Risu:触发器 = 主动可编程(六模式 + 正则 + 宏 + 世界书读写 + request JSON 改写)。
   - Tavern:extension_prompts = 被动结构化(位置/深度/角色),扩展提示只宏不正则;正则唯一入口是世界书 WORLD_INFO。

4. **作者注/便签**:
   - Risu:`authorNote`/`globalNote` 固定段落;Tavern:AN 是完整注入子系统(间隔/深度/role + 世界书合并)。

5. **适用场景**:
   - Risu 适合"在正则脚本里不动世界书、用触发器做动态注入、用模板卡片定位"。
   - Tavern 适合"用正则脚本清洗/改写世界书内容、用 AN + in-chat 深度做定时注入、用 outlet 按需取用"。

---

## 8. 一句话总结

> **Risu 世界书/注入 = 装饰器驱动(内容内嵌 `<tag>`)+ 触发器主动编程(六模式、可读写世界书)+ 世界书"只读宏不过正则"**;
> **Tavern 世界书/注入 = 结构化字段驱动(rich 激活链 + 8 种 position)+ 统一被动槽位(extension_prompts + doChatInject)+ 世界书"先宏后正则、正则可改写"**。
> 正则管什么: Risu 管消息数据流,世界书绝缘;Tavern 管消息 + 世界书两层。
