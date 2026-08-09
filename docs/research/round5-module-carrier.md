# RisuAI 模块(RisuModule)系统调研报告 — Round 5

日期:2026-08-09
来源:子代理源码调研(`rius/risuai-src`)
范围:RisuModule 完整接口、可承载内容、启用/Apply 机制、导入导出格式、运行时消费、执行优先级、注意事项

**结论先行**:一个模块可同时承载 正则脚本(`regex`)、触发器(`trigger`)、世界书(`lorebook`)、资产(`assets`)、prompt 模板切换(`customModuleToggle`)、背景嵌入(`backgroundEmbedding`)与 MCP 配置,并有全局/单角色/单聊三级启用方式,支持 `.module`(CharX)、`.risum`(legacy)、`.json` 三种导入导出格式。正则脚本类型与 `char.customscript`、`db.presetRegex` 完全同构(`customscript[]`),是 Tavern 正则转换产物的理想容器。**注意:没有 `enableByDefault` / `dependencies` / `variables` 这三个字段。**

---

## 1. RisuModule 完整接口

**权威定义:`src/ts/process/modules.ts:19-35`**

```ts
export interface RisuModule{
    name: string
    description: string
    lorebook?: loreBook[]
    regex?: customscript[]
    cjs?: string                    // 声明但运行时无任何消费点(死字段)
    trigger?: triggerscript[]
    id: string
    lowLevelAccess?: boolean
    hideIcon?: boolean
    backgroundEmbedding?: string
    assets?:[string,string,string][]
    namespace?:string
    customModuleToggle?:string
    mcp?:MCPModule                   // { url: string } (modules.ts:15-17)
    icon?:string
}
```

API 插件文档副本:`src/ts/plugins/apiV3/risuai.d.ts:319-348`。DB 存储:`database.svelte.ts:1017-1018`(`modules: RisuModule[]` / `enabledModules: string[]`)。

---

## 2. 模块可承载的内容(逐字段)

| 内容 | 字段 | 类型定义位置 | 运行时消费 |
|---|---|---|---|
| 正则脚本 | `regex` | `customscript` @ `database.svelte.ts:1307-1315` | `getModuleRegexScripts` |
| 世界书 | `lorebook` | `loreBook` @ `database.svelte.ts:1319-1340` | `getModuleLorebooks` |
| 触发器 | `trigger` | `triggerscript` @ `triggers.ts:20-26` | `getModuleTriggers` |
| 资产 | `assets` | `[string,string,string][]`(名/assetId/扩展名) | `getModuleAssets` |
| 模板切换变量 | `customModuleToggle` | string | `getModuleToggles` |
| 背景嵌入 | `backgroundEmbedding` | string | `moduleUpdate` |
| MCP | `mcp` | `{url}` | `getModuleMcps` |
| CJS 脚本 | `cjs` | string | **无(死字段)** |
| 自定义变量 | — | **无专用字段** | 变量需经触发器 setvar / toggle / embedding 表达 |

模块编辑器 `src/lib/Setting/Pages/Module/ModuleMenu.svelte:151-195` 的 5 个标签页(BasicInfo / LoreBook / RegexScript / TriggerScript / AdditionalAssets)证实这些内容可在同一模块内同时编辑、并存。`customscript` 字段结构(与 presetRegex/char.customscript 完全一致,`scripts.ts:134` 直接拼接即证):

```ts
export interface customscript{
    comment: string;
    in:string; out:string; type:string;
    flag?:string; ableFlag?:boolean;
}
```
(`database.svelte.ts:1307-1315`)—— **与 Tavern 转换产物所需的 in/out/type/flag 完全对齐。**

---

## 3. 启用机制与 Apply

**模块收集 `getModules`:`modules.ts:398-427`**。收集顺序:全局 `db.enabledModules` → 当前 chat 的 `chat.modules` → 角色的 `character.modules` → persona 内嵌 `embeddedModule.id` → `db.moduleIntergration`(逗号分隔串)。按 id **或 namespace** 匹配:`getModuleByIds` @ `modules.ts:374-381`:

```ts
const modules = db.modules.filter(m =>
    idSet.has(m.id) || (m.namespace && idSet.has(m.namespace))
)
```

**"Apply 到角色"按钮** `applyModule` @ `modules.ts:510-548`(UI 挂载于 `CharConfig.svelte:1257`):把内容**永久拷贝**进角色——

```ts
if (module.lorebook) for (const lore of module.lorebook) currentChar.globalLore.push(lore)   // :529-533
if (module.regex)    for (const regex of module.regex)    currentChar.customscript.push(regex) // :534-538
if (module.trigger)  for (const trigger of module.trigger) currentChar.triggerscript.push(trigger) // :539-543
```

注意 Apply 是"写进角色卡"的一次性操作;而**启用模块**(`enabledModules`)是引用式生效,内容不进角色卡。

**副作用 `moduleUpdate`:`modules.ts:552-583`** —— `hideIcon`、`backgroundEmbedding`、模块集合变化时 `ReloadGUIPointer+1` 重载 GUI。

---

