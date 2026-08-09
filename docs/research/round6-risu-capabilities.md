# RisuAI 子系统能力全景:替代载体总表(第 6 轮,超越 preset)

日期:2026-08-09
范围:除 botPreset/presetRegex/promptTemplate 之外的 Risu 全部子系统,作为 Tavern preset 功能的"可替代载体"系统盘点
来源:4 路子代理源码调研(触发器/世界书/变量+模块+资产/翻译+群聊+采样分参+API+推理+杂项)
目的:为通用转换器提供"功能 → 落点"的完整决策表

---

## 0. 结论速览

| Tavern preset 功能 | Risu 最佳落点(优先级) |
|---|---|
| 正则字符串变换 | 正则脚本 `customscript`(editinput/process/output/display) |
| 状态标记(检测→置 flag) | **触发器** setvar/v2SetVar(正则 OUT 只能读不能写) |
| 跨消息读改写历史 | 触发器(start/output/input/manual) |
| 按条件注入 prompt 指定位置 | 触发器 `systemprompt`(start/historyend/promptend) |
| 检测到 X 注入 Y(WORLD_INFO 型) | 世界书 `useRegex`+装饰器 |
| 深度过滤(按新旧消息) | 触发器 `exists depth`/`v2QuickSearchChat` 或正则 OUT `{{#if}}`(无真区间,需组合) |
| 命中→显示图片/音频/情绪 | 正则 `editdisplay` OUT 引资产宏 + `@@emo` |
| 翻译后处理 | `edittrans` 正则类型(唯一槽位) |
| Instruct 模板/格式串 | `instructChatTemplate`/`JinjaTemplate`/`systemContentReplacement`/`ooba.formating`/`groupTemplate` |
| REASONING 处理 | 原生思考参数(thinkingType/thinkingTokens/reasoningEffort) |
| 打包分发 | 模块 `.risum`/`.charx`(regex+trigger+lorebook+assets 一体) |

---

## 1. 触发器系统(最强大的替代载体)

核心:`src/ts/process/triggers.ts`(2821 行)。

**模式**(`triggers.ts:20-26,107`):`start|manual|output|input|display|request`。**无 end、无 process**;`request` 对应"发请求前改数据"。
- 执行时机与 chat 可读写:start(管线早期,`index.svelte.ts:888`,完整 chat)/output(生成后 `:1763,1871`)/input(发送前 `DefaultChatScreen.svelte:187`)/display(渲染前 `scripts.ts:109`,仅 displayData)/request(发请求前 `request.ts:245-261`,仅 OpenAI 数组 JSON)/manual(手动)。
- **`{{chatID}}` 在触发器恒 -1**(`triggers.ts` 全文不传 chatID)。

**条件**(`triggers.ts:28,1237-1316`):仅 4 种,AND 连接:value / var / chatindex(=消息总数 `:1241`)/ exists(keyword,`type2` strict|loose|regex,`depth`=最近 N 条 `:1296-1309`)。

**效果**:V1 16 个(`:1333-1561`)+ V2 约 90 个(`:1563-2795`)。
- V1:`setvar`/`systemprompt`(3 位置)/`impersonate`/`command`/`stop`/`runtrigger`/`cutchat`/`modifychat`/`showAlert`/`sendAIprompt`/`runLLM`/`checkSimilarity`/`extractRegex`/`runImgGen`/`triggerlua`。**`runAxLLM`、`triggercode` 是死效果**。
- V2 重点:控制流(v2If/v2IfAdvanced/v2Else/v2Loop/v2LoopNTimes/v2BreakLoop/v2RunTrigger/v2EndIndent)、聊天读写(v2GetMessageAtIndex/v2ModifyChat/v2CutChat/v2Impersonate/v2GetMessageCount/v2GetLastUserMessage/v2GetLastCharMessage/v2GetFirstMessage/v2QuickSearchChat)、字符串/正则(v2ExtractRegex/v2RegexTest/v2ReplaceString/v2SplitString 等)、数组/字典(v2MakeArrayVar/v2PushArrayVar…)、数据(v2Get/SetCharacterDesc/Persona/GlobalNote/AuthorNote)、世界书(v2ModifyLorebook 旧+新,v2CreateLorebook/v2ModifyLorebookByIndex 等)、请求(v2Get/SetRequestState 系列)、变量(v2SetVar/v2DeclareLocalVar/v2Calculate)。

