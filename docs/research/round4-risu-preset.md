# RisuAI bot preset 数据结构与读写逻辑调研报告 — Round 4

日期:2026-08-09
来源:子代理源码调研(`rius/risuai-src`)
范围:botPreset 完整类型、regex 存取、promptTemplate、formatingOrder、bias、seperateParameters/Models、image、API 字段、moduleIntergration 等

核心文件:
- 类型定义/读写逻辑:`src/ts/storage/database.svelte.ts`(2556 行)
- Prompt 模板卡片类型:`src/ts/process/prompt.ts`
- 运行时拼 prompt:`src/ts/process/index.svelte.ts`

---

## 1. botPreset 完整类型定义

位置:`src/ts/storage/database.svelte.ts:1580-1683`

```ts
export interface botPreset{
    name?:string                      // 预设名
    apiType?: string                  // API 类型标识
    openAIKey?: string                // OpenAI 密钥(导出时清空)
    localNetworkMode?: boolean        // 本地网络模式
    localNetworkTimeoutSec?: number
    mainPrompt: string                // 主提示词(legacy 字段)
    jailbreak: string                 // 越狱提示词
    globalNote:string                 // 全局备注
    temperature: number               // 采样温度(内部 ×100 存储)
    maxContext: number                // 最大上下文 token
    maxResponse: number               // 最大回复 token
    frequencyPenalty: number
    PresensePenalty: number
    formatingOrder: FormatingOrderItem[]   // 旧版 prompt 排列顺序
    aiModel?: string                  // 主模型
    subModel?:string                  // 子模型(辅助/AX 任务)
    currentPluginProvider?:string
    textgenWebUIStreamURL?:string     // Ooba 流式 URL
    textgenWebUIBlockingURL?:string   // Ooba 非流式 URL
    forceReplaceUrl?:string           // 强制替换请求 URL
    forceReplaceUrl2?:string
    promptPreprocess: boolean
    bias: [string, number][]          // bias 数组
    proxyRequestModel?:string
    openrouterRequestModel?:string
    proxyKey?:string
    ooba: OobaSettings                // Ooba 采样参数
    ainconfig: AINsettings            // NovelAI 旧版参数
    koboldURL?: string                // KoboldAI URL
    NAISettings?: NAISettings         // NovelAI 新版参数
    autoSuggestPrompt?: string
    autoSuggestPrefix?: string
    autoSuggestClean?: boolean
    promptTemplate?:PromptItem[]      // 新版 prompt 模板
    NAIadventure?: boolean
    NAIappendName?: boolean
    localStopStrings?: string[]
    customProxyRequestModel?: string
    reverseProxyOobaArgs?: OobaChatCompletionRequestParams
    top_p?: number
    promptSettings?: PromptSettings
    repetition_penalty?:number
    min_p?:number
    top_a?:number
    openrouterProvider?: { order: string[]; only: string[]; ignore: string[] }
    useInstructPrompt?:boolean        // 是否用 instruct 格式
    customPromptTemplateToggle?:string
    templateDefaultVariables?:string
    moduleIntergration?:string        // 逗号分隔模块命名空间
    top_k?:number
    instructChatTemplate?:string      // 如 "chatml"
    JinjaTemplate?:string
    jsonSchemaEnabled?:boolean
    jsonSchema?:string
    strictJsonSchema?:boolean
    extractJson?:string
    groupTemplate?:string
    groupOtherBotRole?:string
    seperateParametersEnabled?:boolean
    seperateParameters?:{...}
    customAPIFormat?:LLMFormat
    systemContentReplacement?: string
    systemRoleReplacement?: 'user'|'assistant'
    enableCustomFlags?: boolean
    customFlags?: LLMFlags[]
    image?:string                     // 预设图标(data URL)
    regex?:customscript[]             // 正则脚本
    reasonEffort?:number
    thinkingTokens?:number
    thinkingType?: 'off'|'budget'|'adaptive'
    deepseekThinkingType?: 'off'|'enabled'
    adaptiveThinkingEffort?: 'low'|'medium'|'high'|'xhigh'|'max'
    deepseekReasoningEffort?: 'high'|'max'
    outputImageModal?:boolean
    seperateModelsForAxModels?:boolean
    seperateModels?:{ memory; emotion; translate; otherAx: string }
    modelTools?:string[]
    fallbackModels?: {...}
    fallbackWhenBlankResponse?: boolean
    verbosity?:number
    dynamicOutput?:DynamicOutput
}
```

