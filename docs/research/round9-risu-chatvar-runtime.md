# round9: Risu `{{setvar}}` 运行时门控实证(推翻"A 直通"前提)

日期:2026-08-09
结论:**`{{setvar}}/{{addvar}}/{{setdefaultvar}}` 并非 A 直通**。Risu 中这三个宏只有在 `runVar=true` 时才执行(cbs.ts:816,832,851);prompt 卡渲染路径 `runVar=false` → **字面量原样保留、变量不写入**。ST 的"变量初始化卡"原样转成 Risu prompt 卡后**初始化失效且宏文本残留进 prompt**。

---

## 1. 源码证据

`src/ts/cbs.ts`(本地源码 2026.6.215)三个回调,结构完全一致:

```ts
registerFunction({
    name: 'setvar',
    callback: (str, matcherArg, args, vars) => {
        if(matcherArg.rmVar){ return '' }        // 仅消息显示路径(Chat.svelte:181,513)
        if(matcherArg.runVar){ setChatVar(args[0], args[1]); return '' }  // 执行 + 清空宏
        return null                              // 其余路径:返回 null
    },
    description: '...Only executes when runVar is true...',
});
```

`runVar` 默认值:`parser.svelte.ts:1618` `runVar: arg.runVar ?? false`。

`{{...}}` 返回 `null` 时的主循环处理(`parser.svelte.ts:1780`):
```ts
if(!mc && mc !== ''){ nested[0] += `{{${dat}}}` }   // null → 原样保留 {{setvar::...}}
```

## 2. runVar 全部调用点(全源码)

全局搜索 `runVar`(排除类型/默认定义):

| 位置 | runVar | 场景 |
|---|---|---|
| `index.svelte.ts:146` `runCurrentChatFunction` | `true` | **历史聊天消息重处理**(加载/保存聊天时对 `chat.message` 逐条重渲染) |
| `Chat.svelte:181,513` | `rmVar:true`(非 runVar) | 消息**显示**路径:清空宏、不执行 |
| 其余全部 `risuChatParser` 调用(scripts/lorebook/triggers/cbs 宏递归/tokenizer…) | `false`/未传 | 见 §4 |

**没有**任何 promptTemplate 卡渲染路径传 `runVar`。卡渲染(`index.svelte.ts:748-763`)统一 `risuChatParser(content, {chara, role})`。

## 3. 实证(vitest,risuai-src 内临时测试)

在 `src/ts/parser/tests/cbs/setvar_probe.test.ts` 用项目自带 vitest 直接验证:

| 输入 | 结果 |
|---|---|
| `{{setvar::alpha::hello}}`(无 runVar,=卡渲染路径) | 输出含字面量 `{{setvar::alpha::hello world}}`;**变量未写入** |
| `{{setvar::alpha::hello}}` + `rmVar:true`(=消息显示路径) | 宏被清除;**变量未写入** |
| `{{setvar::alpha::hello}}` + `runVar:true`(=消息重处理路径) | 宏被清除;**变量已写入** |
| 真实 preset 卡(`{{setvar::think1::\n### 思考规则\n内容}}`) | 同 1:字面量保留、`{{getvar::think1}}` 读空 |

5/5 通过。与 Risu 官方 wiki 一致:"setvar … only works when this syntax is in the chat or first message, otherwise it would be ignored"(github.com/kwaroran/Risuai/wiki/Curly-Brased-Syntaxes)。

## 4. 各子系统变量读写矩阵(全量)

| 子系统 | runVar | setvar 效果 | 证据 |
|---|---|---|---|
| prompt 卡渲染(plain/main/globalNote 等) | false | 字面量残留,不写入 | `index.svelte.ts:748-763` |
| 正则脚本 OUT | false | 字面量残留,不写入 | `scripts.ts:133,248,291`(lorebook.svelte.ts:574 注释明说 "no side effects like setvar") |
| 历史消息重处理 | true | **执行并写入** | `index.svelte.ts:146` |
| 消息显示 | rmVar | 清空不写入 | `Chat.svelte:181,513` |
| 世界书 content | false | 不写入 | round6-capabilities §2 |
| 触发器 setvar / v2SetVar effect | 直接 API | **执行并写入**(唯一无门控写路径) | `triggers.ts` |

**推论**:Risu 生态的"变量"实际有两条写路径——① 触发器 effect(UI/正则触发时),② 聊天消息内含 setvar(消息重处理时)。prompt 卡里的 setvar 是无效代码。

## 5. 影响评估(实测产物)

狐神 V18 转换产物 `rius/preset/risu_hupreset.json`:48 张卡中 **35 张 setvar 卡**(含"初始化(不要关)"整卡 60+ 个 `{{setvar::x::}}`)。全部原样透传 → 在 Risu 中:
- 变量不初始化(后续 `{{getvar::think1}}` 等全部读空)
- `{{setvar::...}}` 字面量残留进发给模型的 prompt

## 6. 决策修正(覆盖 round7 §3 与 round6 §6)

- round7 §3"Risu `setvar` 为 A 直通宏"**前提错误** → 见下。
- round6-spec §6 A 直通清单含 `setvar/addvar` **错误** → 移出。
- **新分类**:`setvar/addvar/setdefaultvar` 归入 **manual 报告**(同 `setglobalvar` 待遇),reason 写明"Risu 中仅触发器 effect / 聊天消息(重处理)可写,卡内不执行;若为 ST 变量初始化卡,建议用 `customPromptTemplateToggle` + `{{getglobalvar::toggle_x}}` 迁移"。
- `getvar/getglobalvar` 保持 A 直通(读取处处有效,无门控)。
- mapPrompts round7 的"检测 setvar 变量 + 报告清单"逻辑保留,但 action 由 `kept` 升级为 `manual`。
