# SillyTavern Preset(预设)数据结构与读写逻辑调研报告 — Round 4

日期:2026-08-09
来源:子代理源码调研(`SillyTavern/SillyTavern-src`)
范围:preset 顶层字段、prompts/prompt_order、extensions 读写、regex_scripts 角色、bias preset、SPreset/tavern_helper、格式串、导入导出、采样器映射

## 0. 关键文件定位

| 文件 | 作用 |
|---|---|
| `public/scripts/preset-manager.js` | 通用 preset 管理类 `PresetManager`,`readPresetExtensionField`/`writePresetExtensionField` |
| `public/scripts/openai.js` | OpenAI 系 preset 的定义、`settingsToUpdate` 映射、导入导出 |
| `public/scripts/PromptManager.js` | `prompts`/`prompt_order` 数据模型与 `Prompt` class |
| `public/scripts/extensions/regex/engine.js` + `index.js` | `extensions.regex_scripts` 的读写(PRESET 作用域) |
| `src/endpoints/presets.js` | 服务器端 `/api/presets/*`(save/delete/restore) |
| `src/endpoints/settings.js` | 启动时从目录读取全部 preset 文件 |
| `src/constants.js` + `src/users.js` | preset 存储目录模板 |

> 注:本版本不存在 `presets.js`(public/scripts)、`importPreset/exportPreset`;preset 读写逻辑实际在 `preset-manager.js` 与 `openai.js`。

---

## 1. preset 的完整结构(顶层字段分类)

预设本体是**纯 JSON 对象**,没有明确 typedef,字段来源是 `openai.js:298` 的 `settingsToUpdate`(键为 preset 字段名,值 `[selector, settings字段名, isCheckbox, isConnection]`),配合 `default_settings`(openai.js:403)。分为几类:

### A. 采样器/生成参数
`temperature`→`temp_openai`、`frequency_penalty`→`freq_pen_openai`、`presence_penalty`→`pres_pen_openai`、`top_p`、`top_k`、`top_a`、`min_p`、`repetition_penalty`、`seed`、`n`(openai.js:300-307, 390-391)

### B. 上下文/令牌
`openai_max_context`、`openai_max_tokens`、`max_context_unlocked`(openai.js:353-354, 308)

### C. 格式串(模板字符串)
`wi_format`、`scenario_format`、`personality_format`、`send_if_empty`、`impersonation_prompt`、`new_chat_prompt`、`new_group_chat_prompt`、`new_example_chat_prompt`、`continue_nudge_prompt`、`group_nudge_prompt`(openai.js:356-367)

### D. 行为开关/系统提示相关
`names_behavior`、`stream_openai`、`squash_system_messages`、`assistant_prefill`、`assistant_impersonation`、`use_sysprompt`(由 `claude_use_sysprompt`、`use_makersuite_sysprompt` 迁移而来,openai.js:4189-4190)、`media_inlining`(由 `image_inlining` 迁移)、`inline_image_quality` 等

### E. 提示词系统
`prompts`(数组)、`prompt_order`(数组)、`bias_preset_selected`

### F. 扩展
`extensions`(对象,openai.js:400、508)

### G. 连接类(isConnection=true,默认不随 preset 走)
`chat_completion_source`、`openai_model`、各 `*_model`、`reverse_proxy` 等,受 `bind_preset_to_connection` 控制(openai.js:4925-4927)

`getChatCompletionPreset()`(openai.js:4477-4483)按 `settingsToUpdate` 逐键提取,生成最终写入文件的 preset 对象。

---

## 2. `prompts` 数组结构(Prompt class typedef)

定义在 `public/scripts/PromptManager.js:80-196`:

| 字段 | 类型 | 含义 | 证据 |
|---|---|---|---|
| `identifier` | string | 唯一标识('main'/'nsfw'/'jailbreak'/'charDescription' 等) | :91, :183 |
| `name` | string | 显示名 | :109 |
| `enabled` | boolean | 是否启用(存于 prompt_order,而非 prompt 本体) | :449 |
| `role` | string | 角色:'system'/'user'/'assistant' | :97, :804-808 |
| `content` | string | 内容,支持 `{{macro}}` | :103 |
| `system_prompt` | boolean | 是否系统提示词(不可删除) | :115 |
| `marker` | boolean | 标记型 prompt(占位符,如 chatHistory/dialogueExamples) | :163 |
| `position` | string\|number | 列表中的位置 | :121 |
| `injection_position` | number | 注入位置:`RELATIVE=0`/`ABSOLUTE=1`(PromptManager.js:37-40) | :127 |
| `injection_depth` | number | 绝对注入深度,默认 `DEFAULT_DEPTH=4`(:31) | :133 |
| `injection_order` | number | 同深度内排序,默认 `DEFAULT_ORDER=100`(:32);openai.js:825 组内降序处理 | :139 |
| `injection_trigger` | string[] | 生成类型触发器(如 impersonate/continue),空=全部生效 | :157 |
| `forbid_overrides` | boolean | 禁止被覆盖 | :145 |
| `extension` | boolean | 是否扩展添加,默认 false | :192 |