读写入口:
- **导出** `saveCurrentPreset()` — `database.svelte.ts:2034-2133`,把当前 `db` 各字段打平写入 `db.botPresets[id]`。
- **载入** `setPreset(db, newPres)` — `database.svelte.ts:2155-2273`,逐字段 `newPres.x ?? db.x` 还原。
- **默认值模板** `presetTemplate` — `database.svelte.ts:1985-2018`。
- **导入** `importPreset()` — `database.svelte.ts:2338-2502`(支持 json / .risupreset / ST / NAI 格式)。

---

## 2. `regex` 字段的存取与 `db.presetRegex`

- 类型:`regex?:customscript[]`(`database.svelte.ts:1657`);`customscript` 定义于 `database.svelte.ts:1307-1315`:

```ts
export interface customscript{
    comment: string;   // 注释说明
    in:string          // 正则匹配模式
    out:string         // 替换内容
    type:string        // editinput / editoutput / editprocess / editdisplay
    flag?:string       // 正则 flag(默认 'g')
    ableFlag?:boolean  // 是否启用自定义 flag
}
```

- **导出**:`saveCurrentPreset` 中 `regex: db.presetRegex`(`database.svelte.ts:2104`)。
- **载入**:`setPreset` 中 `db.presetRegex = newPres.regex ?? []`(`database.svelte.ts:2229`)。
- **DB 字段**:`Database.presetRegex: customscript[]`(`database.svelte.ts:1134`);默认初始化 `data.presetRegex ??= []`(`database.svelte.ts:427`)。
- **运行时消费**:`src/ts/process/scripts.ts:134`:

```ts
const scripts = (db.presetRegex ?? []).concat(char.customscript).concat(getModuleRegexScripts())
```

执行逻辑在 `scripts.ts:152-174`(按 `script.type === mode` 匹配,用 `in` 正则对文本替换为 `out`)。UI 绑定见 `BotSettings.svelte:788`(`<RegexList bind:value={DBState.db.presetRegex} .../>`)。

---

## 3. `promptTemplate` 的数据结构与排列顺序

- 类型:`promptTemplate?:PromptItem[]`(`database.svelte.ts:1614`)。
- `PromptItem` 联合类型定义于 `src/ts/process/prompt.ts:7-66`:

```ts
export type PromptItem = PromptItemPlain|PromptItemTyped|PromptItemChat|PromptItemAuthorNote|PromptItemChatML|PromptItemCache

// 普通文本卡(text 直接进 prompt)
interface PromptItemPlain {
    type: 'plain'|'jailbreak'|'cot';
    type2: 'normal'|'globalNote'|'main'   // 特殊槽位标记
    text: string; role: PromptRole; name?: string
}
interface PromptItemChatML  { type: 'chatML'; text: string; name?: string }

// 区块槽位卡(运行时自动填充角色/知识库内容)
interface PromptItemTyped {
    type: 'persona'|'description'|'lorebook'|'postEverything'|'memory'
    innerFormat?: string; role2?: PromptRole; name?: string
}
interface PromptItemAuthorNote {
    type : 'authornote'; innerFormat?: string; defaultText?: string; role2?: PromptRole; name?: string
}

// 聊天历史卡(按 range 切片)
interface PromptItemChat {
    type: 'chat'; rangeStart: number; rangeEnd: number|'end';
    chatAsOriginalOnSystem?: boolean; name?: string
}
interface PromptItemCache { type: 'cache'; name: string; depth: number; role: 'user'|'assistant'|'system'|'all' }
```

- **载入规范化**:`normalizePromptTemplate()`(`database.svelte.ts:2524-2556`)——`setPreset`(2186)和 `importPreset`(2364-2366)都会调用,将 `role/role2/cache.role` 归一化(如 `assistant/char` → `bot`)。
- **与 formatingOrder 的关系**:**互斥二选一**。当 `promptTemplate` 存在时,prompt 顺序**由模板卡数组顺序决定**,`formatingOrder` 被忽略。运行时证据:
  - 模板分支:`index.svelte.ts:1271-1462` `if(promptTemplate){ for(const card of template){...} }`
  - 旧版分支:`index.svelte.ts:1463-1468` `else{ for(... formatOrder) { pushPrompts(unformated[formatOrder[i]]) } }`
  - 模板缺失时会自动补一张 `postEverything` 卡:`index.svelte.ts:364-378`。
