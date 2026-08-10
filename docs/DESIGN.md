# Tavern → Risu 通用转换器:设计稿 v1

> **目标北极星:`docs/GOALS.md`(通用转换器——任意 ST preset,非特定 preset 专用)。本稿为实现它的设计。**

日期:2026-08-09
依据:round1-9 全部调研(`research/round*.md`)+ Risu 能力全景(`research/round6-risu-capabilities.md`)+ 变量运行时门控实证(`research/round9-risu-chatvar-runtime.md`)
状态:设计定稿,可据此编码

---

## 1. 定位

把 SillyTavern OpenAI 系 preset(`.json`,含 `extensions.regex_scripts`)转换成 RisuAI `botPreset` 裸 JSON(可经 Risu `importPreset` 的 json 分支导入),同时产出**结构化差异报告**,让"丢了什么、降级了什么、需人工确认什么"一目了然。

### 1.1 范围(做)
- 顶层采样/上下文字段映射
- `prompts[]`+`prompt_order` → `promptTemplate`
- `extensions.regex_scripts` 13 字段 → `customscript[]`(核心)
- 宏翻译(表驱动)
- 深度过滤 → OUT `{{#if}}` 生成
- 差异报告

### 1.2 非目标(本轮不做,明确排除)
| 排除项 | 原因 |
|---|---|
| **群聊** | 用户明确暂缓;Risu 群聊行为差异大(群级 vs 成员级),单独开问题 |
| `edittrans` 翻译后处理 | 残废引擎,风险高收益低 |
| `.risup`/`.risupreset` 容器 | phase 2(配方已有) |
| 状态标记触发器 / 世界书 / 资产增强 | 可选扩展,设计预留接口,不在 v1 主链 |
| `substituteRegex=ESCAPED` | 静态转换不了,仅报告"需人工" |

---

## 2. 总体架构

**纯函数管线,库 + CLI 双入口。** 无框架依赖,Node >= 18。

```
输入: tavernPreset.json  ──────────────────────────────┐
                                                        ▼
parseST(json) ──► IR(stScript)                         
    ├─ mapFields()      ──► {risuFields, warnings[]}
    ├─ mapPrompts()     ──► {promptTemplate, warnings[]}
    ├─ mapRegexes()     ──► customscript[] (每个脚本 1..2 个)
    └─ mapMacros()      ──► 内嵌于以上各处,累积 warnings
                                                        ▼
compose(parts) ──► { preset: botPreset, report }
```

### 2.1 文件结构
```
converter/
  package.json          # type: module, bin: st2risu
  src/
    index.js            # 库入口: convert(tavernJson) → {preset, report}
    cli.js              # CLI: 输入文件 → 输出 .json + .report.json
    ir.js               # parseST 与 IR 类型(stScript/regexScript/promptDef)
    mapFields.js        # 顶层字段映射
    mapPrompts.js       # prompts → promptTemplate(复用官方映射表)
    mapRegexes.js       # 核心:13 字段 → customscript[]
    depthGuard.js       # minDepth/maxDepth → OUT {{#if}} 表达式
    macroTable.js       # 宏翻译表(数据驱动) + translateMacros()
    report.js           # 警告累积与报告组装
  test/
    fixtures/           # 三个真实 preset + 预期输出
    *.test.js
```

### 2.2 中间表示(IR)
```js
stScript = {
  name, findRegex, replaceString, trimStrings, placement[], // 1/2/3/5/6
  markdownOnly, promptOnly, runOnEdit, substituteRegex,     // 0/1/2
  minDepth, maxDepth, disabled,
}
// 每个 tavern 正则脚本映射为一个"分解结果":
decomposed = { targets: [ {type:'editinput'|'editprocess'|'editoutput'|'editdisplay', out, flag, actions[]} ], warnings[] }
```

---

## 3. 顶层字段映射(mapFields)

