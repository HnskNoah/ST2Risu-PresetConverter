# round7: Risu customPromptTemplateToggle 研究

日期:2026-08-09
结论:机制已完整掌握;**转换器不自动生成 toggle**(ST 无 label/options/group 元数据,无法保真);改为在报告中输出 setvar 变量清单 + 迁移建议。

## 1. 机制(源码级证据)

`customPromptTemplateToggle` 是 preset 顶层字符串,每行一个定义(`src/ts/util.ts:1049 parseToggleSyntax`):

```
key=label                                  → checkbox(值 '0'/'1')
key=label=select=选项A,选项B,...            → 下拉(值 = 选项索引字符串,0-based)
key=label=text                              → 单行文本输入
key=label=textarea                          → 多行文本输入
=label=divider                              → 分隔线
=label=group / =label=groupEnd              → 分组(嵌套)
=label=caption                              → 说明文字
```

解析:`line.split('=')` 取 `[key, value, type, option]`,`type==='group'|'groupEnd'|'divider'|'caption'` 为结构行;其余 `key && value` 为控制项,`option.split(',')` 为 select 选项。**约束:值内不能含 `=`**。

运行时(`src/lib/SideBars/Toggles.svelte`):
- 所有值存 `DBState.db.globalChatVariables['toggle_' + key]`(自动加 `toggle_` 前缀)。
- checkbox:`globalChatVariables['toggle_'+key] === '1'` 判断开关。
- select:`bind:value` 直接绑 `toggle_<key>`,`OptionInput value={i.toString()}` → **值为选项索引字符串**。
- 模板消费:`{{getglobalvar::toggle_<key>}}` + `{{#if {{? {{getglobalvar::toggle_<key>}}==N}}}}`(select 用索引 N)。
- `customPromptTemplateToggle` 可叠加模块(`getModuleToggles()`)与角色级 `charToggle`。

实测两份真实 preset(서리 v9 / 小惡魔 v15)都大量使用,语法吻合。

## 2. ST 侧生态

ST preset 的"变量卡"模式:`{{setvar::var::内容}}` 初始化/写入变量,配正则脚本运行时改值。实测 V18 狐神抚:58 个 setvar 变量,集中在"初始化(不要关)"卡清空(`{{setvar::think1::}}…`),各功能卡写入可选规则块。

**ST 侧缺失的元数据**:
- label(显示名)——只能从卡名/变量名猜
- select 选项枚举——ST 无,正则硬编码值
- group 分组——ST 无
- 开关语义——ST 用"变量内容是否非空"控制,非 0/1

## 3. 决策

- **不自动生成 toggle**:ST 信息不足以保真生成(无 label/选项/分组);强行生成需猜测且改写模板结构(把 `{{setvar::x::内容}}` 包进 `{{#if …toggle_x=1}}`),风险高、属于"生态迁移"而非"保真转换"。
- **报告增强(已实现,round9 修正 action)**:检测模板中的 setvar 变量,输出变量清单 + 迁移指引,提示用户可在 Risu 用 `customPromptTemplateToggle` 手工将变量做成 UI 开关。
- **修正(round9)**:原句"Risu `setvar` 为 A 直通宏"**前提错误**——`setvar/addvar/setdefaultvar` 仅 `runVar=true` 执行(cbs.ts:816,832,851),prompt 卡渲染 `runVar=false` 字面量残留、变量不写入。故不再"原样转 + kept",改 **manual 报告**:卡内 setvar 不执行,提示用触发器 effect / 消息重处理 / `customPromptTemplateToggle` 迁移。详见 `research/round9-risu-chatvar-runtime.md`。
