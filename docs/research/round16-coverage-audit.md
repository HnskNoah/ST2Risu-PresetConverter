# round16: Risu botPreset 完整覆盖度审计

日期:2026-08-10
结论:转换器已覆盖 ST 预设价值主干(81 个 Risu 字段中 19 个高价值全处理)。审计暴露此前"54 项无需处理"的表述错误——该数字混了两种判断。

## 覆盖度(81 个 Risu botPreset 字段)

| 类别 | 数量 | 说明 |
|---|---|---|
| A 已处理 | 20 | 采样(×100)、promptTemplate、regex、toggle、reasonEffort、verbosity、promptSettings |
| B 可映射未做 | 3 | instruct 三件套 + moduleIntergration |
| C 无 ST 对应 | 55 | 连接/密钥/Risu 独有运行态/模型后端专属 |
| D 排除 | 3 | 群聊(groupTemplate/groupOtherBotRole)、图片生成(outputImageModal) |

## 关键修正:"无 ST 对应"的两种含义

此前把 54 项统称"无需处理"误导了判断。实际分两类:

**① ST 导出机制保证不存在(约 50 项,对任意预设成立)**
- 连接字段(`reverse_proxy`/`custom_model`/`apiType`/各模型 URL/key):`openai.js:363` 等标 `isConnection=true`;导出预设时(`openai.js:4925`)默认剔除,除非用户开 `bind_preset_to_connection`。故合规导出的 ST 预设不含这些。
- Risu 独有运行态(ooba/ainconfig/NAISettings/instruct/Jinja/systemContentReplacement/customFlags/seperateParameters 等):ST 无此概念。

**② ST 确有但漏转(round16 修复)**
- `verbosity`:`openai.js:388` 标 `isConnection=false` → **会导出**,每预设必现。此前漏转,被"未知字段"当 manual 报告。
- `tool_call_recurse_limit`/`request_image_aspect_ratio`/`request_image_resolution`:ST 导出、Risu 无等价,归入 dropped(而非"未知字段"manual)。

## verbosity 映射

- ST:`verbosity_levels = { auto, low, medium, high }`(openai.js:246,字符串)
- Risu:`verbosity: number`(database.svelte.ts:1222),UI segmented `0=Low/1=Medium/2=High`(botSettingsParamsData.ts:295)
- 映射:`low→0, medium→1, high→2, auto→1`(auto 语义"由模型决定",Risu 无 auto,映射 medium=1 与 Risu 默认一致)
- 非法值(如 ultra)→ manual 报告,不写入

## 剩余 B 类(可映射但需第二输入或自洽增强)

| 字段 | 阻碍 | 优先级 |
|---|---|---|
| useInstructPrompt + instructChatTemplate + JinjaTemplate | 需要 ST 独立 instruct preset 文件(`instruct/<name>.json`,存 input_sequence/output_sequence 等,instruct-mode.js:29)作为第二输入 | 中,独立设计 |
| moduleIntergration | 转换器自产 setvar 模块 id 写入该字段自动链接(需确认 namespace 匹配) | 低 |

## 验证

- 127 测试全绿:verbosity low/medium/high/auto→0/1/2、非法值 manual、变异 fixture 断言 verbosity。
- V18 真实产物:ST `verbosity:"auto"` → Risu `verbosity:1`。