| Tavern | Risu | 规则 | 缺省时 |
|---|---|---|---|
| `temperature` | `temperature` | `×100` | `0.8×100` |
| `frequency_penalty` | `frequencyPenalty` | `×100` | `0.7×100` |
| `presence_penalty` | `PresensePenalty` | 存在→`×100`;缺失→`0`(避开官方 ×0.7/NaN bug,`database.svelte.ts:2402`;**决策 2026-08-09**) | — |
| `top_p`/`top_k`/`top_a`/`min_p`/`repetition_penalty` | 同名 | 直通(官方漏转,我们补) | 各默认 |
| `openai_max_context` | `maxContext` | 直通 | 官方默认 4000 |
| `openai_max_tokens` | `maxResponse` | 直通 | 官方默认 300 |
| `name` | `name` | 直通(修复官方硬编码) | — |
| `seed`/`n`/`stream_openai`/`squash_system_messages`/`max_context_unlocked`/`names_behavior`/`media_inlining` | — | **丢弃 + 报告 dropped** | — |
| `assistant_prefill` | 见 §4 | 官方模板 | — |
| `bias_preset_selected` | — | **报告 dropped**(本体在 openai_settings,拿不到) | `bias:[]` |
| 连接类(模型/URL/密钥) | `apiType`/`aiModel` | 白名单尽力映射,否则保留 Risu 默认 + 报告 | — |

报告条目:`{field, action:'dropped'|'mapped'|'manual', reason, suggestion}`。

---

## 4. prompts → promptTemplate(mapPrompts)

**复用官方映射表**(`database.svelte.ts:2411-2474`),策略:

| identifier | 生成卡 | 备注 |
|---|---|---|
| `main` | `{type:'plain', type2:'main', text, role:role??'system'}` | |
| `jailbreak`/`nsfw` | `{type:'jailbreak', ...}` | |
| `chatHistory` | `{type:'chat', rangeStart:0, rangeEnd:'end'}` | |
| `worldInfoBefore` | `{type:'lorebook'}` | |
| `charDescription` | `{type:'description'}` | `scenario_format`→`innerFormat`(官方漏) |
| `personaDescription` | `{type:'persona'}` | `personality_format`→`innerFormat` |
| `scenario` | **并入 `description` 卡**(文本合并进 innerFormat) | **决策 2026-08-09**:场景本质是描述,与 description 同类 |
| `dialogueExamples` | **降级 `plain` 卡**(type2 normal) | **决策 2026-08-09** |
| `charPersonality` | **降级 `plain` 卡**(type2 normal) | **决策 2026-08-09** |
| `worldInfoAfter` | **v1 降级 plain 卡放模板末尾;完整 `@@position pt_wiAfter` + `{{position::pt_wiAfter}}` 双槽位列入 M5**(需世界书条目装饰器,见 round6-risu-capabilities §2) | **决策 2026-08-09** |
| `enhanceDefinitions`/其他 | `{type:'plain', type2:'normal', text, role}` | 报告 degraded |
| `assistant_prefill` | postEverything 卡 + `{{#if {{prefill_supported}}}}` 模板(官方 `:2481-2491`) | |

- 顺序:仅驱动 `prompt_order[0].order`;`enabled=false` 跳过;找不到→`console.log` 式 warning。
- role 归一化:`assistant/char→bot`,非法→`system`(官方 `normalizePromptTemplate`)。

---

## 5. 正则脚本映射(mapRegexes)——核心

### 5.1 决策树(每个脚本 → 1..2 个 customscript)

```
若 disabled                      → 跳过,计数 dropped
placement 含 3/5/6(SLASH/WORLD_INFO/REASONING) → 分支处理:
    5 → 提示"改走世界书 useRegex"(v1 仅报告,不自动生成)
    3/6 → 报告 dropped
三分法:
  markdownOnly && !promptOnly  → type=editdisplay
  promptOnly  && !markdownOnly → type=editprocess     // 最贴近 script.js:4447 prompt 构建
  双开 M&&P                    → 拆 [editdisplay, editprocess] 两个脚本
  都 false(默认路径)           → type=editoutput      // cleanUpMessage 等价
placement 数组:
  含 USER_INPUT(1) 时,额外/改产出 type=editinput
  含 AI_OUTPUT(2) 时,产出 type=editoutput 或上述三分法结果
```

### 5.2 单目标脚本字段生成

