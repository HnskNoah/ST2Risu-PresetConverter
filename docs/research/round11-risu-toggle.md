# round11: ST 变量卡 → customPromptTemplateToggle(变量组 → select)

日期:2026-08-09
结论:ST 的"开关卡"机制 = **候选卡组 + prompt_order enabled 快照**,可完整保真转成 Risu `customPromptTemplateToggle`(select),消费点内容注入。

## 1. ST 真实机制(实测 V18 狐神抚 · 毓忻)

- 每个"开关变量"(如 `wenfeng`/`POV`/`zishu`)背后是**一组候选卡**,每张卡 `{{setvar::X::内容}}` 写同一变量 X 的一段**内容**。
- 用户在 ST 里启用其一;预设导出时 `prompt_order` 固化 enabled 快照。
- 消费点模板(如 `--开始--` 卡)`{{getvar::X}}` 插入**当前启用卡的内容**——即"变量值即内容"。
- 实测:212 个 prompt 中 152 disabled;51 个开关变量组(每变量 1~8 个候选选项)。

## 2. 语义鸿沟

Risu toggle 只给 select **索引**(存 `globalChatVariables['toggle_X']`),**不含内容**。简单改写 `{{getvar::X}}` → `{{getglobalvar::toggle_X}}` 会丢失全部规则文本。

**保真方案**:内容注入消费点。

## 3. 消费点改写范式

`{{getvar::X}}` → 对每个选项 i:
```
{{#if {{? {{getglobalvar::toggle_X}}==i}}}}选项 i 内容{{/if}}
```
默认项(当前 enabled 卡,索引 d)带 null 兜底:
```
{{#if {{or::{{? {{getglobalvar::toggle_X}}==d}}::{{? {{getglobalvar::toggle_X}}==null}}}}}}默认内容{{/if}}
```

**为何 null 兜底有效**(源码证据):
- `getGlobalChatVar`(chatVar.svelte.ts:35)未设置时返回 `'null'`。
- parser.svelte.ts:1045 对 `? expr` 调 `calcString`;infunctions.ts:121 `.replace(/null/gi,'0')` 把 `null` → `0`,`==` → `=`(calculateRPN 的 `=` 判等,infunctions.ts:83)。
- 故未选时 `{{? toggle_X==null}}` → `null==null` → `0=0` → `1` → 命中默认分支;选了其他值时该分支为 `0`。

**约束**:`and`/`or`(cbs.ts:948/954)参数必须是 `'1'`/`'0'`,故 `?` 求值表达式是唯一选择。

## 4. select 定义生成

```
X=label=select=选项1,选项2,...
```
- `parseToggleSyntax`(util.ts:1049)用 `line.split('=')` 取 `[key,value,type,option]`、`option.split(',')` 取选项 → **label 与选项必须剔除 `=` 和 `,`**;另去 emoji 保可读。
- 选项顺序 = prompt_order 出现顺序;label 取 enabled 卡名。

## 5. 平衡解析(setvarParse.ts)

简单正则 `\{{setvar::([^:]+)::([^{}]*)\}\}` 遇值内 `{`(如 `{{user}}`)截断,漏转。V18 实测 **19 张卡**因值含嵌套宏被漏掉(如"❌🏛️防霸总"的值含 `{{user}}`)。

`scanSetvarMacros` 用深度计数扫描:跳过配对的 `{{...}}`(depth±),直到未嵌套的 `}}` 结束。与 ST 官方正则(variables.js `[^}]*)` 一致地**不支持值内裸 `}`**;`{{...}}` 配对正确跳过。未闭合宏不提取、不崩溃。

## 6. 触发器协调

toggle 化变量从 `mapTriggers` 的 start 触发器排除(`filterSetvarsForTrigger`)——否则每次生成前触发器 setvar 覆盖变量,覆盖 toggle 选择。全空初始化卡(`{{setvar::x::}}`)非开关 → 仍走触发器。

## 7. 产物验证(V18 端到端)

- 51 行 toggle 定义(全部候选组保留,含 anti-bazong/POV 人称选项)
- `--开始--`/`(别关)注入强调要求` 两处消费点各注入完整分支组
- 触发器 17 个 effect(非 toggle 变量:初始化空/运行时变量)
- 92 个单测全绿(m4/m5 新增平衡解析与 toggle 用例)

## 8. 已知边界

- **多消费点**:同一变量在多个消费卡时,每处注入完整分支组(ST 语义即每处 getvar 插内容,一致)。
- **值内裸 `}`**:ST 本身不支持(官方正则截断),平衡解析同样保留为值内容。
- **toggle 与触发器同名变量**:已排除,不会双写。
- 选项内容含 `{{...}}` 宏:注入后由 Risu 正常解析(保真)。
