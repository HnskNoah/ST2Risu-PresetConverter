# round12: ST 行为字符串 → Risu 转译定稿

日期:2026-08-09
结论:Risu 的"时机型提示词"(续写/冒充/新对话等)全部**硬编码**,无 botPreset 字段。转译策略 = 有近似等价才转(2 项),语义无等价则 manual 带具体理由(3 项),空值忽略(5 项)。

## 1. 核心发现(源码证据)

Risu `sendChat()` 中这些提示词全是硬编码字符串,不可配置:

| 时机 | 硬编码文本 | 位置 |
|---|---|---|
| 续写 | `[Continue the last response]` | index.svelte.ts:1227-1233(postEverything 槽位) |
| 新对话 | `[Start a new chat]` | index.svelte.ts:839-845 |
| 群聊角色续写 | `` `[Write the next reply only as ${name}]` `` | index.svelte.ts:489-495 |
| 示例新对话 | `[Start a new chat]`(memo NewChatExample) | exampleMessages.ts:25-33 |

无任何 botPreset 字段可覆盖这些文本。

## 2. 逐字段决策

| ST 字段 | 决策 | 承载 | 理由 |
|---|---|---|---|
| `continue_postfix` | ✅ degraded | `promptSettings.postEndInnerFormat`(prompt.ts:11) | 每次生成追加,ST 仅续写追加 → 近似,报 degraded |
| `assistant_prefill` | ✅ converted | postEverything 卡 + `{{#if {{prefill_supported}}}}` bot 卡 | 官方 `stChatConvert`(prompt.ts:680-690)同款模式;Risu 无 native 字段 |
| `continue_nudge_prompt` | ⚠️ manual | — | 续写提示硬编码 index.svelte.ts:1227,自定义不生效 |
| `impersonation_prompt` | ⚠️ manual | — | 用户名恒为 `getUserName()`(index.svelte.ts:914),无"非真名"检测;systemprompt trigger 会无条件注入,语义错 |
| `continue_prefill` | ⚠️ manual | — | Risu 续写自动用上一条 assistant 内容作 prefix(index.svelte.ts:1595/1807);`assistantPrefill` 为休眠字段(prompt.ts:10,无读取点) |
| `new_chat_prompt` | ✅ 忽略 | — | ST 默认空;Risu 新对话提示硬编码且可被 `promptSettings.trimStartNewChat` 关闭 |
| `new_group_chat_prompt` | ✅ 忽略 | — | 空值即忽略 |
| `new_example_chat_prompt` | ✅ 忽略 | — | 空值即忽略 |
| `group_nudge_prompt` | ✅ 忽略 | — | 群聊 nudge 硬编码 index.svelte.ts:489;且 v1 不做群聊(SCOPE 排除) |
| `send_if_empty` | ✅ 忽略 | — | Risu 仅 `useSayNothing` 单模式(DefaultChatScreen.svelte:171-182),ST 多模式(空 user/assistant/system/stop)不存在 |
| `assistant_impersonation` | ✅ 忽略 | — | Risu 仅 `/sendas`(command.ts:112)与 trigger impersonate(triggers.ts:1372),无 UI 开关 |

## 3. 非改源码的替代承载路径(供未来扩展)

- **Trigger 系统**:`input` 事件(DefaultChatScreen.svelte:187)+ `systemprompt` effect(triggers.ts:1367,位置 start/historyend/promptend)可做条件注入。
- **Lua `editRequest` 钩子**:index.svelte.ts:1493,可编程改写最终 prompt 数组,按条件注入任意文本。

## 4. 官方转换器参考

Risu 自带 `promptConvertion`/`stChatConvert`(prompt.ts):ST preset → Risu。对 `assistant_prefill` 的处理即"postEverything 卡 + prefill 守卫卡",证明该模式是官方认可承载,非发明字段。

## 5. 验证

- V18 真实端到端:continue_postfix `" "` → `promptSettings.postEndInnerFormat`,degraded 报告;impersonation/continue_nudge/continue_prefill manual 带具体理由;assistant_prefill 空值无噪音。
- 94 个单测全绿(m1 新增 2 个行为字符串用例)。