| 项 | 规则 |
|---|---|
| `comment` | `[scriptName]`(可拼接功能描述) |
| `in` | `findRegex`:剥 `/pattern/flags` 形式,flag 合并到 flag 字段;Tavern 特有 flag(`X/A/J`)→ 报告并剔除;`substituteRegex=1` 时加 `<cbs>` |
| `out` | `replaceString`:字面 `{{match}}`→`{{data}}`(Risu 全匹配宏,等价);若以 `>` 结尾 → 去掉 `>` 并加 `<no_end_nl>`(`scripts.ts:163-165`) |
| `flag` | 合并正则 flag(`g/m/i/s/u`)+ `ableFlag=true` 时加 actions 标签 |
| `ableFlag` | 当存在任何 `<...>` 标签(含 `<cbs>`/`<order>`/深度)或非默认 flag 时 `true` |
| 顺序 | 数组内 index i → `<order {n-i}>` 思路:Tavern 先执行者给大 order(Risu 降序先执行),保持相对顺序 |
| `trimStrings` | **报告 degraded**,不自动处理 |
| `runOnEdit` | **报告 degraded** |

> 尾部 `>` 语义:`replaceString` 以 `>` 结尾时 Risu 会自动补 `\n`(Tavern 不会);转换器去掉尾部 `>` 并加 `<no_end_nl>` 保持原始"结尾无换行"语义。
| `substituteRegex=2` | **报告 manual**(运行时转义,静态不可转) |
| 深度 | 见 §6 |

### 5.3 深度过滤(depthGuard)

`minDepth/maxDepth`(存在任一非空时)在目标 out 上包一层 `{{#if}}`:

```
深度范围 [min, max](默认 min=0, max=∞)
条件 = AND( GE(chatindex, lastmessageid-max), LE(chatindex, lastmessageid-min) )
     = {{#if {{and::{{greaterequal::{{chatindex}}::{{? {{lastmessageid}}-{max}}}}}}::{{lessequal::{{chatindex}}::{{? {{lastmessageid}}-{min}}}}}}}}...{{/if}}

out 拼接 = 条件前缀 + 原 out(通常为 $&)+ 条件后缀
flag += <cbs>(chatindex/lastmessageid 是宏,需展开;ableFlag=true)
in 需吞掉尾部换行(如 findRegex 末尾补 [\s\S]*),避免删除后留空行
```

证据:`cbs.ts:416,738,927`、`parser.svelte.ts:1152-1161`、`scripts.ts:248,291`;公式推导见 `research/round5-tradeoff-alternatives.md` §7。

边界(写入报告的 manual):`{{chatindex}}` 在无消息上下文返回 `-1`(编辑/翻译路径),条件落假分支。**决策 2026-08-09:不写兜底,仅报告提示**(正常聊天路径不受影响,避免为边缘场景增加复杂度)。

### 5.4 宏翻译(mapMacros,表驱动)

对 **findRegex(需 `<cbs>` 时)与 replaceString、prompt 文本**分别过 `translateMacros(text)`:
- 查 `macroTable.js` 四类:A 直通 / B 改写(替换为 Risu 等价)/ C 翻译(映射建议)/ D 未知(原样保留)。
- **写变量宏例外(round9)**:`setvar`/`addvar`/`setdefaultvar` 归 **manual 报告**——Risu 中仅 `runVar=true` 执行(cbs.ts:816,832,851),prompt 卡渲染 `runVar=false` 字面量残留、变量不写入;提示用触发器 effect / 消息重处理 / `customPromptTemplateToggle` 迁移。`getvar`/`getglobalvar` 读取处处有效,保持 A 直通。
- 输出统一小写无分隔形式(Risu 宏名规范化保证命中,`parser.svelte.ts:1055`)。
- 每次改写累积 `warnings.macros[]`(尤其 B/C 类)。

完整表见 `research/round6-converter-spec.md` §6。表结构:`{ tavern, risu, action, note }[]`,data-driven。

---

## 6. 差异报告(report.js)

> 本节已过时,以 `research/round6-converter-spec.md` §7 为准。实际 schema(schema 漂移修正,代码与 round6 §7 一致):

```jsonc
{
  "source": "文件名",
  "summary": { "converted": n, "dropped": n, "degraded": n, "manual": n },   // 无 regexScripts 子对象
  "sections": {
    "topLevel": [ { "field", "action": "dropped|degraded|manual", "reason", "suggestion?" } ],
    "regex": [ { "scriptName", "type?", "action": "converted|dropped|degraded|manual", "fields"?, "reason", "suggestion?" } ],
    "prompts": [ { "identifier", "action", "reason" } ],
    "macros": [ { "macro", "action", "reason" } ]
  }
}
```
- 报告**强制生成**,随转换产物一起落盘(`.report.json`)。
- 所有 `manual` 类条目必须有 `suggestion`(给用户下一步动作)。