**display/request 沙箱**(`triggers.ts:985-1036`):`safeSubset`(仅纯文本变换/字符串/数组/字典/条件/循环/正则测试,`v2SetVar` 含但**只写 tempVars 不落盘** `:1198-1202`)+ `v2Get/SetDisplayState`(display)/`v2Get/SetRequestState*`(request)。**不能读/写历史消息、不能持久化变量**。

**群聊**:display/request/input/manual 跳过群(`scripts.ts:106`、`request.ts:247`、`DefaultChatScreen.svelte:186`);start/output 按成员生效(`index.svelte.ts:295-336`)。

**限制**:无 end 模式;无否定条件;递归上限 10;无缓存;V1 已弃用;低权限门禁 7+4 效果。

## 2. 世界书系统(lorebook)

核心:`src/ts/process/lorebook.svelte.ts`;条目类型 `database.svelte.ts:1319-1340`。

- **字段**:key(逗号分隔,正则时每条 `/re/flags`)/secondkey/insertorder(优先级)/content/alwaysActive/selective/useRegex/mode/id/folder 等。
- **useRegex**(`lorebook.svelte.ts:145-172`):格式 `/re/flags` **必须带 flags**;匹配对象=扫描窗口内历史消息**原始 data**(未过 editprocess);**不展开宏**;命中=注入该条 content,不是替换。
- **注入位置**:全部靠 content 内 `@@` 装饰器(`:391-434,500-527,1056-1066,1188-1195`):`@@position pt_<name>`/`before_desc`/`after_desc`/`personality`/`scenario`、`@@depth N`/`@@reverse_depth N`、`@@inject_at`/`@@inject_prepend`/`@@inject_replace <loc>`(注入指定 prompt 卡,loc=`main/globalNote/jailbreak/persona/description/authornote`…)、`@@inject_lore <comment>`(注入另一条目)。动态控制:`@@activate_only_after/every N`、`@@is_greeting`、`@@probability`、`@@additional_keys/exclude_keys`、`@@keep_activate_after_match`(写 `__internal_ka_*` chatVar)。
- **内容动态性**:CBS 宏可用(含 `{{getvar}}`、`{{#if}}`、`{{#each}}`);**`{{setvar}}` 无效**(runVar=false,`lorebook.svelte.ts:572-576`);**`{{chatindex}}`=-1**。
- **与正则**:内容**不过正则脚本**(全部 processScript 调用点不含 lorebook;仅整体 prompt 过 Lua editRequest `index.svelte.ts:1493`)。触发器可读写世界书(v2 系列,Lua API)。
- **wi_format 无等价**:lorebook 模板卡不支持 innerFormat(`index.svelte.ts:1323-1326`);worldInfoAfter 官方导入被丢弃。
- **群聊**:只扫群自身 globalLore+聊天 localLore+模块 lore,不含成员条目(`lorebook.svelte.ts:79-82`);`{{lorebook}}` 宏群聊返回空(`cbs.ts:325`)。
- **替代结论**:完整等价"检测到 X 注入 Y"型正则(WORLD_INFO placement),并多出 token 预算/递归扫描/位置装饰器。

## 3. 变量系统

核心:`src/ts/parser/chatVar.svelte.ts` + cbs 宏 + 触发器 setvar。

- **分级**:临时(单次求值)/聊天级(`chat.scriptstate['$'+key]`,持久)/角色默认(`character.defaultVariables`,只读)/预设默认(`templateDefaultVariables`,只读)/全局(`db.globalChatVariables`,仅默认值,toggle 写入)。**模块级变量不存在**。
- **defaultVariables 格式**:`key=value` 每行;`parseKeyValue`(`util.ts:989-1008`)按**第一个 `=`** split,值不能含 `=`/换行。合并:角色优先,scriptstate 覆盖。
- **读写矩阵**(关键):
  - 宏 `{{getvar}}` 处处可读;`{{setvar}}/{{addvar}}/{{setdefaultvar}}` 需 `runVar=true`(`cbs.ts:813,829,845`;`parser.svelte.ts:1618`)。
  - **正则脚本全程 runVar=false**(`scripts.ts:133,248,291`)→ **OUT 只可读变量,不可写**。
  - 触发器 `setvar`/`v2SetVar` 直接写,无门控。
  - 世界书 content 不可写。
  - **prompt 卡渲染 runVar=false**(`index.svelte.ts:748-763`)→ 卡内 `{{setvar}}` 不执行、字面量残留(vitest 实证,见 round9-risu-chatvar-runtime.md)。
