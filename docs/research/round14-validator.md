# round14: 产物校验器(schema 校验 + 导入冒烟)

日期:2026-08-10
结论:转换产物能否被 Risu 正常消费,是判断转换对错的唯一手段。校验器复刻 Risu 导入侧的消费点,把"产物合格"变成可程序化断言的闭环节点。

## 1. 校验依据(Risu 源码消费点)

| 校验层 | 复刻目标 | 源码 |
|---|---|---|
| 卡结构 | `normalizePromptTemplate` 的 switch(type) | database.svelte.ts:2524 |
| 8 条警告 | `templateCheck()` | templateCheck.ts |
| toggle 解析 | `parseToggleSyntax` 成功判定(`line.split('=')`,`type==='select'` 才消费 options) | util.ts:1049 |
| 正则 in | 空 in 匹配一切文本(customscript 引擎) | — |
| 触发器 type | trigger 事件类型白名单 | triggers.ts |

## 2. 三层校验

**① 结构校验**(error 级,导入即崩/即错):
- 卡类型必须 ∈ PromptItem 白名单(plain/jailbreak/cot/chat/persona/description/lorebook/postEverything/authornote/memory/chatML/cache)
- plain/jailbreak/cot 必须带 type2(normal/globalNote/main)与 role
- regex 非 disabled 必须有 in(空 in → Risu 匹配一切文本,危险)
- toggle 行必须可解析;key 不得含 `=`/`,`(parseToggleSyntax 按 `=` 切分)

**② templateCheck 复刻**(warning 级,导入有警告):
- main 恰 1(missing → NO_MAIN,>1 → MULTI_MAIN)
- globalNote 恰 1(NO_NOTE / MULTI_NOTE)
- description / lorebook 存在(NO_DESCRIPTION / NO_LOREBOOK)
- chat 卡 rangeEnd='end' 存在(NO_CHAT_END)
- chat range 连续(CHAT_UNCONNECTED)

**③ 一致性**(error 级,产物内部自洽):
- 消费点 `{{getglobalvar::toggle_X}}` 的 X 必须存在于 toggle 定义(TOGGLE_REF_UNDEFINED)
- 触发器 effect 变量来源(validateModule,error 级)

## 3. 单选项 toggle 修正(round11 过度转换)

真实产物校验暴露:**大量单候选变量组被转成单选项 select**(如 anti-bazong/think2)。这是无意义下拉,且因 `filterSetvarsForTrigger` 从触发器排除导致变量值丢失。

**修正规则**:有效选项 ≥ 2 才进 toggle;单选项组(仅 1 个有效候选)走触发器路径(round10)—— 值由 start 触发器 setvar 写入 scriptstate,消费点 `{{getvar::X}}` 保持原样由 Risu 解析。

## 4. 校验器验证能力(实例)

- **真实 V18**:校验器抓出 `NO_MAIN` —— 该预设 main 卡 `enabled:false`,用户主动关闭,是真实输入状态不是缺陷;校验器如实报告,提醒导入 Risu 会有警告。单选项 toggle 修正后 V18 校验通过(仅 1 条 NO_MAIN 警告)。
- **变异 fixture**:11 卡 / 11 正则,零 error/warning。
- 故意破坏的产物:未知卡类型 / 缺 type2 / toggle key 含 `,` / 消费点引用未定义 toggle / regex 缺 in / 非法 trigger type 全部被抓(error 级)。

## 5. 输出形态

CLI 转换后自动跑 `validateAll(preset, module)`:
```
validate: OK (11 cards, 11 regex)          # 无问题
validate △ [NO_MAIN]: No main prompt entry found   # warning 打印
validate ✗ [TOGGLE_REF_UNDEFINED]: ...     # error 打印 + 退出码 1
```
warning/info 不阻塞(产物仍写出);error 置进程退出码 1(CI 可拦截)。

## 6. 测试

`test/m7.test.ts` 12 条:合法产物零问题 / 缺卡警告组 / 未知类型 error / 缺 type2 error / MULTI_MAIN / toggle 解析失败 / key 非法 / 引用未定义 / 单选项 info / regex 缺 in / module 校验 / validateAll 合并。