---

## 7. 边界与行为漂移(预期差异,写入报告而非隐藏)

| 预期差异 | 说明 | 缓解 |
|---|---|---|
| 双开脚本变两个 | 数量翻倍,各自可单独调整 | 报告 split |
| 深度过滤在"无消息上下文"失效 | `{{chatindex}}=-1` | 报告 manual 提示 |
| 执行顺序近似 | Risu `presetRegex→char→模块` vs Tavern 三作用域 | `<order>` 尽量保相对序;跨作用域顺序**无法保证**,报告提示 |
| 群聊 | 本轮不做 | — |
| 世界书内容不过正则 | WORLD_INFO 型正则迁移语义变化 | 报告+建议改世界书 |

---

## 8. 里程碑

| M | 内容 | 验收 |
|---|---|---|
| M1 | 骨架:IR/parseST/mapFields/mapPrompts/report;CLI | 三份 preset 顶层+prompt 转换通过,报告正确 |
| M2 | mapRegexes 决策树 + out/flag 生成(不含深度) | 三份 preset 全部正则→customscript 数量/类型符合 §5.1 |
| M3 | depthGuard + 宏翻译 + substituteRegex | 深度表达式正确(人工抽检);宏改写符合四类表 |
| M4 | 测试夹具 + 断言(纯函数单测) | 对三个 fixture 全绿;报告 schema 稳定 |
| M5 | 可选:状态标记触发器 / 世界书 / 资产增强 / .risup | 按需 |

## 9. 测试策略

- **单测**:depthGuard 表达式(多组 min/max 边界)、决策树(placement×三分法组合)、宏表(每行)、报告 schema。
- **集成**:三份真实 preset(`此间小镇/可待/梦鲸`)→ 转换 → 人工核对差异报告。
- **不改代码**:产出物只读验证。

## 10. 决策记录(2026-08-09 定稿)

| # | 问题 | 决策 |
|---|---|---|
| 1 | `presence_penalty` | 存在→`×100`,缺失→`0`;不复刻官方 bug |
| 2 | `scenario` | 并入 `description` 卡(innerFormat) |
| 2 | `charPersonality` / `dialogueExamples` | 降级 `plain` 卡 |
| 2 | `worldInfoAfter` | v1 降级 plain(模板末尾);`@@position pt_wiAfter` 双槽位列入 M5 |
| 3 | 深度 `<cbs>` 与 `in` 宏 | 实现时用单测验证 `scripts.ts:176-179` 语义(编码期确认,非设计决策) |
| 4 | `{{chatindex}}=-1` 兜底 | 不加兜底,仅报告 manual |

## 11. 变更记录(实现期决策,2026-08-09)