- **状态标记结论**:"检测到标签→置 flag→后续按 flag 行为" = `exists` 条件 + `setvar` 效果(触发器),prompt 侧用 `{{#when::var::}}`/`{{getvar}}` 读。正则做不到写。
- **没有 setglobalvar 宏**:全局变量只能 toggle/UI 写。

## 4. 模块系统

核心:`src/ts/process/modules.ts`。

- **结构**(`modules.ts:19-35`):name/description/lorebook/regex/cjs/trigger/id/lowLevelAccess/hideIcon/backgroundEmbedding/assets([名称,路径,文件名])/namespace/customModuleToggle/mcp/icon。**无 version/toggle/variables**。
- **执行链**:正则 `presetRegex→char.customscript→模块`(`scripts.ts:134`);触发器 `char.triggerscript→模块`;世界书 `globalLore→localLore→模块`;资产与角色合并。
- **启用**:`enabledModules`/chat.modules/character.modules/persona.embeddedModule/**`db.moduleIntergration`(预设携带,逗号分隔 ID)**(`modules.ts:398-427`;`database.svelte.ts:1633`)。
- **namespace**:启用一个 namespace=启用一组模块(`modules.ts:374-381`)。
- **打包**:`{type:'risuModule',...}` JSON / `.risum` / `.charx`;一个模块可同时装 regex+trigger+lorebook+assets+cjs+mcp → **转换产物首选打包载体**。`convertCharacterToModule` 的 `@@indicator` 协议(`interchangeability.ts`)可作"注入文本打包进模块"规范。
- **模块变量**:无字段,用 trigger setvar 初始化 或 customModuleToggle(toggle 落 `db.globalChatVariables['toggle_'+key]`,prompt 用 `{{#when::toggle::name}}` 读)。

## 5. 资产与情绪

- **资产宏**(`parser.svelte.ts:408`):`{{raw|path|img|image|video|audio|bgm|bg|emotion|asset|video-img|source::name}}`。存储 `assets/{id}.{ext}`。
- **正则 OUT 可引用**:editdisplay 正则替换后经 risuChatParser,显示时 parseAdditionalAssets(`parser.svelte.ts:747-762`)→ **命中→注入图片/音频/BGM/背景**,等价 Tavern"命中模式→显示增强"。多模态进模型用 `{{asset_prompt::name}}`。
- **情绪**:设置入口只有正则 `@@emo <name>`(`scripts.ts:184-206`,仅 editdisplay 且 out 以 `@@emo ` 开头);模型输出 `<Emotion="...">` 标签也可。触发器**无 emotion 效果**。
- **坑**:`@@emo` 类副作用脚本可能被 processScriptCache 缓存跳过(`scripts.ts:68-97`)。

## 6. 翻译器

- 模式:`google|deepl|none|llm|deeplX|bergamot`(`database.svelte.ts:971`)。`memory/emotion/translate/otherAx` 是 **ModelModeExtended**(采样/模型分参),不是翻译模式。
- **edittrans**(`translator.ts:621-639`):翻译后唯一后处理槽位,只认 `type:'edittrans'` 脚本;实现简陋(无 `<...>` 标签支持、flag 含 `<` 会抛异常)。**翻译结果不过 editprocess/editoutput**;DOM 翻译路径会复用 editdisplay(`translator.ts:395`)。
- 结论:Tavern 的"翻译后处理"只能映射 edittrans。

## 7. 群聊

- `groupChat` 自带 customscript/globalLore(`database.svelte.ts:1508-1552`)。
- `groupTemplate`+`groupOtherBotRole` 包裹非当前发言者消息(`index.svelte.ts:984-1000`),对应 Tavern 群聊消息包裹。
- **生效矩阵**:正则 editprocess/output/display **只跑群自身的 customscript**;start/output 触发器按成员生效;request/display 触发器**跳过群**;世界书只扫群级。
- **转换风险**:Tavern 群聊的成员级正则/世界书,Risu 群聊不生效 → 需下沉到群 customscript/globalLore。

## 8. 采样分参 / 动态输出

- `seperateParameters{memory,emotion,translate,otherAx,overrides}` + `seperateParametersByModel`(`shared.ts:137-341`):按辅助模型分离采样参数(温度/罚项按 /100,-1000=不发送)。`seperateModelsForAxModels` 按模式换模型(`request.ts:442-444`)。
- 对应:Tavern 无内建多模型分参,Risu 是**独有超集**(可承接"按模型动态温度/多模型")。
- **`dynamicOutput` 全接口死字段**:仅定义/存取,无消费、无 UI(`database.svelte.ts:781-789,1223,1682`)。

## 9. 自定义 API / 格式串(Instruct 对应)

| Risu | 对应 Tavern | 证据 |
|---|---|---|
| `instructChatTemplate`(内置 chatml/llama3/jinja…) | **Instruct 模板** | `chatTemplate.ts:27-38` |
| `JinjaTemplate`(自定义) | 自定义 Instruct 序列 | `chatTemplate.ts:38` |
| `systemContentReplacement`/`systemRoleReplacement` | system 消息包裹格式串 | `request.ts:353-358` |
| `ooba.formating{header,systemPrefix,userPrefix,assistantPrefix,seperator,useName}` | 角色序列格式串(wi_format 类) | `stringlize.ts:42-97` |
| `groupTemplate`+`groupOtherBotRole` | 群聊消息包裹 | `index.svelte.ts:984-1000` |
| `customAPIFormat` | —(仅 reverse_proxy 生效) | `request.ts:470` |
| `turn_template` | —(**半死**:仅反代透传) | `ooba.ts:4`;`prompt.ts:239-270` |

- 结论:Tavern 的 `new_chat_prompt`/`wi_format` 无单一字段 1:1,需组合 instructChatTemplate+systemContentReplacement+ooba.formating。

## 10. 推理/思考(REASONING 对应)

- 原生思考参数:`thinkingType`(off/budget/adaptive,`anthropic.ts:364-383`)、`thinkingTokens`、`deepseekThinkingType`(`openAI/requests.ts:459-467`)、`reasonEffort`(`shared.ts:311`)、`adaptiveThinkingEffort`。
- 发送时提取 `<Thoughts>...</Thoughts>`(`index.svelte.ts:1012-1016`),由模型 flag 转 `reasoning_content`/`deepSeekThinkingInput`。
- 结论:**可原生替代 Tavern REASONING placement 正则**;但"把 reasoning 当普通文本展示"无等价,只能走 reasoning_content 通道。

## 11. 死字段/半死字段清单

| 字段 | 状态 |
|---|---|
| `dynamicOutput`(全接口) | 死 |
| `SeparateParameters.outputImageModal` | 半死(applyParameters 不读) |
| `turn_template` | 半死(仅反代) |
| V1 `runAxLLM`、`triggercode` | 死效果 |
| 世界书 `risu_case_sensitive` | 存而不用(恒小写) |

---

## 12. 转换器关键决策(由本全景修正/补充)

1. **状态标记 → 触发器,不进正则**:正则 OUT 只能读变量;setvar 必须由触发器 effect 写(round6 spec §4 需补充)。
2. **显示增强 → editdisplay OUT 资产宏 + `@@emo`**:完整可迁移,注意副作用缓存。
3. **深度过滤双方案**:OUT `{{#if}}`(消息内,仅模板可访问状态)vs 触发器 `exists depth`/`v2QuickSearchChat`(聊天数据层,更接近 Tavern 深度语义但**无真 min/max 区间**,需组合 `depth` 两次 + v2IfAdvanced)。推荐:**消息文本级 → OUT;聊天级搜索 → 触发器**。
4. **WORLD_INFO 型正则 → 世界书 useRegex**:完整等价,但注意"匹配原始文本、注入非替换、无 wi_format"。
5. **翻译后处理 → edittrans**:仅此槽位,别生成 `<...>` 标签。
6. **群聊**:转换产物若面向群聊,成员级正则/世界书需下沉群级;request/display 触发器在群聊失效。
7. **打包 → 模块**:regex+trigger+lorebook+assets 一体,`moduleIntergration` 随 preset 携带;模块无 variables,默认变量用 trigger 初始化。
