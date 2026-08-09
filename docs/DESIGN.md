# Tavern → Risu 通用转换器:设计稿 v1

> **目标北极星:`docs/GOALS.md`(通用转换器——任意 ST preset,非特定 preset 专用)。本稿为实现它的设计。**

日期:2026-08-09
依据:round1-6 全部调研(`research/round*.md`)+ Risu 能力全景(`research/round6-risu-capabilities.md`)
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