| # | 变更 | 说明 |
|---|---|---|
| 1 | 全项目 TS 化 | src/test 用 TypeScript;`tsc -p tsconfig.build.json` 编译到 `dist/`(src+test);`bin`→`dist/src/cli.js`;`engines.node≥21`(test glob 需要) |
| 2 | `assistant_prefill` 模板形态修正 | 官方模板:prefill 挂 `postEverything` 卡的 `innerFormat`,`role2:'bot'`;不再另生 `type2:'main'` 卡(模板必须恰一张 main) |
| 3 | `scenario_format` 消费 | description 卡 innerFormat 经 `scenario_format` 包装(`{{scenario}}`→内容);`wi_format` 非默认→manual |
| 4 | `charDescription` 自定义内容 | `≠ {{description}}` 时并入 innerFormat 前缀(degraded 报告),与 scenario 合并顺序无关 |
| 5 | 顶层范围决策(SCOPE) | 行为字符串 / 思考参数 → manual;平台开关 → dropped;extensions 插件子键 → manual;正则 `id` → dropped(汇总) |
| 6 | 报告动作修正 | `trimStrings`/`runOnEdit` 用 `degraded`(脚本主体仍转换),修正 §5.2 |
| 7 | `{{match}}` → `{{data}}` | 正则 replaceString 中精确 token 翻译(Risu 仅自动映射 `{{data}}`→`$&`) |
| 8 | 换行语义明确 | replaceString 尾部 `>` → 去掉 + flag `<no_end_nl>`(ST 无换行标记,Risu 等价标签) |
| 9 | 报告 schema 定稿 | 以 round6-converter-spec §7 为准(嵌套 `sections` + `summary`),§6 已同步 |
| 10 | **深度过滤实现(M3)** | `minDepth/maxDepth` → OUT `{{#if}}` 守卫(round5 §7):`chatindex ∈ [last-max, last-min]`,`and::GE::LE`(GE 在前),`{{? {{lastmessageid}}-N}}` 算术宏;门控 `min>0 \|\| max≠null`(ST 无过滤序列化 `minDepth:0/maxDepth:null` 不触发);flag 加 `<cbs>`;in 吞尾换行(`[\s\S]*`,剥行尾 `$`,幂等);`{{chatindex}}=-1` 边界报 degraded 不写兜底 |
| 11 | **宏翻译表实现(M3)** | `macroTable.ts` 四类:A 直通 / B 同名不同义(kept 报告)/ C 翻译(kept→rewritten)/ D 未知(kept-unknown);`{{random a,b}}` 空格语法→`::`;`{{setglobalvar}}` 无 Risu 等价→manual(全局变量仅触发器/UI 可写);应用于卡 text/innerFormat 与正则 out(/需 `<cbs>` 时的 in) |
| 12 | 宏名规范化 | A 集合存规范化形式(小写+删 `_`/`-`/空格,Risu parser.svelte.ts:1055),`prefill_supported`→`prefillsupported` 才命中 |
| 13 | **setvar 非 A 直通(round9 修正)** | `setvar`/`addvar`/`setdefaultvar` 仅 `runVar=true` 执行(cbs.ts:816,832,851);prompt 卡渲染 `runVar=false` → 字面量残留、变量不写入。从 A_DIRECT 移出 → **manual 报告**(同 `setglobalvar`);报告 reason 提示用触发器 effect / 消息重处理 / `customPromptTemplateToggle` 迁移。`getvar`/`getglobalvar` 保持 A 直通。详见 `research/round9-risu-chatvar-runtime.md` |
| 14 | **setvar → start 触发器(round10)** | `setvar`/`addvar`/`incvar`/`decvar` 不再仅报告,改由 `mapTriggers.ts` 提取为 **start 触发器 setvar effect**,并从卡文本剔除宏(避免 runVar=false 字面量残留)。依据:ST variables.js:232-246(setvar 每次 prompt 构建执行);Risu `runTrigger('start')` 每次 `sendChat()` 构建 prompt 前执行(index.svelte.ts:888)、`case 'setvar'` 静默写 `chat.scriptstate`(triggers.ts:1334)。**否决 `request`**:其以 `displayMode=true` 运行,setvar 只写 tempVars 不落盘。映射:setvar→`=`、addvar→`+=`、incvar→`+=1`、decvar→`-=1`。输出:CLI 额外写 `<base>.module.json`(`{type:'risuModule', name, description, id, trigger}`,Risu 模块导入 schema `modules.ts:283`),需在"模块"页启用;`convert()` 返回 `{preset, module, report}`。报告:macros 动作 `converted`。测试:`test/m4.test.ts` |
| 15 | **变量卡组 → customPromptTemplateToggle(round11)** | ST 的"开关卡"本质是**候选卡组 + prompt_order enabled 快照**:多张卡 `{{setvar::X::内容}}` 写同一变量 X,用户启用其一,消费点 `{{getvar::X}}` 插入当前启用卡的内容。`mapToggles.ts` 把每个变量组 → **select**(`key=label=select=选项1,...`,Risu schema `util.ts:1049 parseToggleSyntax`),**保留全部候选选项**;消费点 `{{getvar::X}}` → N 个 `{{#if {{? {{getglobalvar::toggle_X}}==i}}}}` 分支注入各选项内容,默认项(当前 enabled 卡)用 `{{or::...==N::...==null}}` 兜底(calcString `.replace(/null/gi,'0')` 使未选命中默认)。产物:写入 `preset.customPromptTemplateToggle`(importPreset 保留)+ `report.sections.toggles`(converted)。**触发器协调**:toggle 化变量从 start 触发器 effect 排除(否则每次重置覆盖选择);全空初始化变量仍走触发器。**平衡解析 `setvarParse.ts`**:值含嵌套宏(如 `{{user}}`/`{{#if}}`)的 setvar 用深度计数扫描(跳过配对 `{{...}}` 到未嵌套 `}}`),修复简单正则 `[^{}]*` 漏转(V18 实测 19 张卡因此漏转)。label/选项剔除 `=`/`,`(parseToggleSyntax split 分隔符)与 emoji。测试:`test/m5.test.ts` |
| 16 | **行为字符串转译定稿(round12)** | Risu 的时机型提示词全部硬编码、无 botPreset 字段(`index.svelte.ts:1227` 续写、`:489` 群聊 nudge、`:839` 新对话)。定稿规则:`continue_postfix` → `promptSettings.postEndInnerFormat`(degraded:每次生成追加非仅续写);`assistant_prefill` → 官方 stChatConvert 同款 postEverything 卡 + `{{#if {{prefill_supported}}}}`(prompt.ts:680,mapPrompts 已实现,宏也过翻译);`continue_nudge_prompt`/`impersonation_prompt`/`continue_prefill` 有值时 manual(具体理由:续写提示硬编码、无"非真名"检测用户名恒 getUserName、assistantPrefill 为休眠字段);`new_chat/new_group_chat/new_example_chat/group_nudge/send_if_empty` 空值忽略不报噪音。`send_if_empty` 仅 `useSayNothing` 单模式存在(DefaultChatScreen.svelte:171)。测试:`test/m1.test.ts` |
| 17 | **通用性审计与修复(round13)** | 审计 src 全部模块对 ST 结构形态的 40 项隐性假设(子代理),修复高/中危项:**空 findRegex 禁止输出** `in:''`(Risu 空 pattern 匹配一切文本 → 丢弃 + manual);**placement 字符串数组/字符串形态**(`"1,2"`/`["1","2"]`)规范化;`substituteRegex` 字符串形态(`"1"`/`"2"`/`"true"`)统一 normalizeSubRegex;content 非字符串(`asString` 助手,移入 `src/util.ts` 避免循环依赖)防 `.trim()`/`.indexOf()` 崩溃;**chatHistory/worldInfoBefore 自定义 content 报告 degraded**(不静默丢);**未知 identifier 卡报告 converted**(不静默降级);`num()` 拒绝数组/布尔/空白串(宽松强转陷阱)。撤销 macroTable 嵌套宏检测(与既有设计冲突:setvar 嵌套已由 round10 前置提取、自生成守卫含嵌套,检测误报且难区分来源)。**通用验证**:新增 `test/fixtures/variation-st.json`(合成变异预设:类型变异/数字 content/缺失引用/正则形态变异/嵌套宏 toggle)+ `test/m6.test.ts` 15 条不变量测试(不崩溃/不静默丢/summary 一致性)。测试:`test/m6.test.ts` |
| 18 | **产物校验器(round14)** | `src/validate.ts`:三层校验转换产物能否被 Risu 正常消费。①**结构校验**:卡类型合法(Risu PromptItem 白名单)、plain/jailbreak/cot 必须带 type2 与 role、regex 非 disabled 必须有 in(空 in 匹配一切)、toggle 行可解析(复刻 util.ts:1049 parseToggleSyntax 成功判定)、toggle key 不含 `=`/`,`;②**templateCheck 复刻**:复现 Risu templateCheck.ts 的 8 条警告(main 恰 1 / globalNote 恰 1 / description / lorebook / chat-end / chat 范围连续);③**一致性**:消费点 `{{getglobalvar::toggle_X}}` 引用的 X 必须在 toggle 定义存在(TOGGLE_REF_UNDEFINED)。`validateModule` 校验触发器 type/effect。CLI 转换后自动跑 `validateAll`,error 级置退出码 1、warning/info 打印不阻塞。**同时修正 round11 过度转换**:单选项组(仅 1 个有效候选)不进 toggle —— 单选项下拉无切换意义,且会因 filterSetvarsForTrigger 排除出触发器导致变量值丢失;改走触发器路径(值由 scriptstate 提供,消费点 `{{getvar::X}}` 保持原样)。多候选组才转 toggle。测试:`test/m7.test.ts` 12 条 |
| 19 | **MCP server(round15)** | `src/mcp.ts`:stdio MCP server 封装现有 convert/validate 核心。工具:①`convert_preset`(ST 预设 → preset + module + report summary,含 manual/degraded 明细);②`validate_preset`(产物校验);③`convert_and_validate`(一步到位,推荐)。均返回 `content`(文本)+ `structuredContent`(结构化对象),错误返回 `isError`。依赖:`@modelcontextprotocol/server@2.0.0`(拆包:核心 + `/stdio` 子路径)+ `zod/v4`(注册 tool 的 inputSchema)。bin `st2risu-mcp`,npm script `mcp`。文档:`docs/MCP.md`(opencode/Claude Code 配置示例)。测试:`test/m8.test.ts` 4 条(子进程 spawn + JSON-RPC 握手 + tools/call 断言)。125 测试全绿 |
| 20 | **verbosity 映射 + 覆盖度修正(round16)** | 全量覆盖度审计(81 个 Risu botPreset 字段,子代理):A 已处理 19 / B 可映射未做 5 / C 无 ST 对应 54 / D 排除 3。修正此前"54 项无需处理"的误导——该数字混了两种判断:约 50 项是 ST 导出机制保证不存在的(连接字段 `isConnection=true` 默认剔除,openai.js:4775/4925),但 `verbosity` 等是 **ST 确有且每预设必现** 的字段,此前漏转。补:`verbosity` ST `auto/low/medium/high`(openai.js:246)→ Risu `0/1/2`(botSettingsParamsData.ts:295),auto 无 Risu 等价映射 medium=1;同时 `tool_call_recurse_limit`/`request_image_aspect_ratio`/`request_image_resolution` 从"未知字段 manual"改为"Risu 无等价 dropped"。剩余 B 类:instruct 三件套(useInstructPrompt/instructChatTemplate/JinjaTemplate,需 ST 第二输入文件)、moduleIntergration(自洽增强)。测试:`test/m1.test.ts` + m6 断言更新 |
| 21 | **instruct 模式转换(round17)** | `src/mapInstruct.ts`:ST instruct preset(独立第二输入 `--instruct <file>`,或主预设顶层 `instruct` 块)→ Risu 三件套(`useInstructPrompt=true` + `instructChatTemplate='jinja'` + `JinjaTemplate`)。算法以官方转换器 `prompt.ts:453-484` 为蓝本:for-message 循环按 role 分支逐字直插 ST 序列。**两处修复官方缺陷**:①assistant 前缀用 Jinja `loop.first`/`loop.last` 区分 `first_output_sequence`/`last_output_sequence`(官方全丢弃;ST Libra-32B 主分隔符 `\n### Response:` 就在 last_output_sequence);②story_string 预处理 `{{user}}`→`{{risu_user}}`、`{{system}}`→system_prompt 字面量用 NUL 占位符避开残留花括号清理(官方会误删 risu_user 与 system 文本)。`story_string_prefix`/`suffix` 附着 story_string 段落(仿 instruct-mode.js:490,`{{name}}`→System)。instruct 与触发器/promptTemplate 正交:instruct 只接管 prompt 渲染,变量卡与 setvar 触发器不受影响。CLI `--instruct` 参数 + MCP 两工具 `instruct_json` 可选入参。测试:`test/m9.test.ts` 10 条(role 分支/loop.first-last/system_same_as_user/story_string 预处理/顶层块识别/无 instruct 缺省) |
| 22 | **孤立 disabled 卡 → 默认关闭开关(round18)** | `src/mapDisabledToggles.ts`。问题:ST 的 disabled prompt(无 setvar 变量,如破限示例/提示卡/教程卡)此前被 mapPrompts 丢弃——但 **Risu prompt 卡没有 enabled 字段**(PromptItem 无 ableFlag,只有 customscript 有),无法"保留内容但默认不注入",用户无法再开关使用。方案:每张孤立 disabled 卡 → 一行 toggle(select 两选项 `关闭`/`开启`,默认索引 0)+ 一张守卫卡(type=plain/type2=normal,text 为每卡 `{{#if {{? {{getglobalvar::toggle_sw_X}}==1}}}}<内容>{{/if}}` 拼接)。默认(未选 null / 选 0)注入空,用户开开关(选 1)才注入。**排除含 `{{setvar::` 宏的卡**(变量组候选归 mapToggles,避免重复注入)。guard 卡 push 到 promptTemplate 末尾。实测 V18:52 个 disabled 卡 → 52 开关,守卫卡无 setvar 泄漏。测试:`test/m10.test.ts` 4 条 |
