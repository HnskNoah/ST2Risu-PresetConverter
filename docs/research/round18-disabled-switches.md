# round18: 孤立 disabled 卡 → 默认关闭的开关

日期:2026-08-10
状态:完成(141 测试全绿)
实现:`src/mapDisabledToggles.ts`

## 问题

ST 预设里有两类 disabled prompt 卡:

| 类型 | 例子 | 此前处理 | 问题 |
|---|---|---|---|
| 变量组候选(含 `{{setvar::X::内容}}`) | think1 各强度卡、mvu 模式卡 | round11 进 toggle 作为 select 选项 | ✅ 用户可开关 |
| **孤立 disabled(无 setvar)** | 0-16 破限示例、`⚠️随机头部`、`（不要开）`、`--预设不可破4.8O`、提示/教程卡 | round7 起直接丢弃 | ❌ 用户无法再打开 |

关键约束:**Risu prompt 卡没有 enabled 字段**(PromptItemPlain/Typed 等无 `ableFlag`,只有 customscript 有),无法"保留内容但默认不注入"。

## 方案

每张孤立 disabled 卡 → **一行 toggle + 一张守卫卡**:

- **toggle 行**:`sw_<n>_<卡名>=<卡名>=select=关闭,开启`(默认索引 0 = 关闭,empty 内容)
- **守卫卡**(push 到 promptTemplate 末尾):`type=plain, type2=normal, role=system, name='🔒 已关闭提示(开关开启后生效)'`,text 为每张卡的:
  ```
  {{#if {{? {{getglobalvar::toggle_sw_1_xxx}}==1}}}}<卡内容>{{/if}}
  ```
  拼接。
- 语义:未选择(null)或选"关闭"(0) → 不注入;用户开开关(选"开启"=1) → 注入卡内容。

## 关键决策

1. **排除含 `{{setvar::` 宏的 disabled 卡**:那些是变量组候选,已归 mapToggles 作 select 选项;若也进守卫卡会内容重复注入。
2. **守卫条件纯 `==1`**(不用 round11 的 `or(==1,==null)`):默认(null)必须不注入,只有显式选"开启"才注入。
3. **守卫卡经过 setvar 提取/宏翻译吗?** 守卫卡在 mapPrompts 外 push,不走 translateMacros/setvar 提取——其内容含 Risu 原生 `{{#if}}`/`{{?}}`/`{{getglobalvar::}}`,本就该原样保留。而卡内容本身是 ST 文本,残留的 `{{...}}` 若存在则保持原文(可后续处理)。
4. **守卫卡位置**:promptTemplate 末尾(worldInfoAfter 之后,prefill postEverything 之后),保证不干扰既有槽位布局。

## 实测(V18 狐神抚)

- 52 个孤立 disabled 卡 → 52 个 `sw_` 开关,全部进入 `customPromptTemplateToggle`(总 72 行 = 20 变量组 + 52 开关)
- 守卫卡含 52 个 `{{#if}}` 块,内容保真
- 守卫卡不含 `{{setvar::`(变量组候选正确排除)
- report:toggles 区新增 52 条 converted;summary converted 127→179

## 测试

`test/m10.test.ts` 4 条:collectDisabledCards 过滤(含 setvar 排除)、守卫卡形态 + toggle 行、convert 集成(守卫卡存在 + 变量组不重复 + 孤立卡无独立 plain)、全 enabled 预设无守卫卡缺省。