- 每类卡在 `index.svelte.ts:688-819` 的 `switch(card.type)` 中分别处理。
- 模板合法性校验 `templateCheck()`(`src/ts/process/templates/templateCheck.ts:3-81`):要求恰好 1 个 `type2==='main'`、1 个 `type2==='globalNote'`、有 description、lorebook、以及一个 `rangeEnd==='end'` 的 chat 卡。

---

## 4. `formatingOrder` 取值集合与默认顺序

- 取值集合(`database.svelte.ts:1813`):

```ts
export type FormatingOrderItem = 'main'|'jailbreak'|'chats'|'lorebook'|'globalNote'|'authorNote'|'lastChat'|'description'|'postEverything'|'personaPrompt'
```

- 默认顺序(`database.svelte.ts:1999`):

```ts
formatingOrder: ['main', 'description', 'personaPrompt','chats','lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote']
```

- 运行时总会附加 `postEverything` 到末尾:`index.svelte.ts:1222-1225` `formatOrder.push('postEverything')`。
- 仅当 `!promptTemplate` 时生效(`index.svelte.ts:1463-1468`)。

---

## 5. `bias` 结构

- 类型:`bias: [string, number][]`(`database.svelte.ts:1603`)。每项 = `[要偏置的文本/标记, 权重]`。
- 运行时:与角色 bias 合并 → 分词 → 填入 `logit_bias`:
  - `index.svelte.ts:1156` `DBState.db.bias.concat(currentChar.bias).map(...)`
  - `src/ts/process/request/openAI/requests.ts:185-200`(tokenize 后 `arg.bias[num] = bia[1]`),最终发送 `logit_bias: arg.bias`(`requests.ts:386`)。

---

## 6. `seperateParameters` / `seperateModels`

**seperateParameters**(`database.svelte.ts:1644-1650`):
```ts
seperateParameters?:{
    memory: SeparateParameters, emotion: SeparateParameters,
    translate: SeparateParameters, otherAx: SeparateParameters,
    overrides: Record<string, SeparateParameters>   // 按模型 id 细分
}
```
`SeparateParameters`(`database.svelte.ts:1286-1303`):`temperature/top_k/repetition_penalty/min_p/top_a/top_p/frequency_penalty/presence_penalty/reasoning_effort/thinking_tokens/thinking_type/deepseek_thinking_type/adaptive_thinking_effort/deepseek_reasoning_effort/outputImageModal/verbosity`。

- 导出:`seperateParametersEnabled`(2097)、`seperateParameters: safeStructuredClone(db.seperateParameters)`(2098);载入:2223 设开关、2260-2266 默认空对象。
- 按模式应用:`src/ts/process/request/shared.ts:179-229`——当 `seperateParametersEnabled` 时按 `modelMode`(model/submodel/memory/emotion/translate/otherAx)取对应参数覆盖采样值。

**seperateModels**(`database.svelte.ts:1666-1671`):
```ts
seperateModels?:{ memory: string; emotion: string; translate: string; otherAx: string }
```
- 按模式选模型:`src/ts/process/request/request.ts:442-447`——当 `db.seperateModelsForAxModels` 时用 `db.seperateModels[model]` 替换 `aiModel`。

---

## 7. `image` 字段

- 类型:`image?:string`(`database.svelte.ts:1656`)。
- 语义:**预设的图标**(不是图像生成配置),存一张很小的 base64 JPEG data URL(48×48)。导出读回 `image: pres?.[db.botPresetsId]?.image ?? ''`(2105);UI 上传压缩(`BotSettings.svelte:805-821`)。
- 注意:图像生成参数是独立的 `NAIImgConfig`(`database.svelte.ts:1713-1747`),**不属于 botPreset**。

---

## 8. `mainPrompt` / `jailbreak` / `globalNote` 与 promptTemplate 的关系

**结论:它们是"旧版直接字段",与 promptTemplate 是两套并列方案,不是 promptTemplate 的快捷入口。**