默认 12 个 prompts 定义于 `chatCompletionDefaultPrompts`(PromptManager.js:2001-2081):main、nsfw、dialogueExamples、jailbreak、chatHistory、worldInfoAfter、worldInfoBefore、enhanceDefinitions、charDescription、charPersonality、scenario、personaDescription。

---

## 3. `prompt_order` 的结构与作用

`prompt_order` 是数组,每项 `{ character_id, order }`(PromptManager.js:1235-1240)。`character_id` 为角色 ID;`order` 为 `{ identifier, enabled }[]` 数组,决定该角色下哪些 prompt 启用及顺序。

- 读取:`getPromptOrderForCharacter()`(PromptManager.js:1207-1209)按 `character_id` 匹配取 `.order`
- 策略 `global` 时用虚拟角色 `dummyId=100000`(PromptManager.js:334-337, 438, 1132)
- 默认顺序 `promptManagerDefaultPromptOrder`(PromptManager.js:2087-2136)
- 缺省注入:`promptManagerDefaultPromptOrders = { prompt_order: [] }`(PromptManager.js:2083-2085)

---

## 4. `extensions` 字段如何读写

核心方法在 `PresetManager` 类(preset-manager.js):

- **读** `readPresetExtensionField({ name, path })`(preset-manager.js:846-866):`name` 缺省用当前选中 preset;若与当前选中相同则读 `settings.extensions`(运行时对象),否则读磁盘 preset 对象的 `.extensions`,用 lodash `get(path)` 取嵌套值。
- **写** `writePresetExtensionField({ name, path, value })`(preset-manager.js:876-901):先写 `settings.extensions` 并 `saveSettings()`,再写磁盘 preset 对象并 `savePreset(..., {skipUpdate:true})`。
- **改名** 时 `PRESET_RENAMED_BEFORE` → 读全部 extensions → rename → 写回(preset-manager.js:1062-1066)。

openai 的 preset 本体通过 `settingsToUpdate.extensions`(openai.js:400)进入 preset 文件;切换 preset 时 `onSettingsPresetChange()` 特殊处理 `extensions`——直接 `oai_settings.extensions = preset.extensions || {}`(openai.js:4929-4933)。

---

## 5. `extensions.regex_scripts` 的角色

regex 扩展的脚本有**三作用域**:GLOBAL / SCOPED(角色)/ PRESET(当前 AI preset),见 `SCRIPT_TYPES`(engine.js)。PRESET 作用域即存储在 preset 的 `extensions.regex_scripts` 字段中。

- **读取**:`getScriptsByType(SCRIPT_TYPES.PRESET)` → `presetManager?.readPresetExtensionField({ path: 'regex_scripts' })`(engine.js:121-128)
- **写入**:`saveScriptsByType(scripts, SCRIPT_TYPES.PRESET)` → `presetManager.writePresetExtensionField({ path: 'regex_scripts', value: scripts })`(engine.js:150-154)
- **运行时合并**:`getRegexScripts()` = GLOBAL + SCOPED + PRESET 三作用域 flatMap 合并(engine.js:99)
- **启用开关**:`extension_settings.preset_allowed_regex[apiId]` 数组(记录允许的 preset 名),`allowPresetScripts`/`disallowPresetScripts`/`isPresetScriptsAllowed` 管理(engine.js:215-259)
- **切 preset 时**:`onPresetChanged`(index.js:1651-1677)与 `onMainApiChanged`(index.js:1679-1694)检测嵌入脚本并触发重载
- **保存/导出**:regex_scripts 直接内嵌在 preset 对象里,随 preset 一起经 `writePresetExtensionField`/`savePreset` 写入,导出时随 preset JSON 整体序列化,无需额外处理

注意:`extension_settings.regex_presets`(index.js:1717-1718)是 regex 扩展**自己的**预设收藏,与 preset 内嵌的 `regex_scripts` 是两回事。

---

## 6. `bias_preset_selected` 与 bias preset

- 默认 `bias_presets = { 'Default (none)': [], 'Anti-bond': [...{id,text,value}...] }`(openai.js:115-123)
- `bias_preset_selected` 记录当前选中的 bias preset 名(openai.js:362, 424)
- 运行时:仅当 `bias_preset_selected` 对应数组非空且来源支持 logit bias 时,计算 `logit_bias = calculateLogitBias()` 注入请求(openai.js:2729-2740, 3307)
- bias preset 的 CRUD 在 openai.js(新增 :4624-4639、导入 :4788-4819、导出 :4824-4836、删除 :4883-4889);直接改 `oai_settings.bias_presets`,不经过 PresetManager。

---

## 7. `extensions.SPreset`、`extensions.tavern_helper`

**本仓库(该版本)源码中不存在这两个标识**。它们是**第三方扩展**写入 preset `extensions` 字段的自定义数据:
- `SPreset` 通常来自角色预设管理类扩展;
- `tavern_helper` 来自名为 "Tavern Helper" 的第三方扩展。

两者都以扩展名为 key 存储在 `extensions` 下,随 preset 一起序列化;遵循通用的 `readPresetExtensionField({path:'SPreset'})`/`writePresetExtensionField` 机制,但本版本代码不含其读写方。