## 4. 开关 / 依赖 / 命名空间

- **`enableByDefault`、`dependencies`:不存在于该版本接口。** 全库 grep 仅命中无关的 `models/local.ts:50`。
- 全局启用:`db.enabledModules`(`database.svelte.ts:1018`),按钮切换 `ModuleSettings.svelte:83-89`。
- 角色级:`character.modules?:string[]`(`database.svelte.ts:1493`)、群聊 `groupChat.modules`(:1575)、单聊 `chat.modules`(:1828)—— 均被 `getModules` 拼接(:404-409)。
- 命名空间:`db.moduleIntergration: string`(`database.svelte.ts:1085`,设置页 `BotSettings.svelte:772-773`),逗号分隔,匹配模块的 `namespace` 字段:`modules.ts:413-416`、`ModuleSettings.svelte:77-79`。一个 namespace 可让批量模块一键启用。

---

## 5. 导入 / 导出格式(一个模块=完整 preset)

- **新格式 `.module`(CharX 卡片)** `exportModule` @ `modules.ts:37-59`:经 `convertModuleToCharacter`(`interchangeability.ts:6-51`)转成角色卡,用 `exportCharacterCard` 写 charx v3。模块导出到角色卡时,desc/firstMessage/PHI 会转成带 `@@indicator` 前缀的 constant 条目(`interchangeability.ts:71-114`),反向导入时可还原。
- **旧格式 `.risum`(二进制)** `exportModuleLegacy` @ `modules.ts:61-123`:magic byte `111` + version `0` + RPack 压缩 JSON `{type:'risuModule', module}` + 逐条 RPack 压缩资产。读取端 `readModule` @ `modules.ts:125-254`。
- **JSON** `importModule` @ `modules.ts:256-355` 支持:`.charx`、`.risum`、裸 `risuModule` JSON、Risu 世界书导出(`type:'risu'`+数组)、外部世界书(`entries`)、正则导出(`type:'regex'`, `:339-349`,自动包成 module)。
- 模块内**同时**携带 regex+trigger+lorebook+assets 是官方支持形态:`interchangeability.ts:53-117`(`convertCharacterToModule` 一次搬走 globalLore/customscript/triggerscript/additionalAssets),`characterCards.ts:1489-1504` 导出角色为模块时同样把三种内容一起打包。

---

## 6. 运行时消费(合并点)

| 函数 | 定义 | 调用/合并处 |
|---|---|---|
| `getModuleRegexScripts` | `modules.ts:476-488` | `scripts.ts:134`(正则管线) |
| `getModuleLorebooks` | `modules.ts:430-442` | `lorebook.svelte.ts:81-82`;`cbs.ts:327`(`{{lorebook}}` 变量);`scriptings.ts:739`;`parser.svelte.ts:1018` |
| `getModuleTriggers` | `modules.ts:459-474`(把 `module.lowLevelAccess` 注入每个 trigger,:467-469) | `triggers.ts:1084`;`scriptings.ts:1389-1392`(Lua edit)、:1417-1420(按钮触发) |
| `getModuleAssets` | `modules.ts:444-456` | `scripts.ts:353-358`(动态资产相似度检索);`parser.svelte.ts:15` |
| `getModuleToggles` | `modules.ts:490-502` | `Toggles.svelte:65`;`index.svelte.ts:269`(`parseToggleSyntax`) |
| `getModuleMcps` | `modules.ts:504-508` | `process/mcp/mcp.ts:25` |
| 插件只读 API | — | MCP risuaccess `modules.ts:649-673` |

---

## 7. 执行优先级

**正则(scripts.ts:134,核心答案):**

```ts
const scripts = (db.presetRegex ?? []).concat(char.customscript).concat(getModuleRegexScripts())
```

顺序 = `presetRegex`(全局)→ `char.customscript`(角色)→ `模块 regex`(最后)。三者进同一份 `pScript[]` 队列,按 `flag` 里的 `order N` 元标记重排执行(`scripts.ts:296-334`),因此模块正则可用 `<order 100>` 之类调整相对顺序。

**触发器:** 角色 `triggerscript` 在前,模块触发器拼接在后:`triggers.ts:1081-1084`;`scriptings.ts:1392,1420`。

**世界书:** `characterLore` → `chatLore` → `moduleLorebook`:`lorebook.svelte.ts:82`、`cbs.ts:327`。

---

## 8. 注意事项(针对"打包转换产物")

1. **`cjs` 是死字段**:接口里声明了(`modules.ts:24`),但全库无消费点,转换产物不要依赖它。
2. **无 `variables` 字段**:Tavern 的自定义变量若需随模块分发,应打包进**触发器 setvar effect**、`customModuleToggle`(prompt 模板开关),或 `backgroundEmbedding`。
3. **无依赖/版本字段**:模块间不能声明依赖关系,只有"全局/角色/聊天/namespace"四类启用方式;多 preset 模块共存靠 `<order>` 元标记保证正则顺序。
4. **模块 regex 优先级最低**(默认),但执行序可被 `<order>` 覆盖;模块触发器/世界书始终追加在角色内容之后。