- preset 中始终同时存在两组字段。`setPreset` 无条件同时还原(`db.mainPrompt = newPres.mainPrompt ?? ...`(2159-2161)、`db.promptTemplate = normalizePromptTemplate(...)`(2186))。
- **运行时只取其一**:
  - 无模板时,`mainPrompt/jailbreak/globalNote` 直接拼入:`index.svelte.ts:410-440`(`formatPrompt` 转成 `@@system` 结构)。
  - 有模板时,等价槽位是 `type2: 'main'` 与 `type2: 'globalNote'` 的 plain 卡(`prompt.ts:22-28`),文本直接在卡片上编辑。
- **UI 上二者互斥**:`BotSettings.svelte:829` `{#if !DBState.db.promptTemplate}` 才显示 mainPrompt/jailbreak/globalNote/formatingOrder 编辑区;打开"使用模板"时 `promptTemplate = []`(720-721)。
- 唯一的外部格式转换:ST 预设经 `stChatConvert` 生成模板卡(`prompt.ts:156-253`);`setPreset` 本身原样载入两者。

---

## 9. API 相关字段

| 字段 | 类型/位置 | 作用 |
|---|---|---|
| `NAISettings` | `src/ts/process/models/nai.ts:53-70` | NovelAI 采样参数(topK/topP/topA/tailFreeSampling/repetitionPenalty/Range/Slope/frequencyPenalty/presencePenalty/typicalp/starter/mirostat_lr/cfg_scale 等)。载入补默认 `cfg_scale=1/mirostat_tau=0/mirostat_lr=1`(2189-2191) |
| `ooba` | `OobaSettings`,`database.svelte.ts:1901-1933` | TextGenWebUI/Ooba 采样参数 + `formating{header,systemPrefix,userPrefix,assistantPrefix,seperator,useName}` |
| `ainconfig` | `AINsettings`,`database.svelte.ts:1889-1899` | NovelAI 旧版参数(top_p/rep_pen/top_a/rep_pen_slope/rep_pen_range/typical_p/badwords/stoptokens/top_k) |
| `koboldURL` | `string`(1609) | KoboldAI 实例 URL |
| `reverseProxyOobaArgs` | `OobaChatCompletionRequestParams`,`src/ts/model/ooba.ts:1-47` | 反代 Ooba 请求参数,`mode: 'instruct'|'chat'|'chat-instruct'` + turn_template/采样项 |
| `openrouterProvider` | `{order, only, ignore}`(1625-1629) | OpenRouter 模型路由过滤 |
| `openrouterRequestModel`/`proxyRequestModel`/`proxyKey`/`customProxyRequestModel`/`forceReplaceUrl`/`textgenWebUIStreamURL`/`textgenWebUIBlockingURL` | string | 对应各 API 模型名/密钥/URL。导出时清空敏感项(2294-2299) |

---

## 10. `moduleIntergration` / `templateDefaultVariables` / `customFlags` / `enableCustomFlags`

- **`moduleIntergration`**(string,1633):逗号分隔的模块命名空间,预设级激活模块。运行时 `src/ts/process/modules.ts:413-416`:`db.moduleIntergration.split(',').map(s=>s.trim())` 追加到模块 id 列表。
- **`templateDefaultVariables`**(string,1632):预设级默认模板变量(`key=value` 文本,可多行)。运行时并入全局变量:`src/ts/parser/chatVar.svelte.ts:15`、`src/ts/process/triggers.ts:1086` 均 `parseKeyValue(char.defaultVariables).concat(parseKeyValue(DBState.db.templateDefaultVariables))`。
- **`customFlags` / `enableCustomFlags`**(1655/1654):`enableCustomFlags` 总开关;`customFlags: LLMFlags[]` 为能力位标记数组。`LLMFlags` 枚举见 `src/ts/model/types.ts:3-31`(hasImageInput/hasImageOutput/hasStreaming/hasPrefill/hasCache/claudeThinking/deepSeekThinking… 0-26)。

---

## 附:关键读写链路小结

- 导出:`saveCurrentPreset()`(2034)→ 组装 `botPreset` 字面量(2041-2120)→ 写回 `db.botPresets[id]`(2126-2132)。
- 载入:`setPreset(db, newPres)`(2155)逐字段回写 DB(216-2272)。
- 下载:`downloadPreset()`(2289-2313):json 用 `JSON.stringify`;risupreset 用 `msgpack + fflate 压缩 + encryptBuffer`(带 `presetVersion: 2`)。
- 导入:`importPreset()`(2338-2502):json 分支 `{...presetTemplate, ...parsed}` 合并且规范化 promptTemplate(2361-2366)。