---

## 8. `prompts` 与 Instruct/系统提示的关系

这是两个独立体系,但共同构成最终上下文:

- **`prompts`**:OpenAI 系(preset 内嵌)的可视化 prompt 管理,是主要的内容来源;系统提示拼接逻辑见 openai.js:1722-1726。
- **格式串**是面向特定动作的小模板(openai.js:104-114 定义默认值):
  - `new_chat_prompt`/`new_group_chat_prompt`:新建对话/群聊开场(openai.js:884)
  - `continue_nudge_prompt`:继续生成时的 nudge(openai.js:902,含 `{lastChatMessage}` 宏)
  - `impersonation_prompt`:以 user 身份发言的引导(openai.js:1362)
  - `group_nudge_prompt`:群聊中只扮演 char(openai.js:1361)
  - `send_if_empty`:末条是 assistant 时补充的空消息占位(openai.js:921-922)
  - `wi_format`:世界书条目包装 `{0}` 占位(openai.js:780-792)
  - `scenario_format`/`personality_format`:场景/性格包装(openai.js:1359-1360)
- **Instruct 模板**(`instruct_presets`,instruct-mode.js)与 Context 模板(`context_presets`)是另一套独立 preset 体系,由 `PresetManager.masterSections` 管理(preset-manager.js:117-207),可 "Master Export/Import" 一起导入导出。校验函数 `isPossiblyInstructData` 要求 `['name','input_sequence','output_sequence']`(preset-manager.js:209-212)。

---

## 9. preset 导入导出(JSON 文件)

**存储位置**(src/constants.js:16-48,USER_DIRECTORY_TEMPLATE):
- OpenAI:`<data-root>/<user>/OpenAI Settings/<name>.json`
- Kobold:`KoboldAI Settings`、Novel:`NovelAI Settings`、TextGen:`TextGen Settings`、Instruct:`instruct`、Context:`context`、Sysprompt:`sysprompt`、Reasoning:`reasoning`

**服务器端 API**(src/endpoints/presets.js):
- `POST /api/presets/save`:sanitize 文件名 → 原子写入 `JSON.stringify(preset, null, 4)`(:42-58)
- `POST /api/presets/delete`(:60-81)、`POST /api/presets/restore`(:83-103)
- 启动读取:settings.js:92-116 `readPresetsFromDirectory`,openai 预设经 settings.js:236-238 读取为 `openai_settings`/`openai_setting_names`。

**OpenAI 专属导入导出**(openai.js,不走通用管理器):
- 导出 `onExportPresetClick`(:4744-4786):`structuredClone(openai_settings[...])` → 敏感字段(`sensitiveFields`,:280-292)移除确认 → 可勾选移除连接数据 → 下载 `<presetName>.json`
- 导入 `onPresetImportFileChange`(:4661-4742):文件名做 preset 名 → JSON.parse → 敏感字段处理 → `POST /api/presets/save`

**扩展可介入**:`OAI_PRESET_EXPORT_READY`/`OAI_PRESET_IMPORT_READY` 事件(events.js:39-40)供扩展在导出前/导入后改写 preset(含 extensions)。

---

## 10. 采样器参数名称映射(下划线 ↔ oai_settings)

核心映射表 `settingsToUpdate`(openai.js:298-401):

| preset 字段(下划线) | oai_settings 变量 | 证据 |
|---|---|---|
| `temperature` | `temp_openai` | :300 |
| `frequency_penalty` | `freq_pen_openai` | :301 |
| `presence_penalty` | `pres_pen_openai` | :302 |
| `top_p` | `top_p_openai` | :303 |
| `top_k` | `top_k_openai` | :304 |
| `top_a` | `top_a_openai` | :305 |
| `min_p` | `min_p_openai` | :306 |
| `repetition_penalty` | `repetition_penalty_openai` | :307 |
| `seed` | `seed` | :390 |
| `n` | `n` | :391 |

默认值见 `default_settings`(openai.js:405-412):`temp_openai:1.0, freq_pen_openai:0, pres_pen_openai:0, top_p_openai:1.0, top_k_openai:0, min_p_openai:0, top_a_openai:0, repetition_penalty_openai:1`。

---

## 补充:一条完整的数据流

1. **保存**:UI 编辑 → `oai_settings` 更新 → `saveOpenAIPreset` → `getChatCompletionPreset` 提取(含 `extensions`)→ `POST /api/presets/save` → 写 `<OpenAI Settings>/<name>.json`(presets.js:56)。
2. **切换**:下拉 change → `onSettingsPresetChange` → clone preset → `OAI_PRESET_CHANGED_BEFORE`(PromptManager 在此做 main/nsfw/jailbreak 迁移,:73-75)→ 按 `settingsToUpdate` 应用(extensions 直接覆盖)→ `OAI_PRESET_CHANGED_AFTER`。
3. **扩展字段**:扩展用 `readPresetExtensionField`/`writePresetExtensionField` 以 lodash path 读写 preset 内 `extensions.*`(如 `regex_scripts`),同时写 `settings.extensions`(当前会话)+ 磁盘 preset 文件。
