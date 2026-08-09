# round8: Risu 源码全量审计(本地源码 2026.6.215)

日期:2026-08-09
方法:完整拉取 kwaroran/RisuAI 本地源码,逐子系统核对转换器的每个结论。
结果:**8 处之前结论得到源码级证实,4 处发现错误并已修正**。

## 1. 已证实的结论(源码证据)

| 结论 | 证据 |
|---|---|
| 产物字段 ⊆ botPreset schema | `database.svelte.ts:1580` `botPreset` 接口:name/temperature/maxContext/maxResponse/frequencyPenalty/PresensePenalty/top_p/top_k/top_a/min_p/repetition_penalty/reasonEffort/promptTemplate/regex 全在 |
| name 字段合法且生态常用 | `prompt.ts` PromptItem 各类型均有 `name?`;两份真实 preset 大量使用 |
| postEverything hack = 官方做法 | `prompt.ts stChatConvert`:官方导入器同样生成 postEverything 卡 + `{{#if prefill_supported}}`;`assistantPrefill` 字段在 index.svelte.ts **无消费**(仅 templates 默认值/类型/存取) |
| Risu 无 setglobalvar | cbs.ts 全部 271 宏(含 alias)仅 setvar/addvar/setdefaultvar/getglobalvar;全局变量由 customPromptTemplateToggle 写 |
| reasonEffort 取值 0/1/2/3 | `botparams.ts` segmented:Minimal(-1)/Low(0)/Medium(1)/High(2)/XHigh(3);preset 字段 `reasonEffort`(`database.svelte.ts:2106`) |
| regex flag 白名单 = dgimsuvy | `scripts.ts` `flag.replace(/[^dgimsuvy]/g,'')`;`<order N>` 解析为降序排序(299-333);`<cbs>` 触发 risuChatParser;`<no_end_nl>` 抑制尾部补换行;`{{data}}`=完整匹配(`dreg`);`type='disabled'` 永不匹配 mode |
| 深度守卫可行 | `greaterequal` 返回 '1'/'0'(cbs.ts:927);解析器逐层收集 `{{}}`,内层宏先求值,`#if 1`→parse / `#if 0`→ignore(parser.svelte.ts:1676);`{{chatindex}}`=-1 表示无上下文 → 条件落假分支 |
| templateCheck 是软警告 | `templateCheck.ts` 返回 warnings 数组,不阻止导入;但缺 globalNote/main 会产生警告 |
| customPromptTemplateToggle | `util.ts:1049 parseToggleSyntax`(每行 key=value=type=option,group/divider);`Toggles.svelte` 值存 `toggle_<key>` 全局变量,select 值为索引字符串 |

## 2. 发现并已修正的错误

1. **缺 globalNote 卡**:templateCheck 要求恰 1 张 `type2==='globalNote'`,Risu 生态惯例都有;转换器从不生成 → 补一张空 globalNote 卡(`mapPrompts.ts`,消除警告)。
2. **A_DIRECT 含非 Risu 宏**:
   - `ge`/`le` 不存在(仅 `greaterequal`/`greater_equal`、`lessequal`/`less_equal`)→ 移除
   - `wi`/`wibefore`/`wiafter`/`wiinsert` 是 ST 世界书宏,Risu 无(lorebook 内容由 Risu 系统填充)→ 改为 B 类报告(kept + 说明),避免静默失效
   - `system`/`instruction` 不在 cbs 宏表 → 移除
   - `data` 保留(A 直通):regex 系统专用 token(`scripts.ts dreg`),非 cbs 宏但有效
3. **`setvar`/`addvar`/`setdefaultvar` 不是 A 直通**(round9):三者仅 `runVar=true` 执行(cbs.ts:816,832,851),prompt 卡渲染 `runVar=false` → 字面量残留、变量不写入。从 A_DIRECT 移出,改 manual 报告。vitest 实证详见 `round9-risu-chatvar-runtime.md`。

## 3. 观察(不修改,记录)

- **jailbreak 卡受 Risu 全局 jailbreakToggle 控制**(index.svelte.ts 746-748):ST 的 jailbreak prompt 转成 jailbreak 卡后,若用户未开 Risu 的 jailbreak 开关则不生效——使用层面提示,非转换 bug。
- **cot 卡受 chainOfThought 控制**(index.svelte.ts 749-751)。
- promptSettings 的 postEndInnerFormat/sendChatAsSystem/sendName 运行时消费(index.svelte.ts 729/805/878),assistantPrefill 不消费。
- `{{? }}` = `calcString`(infunctions.ts:143),支持 + - * / % ^ < > <= >= == != 与括号。
