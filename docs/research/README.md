# research/ 研究文档索引

日期:2026-08-09 统合
结构:round1-2 为**双侧合一篇**(RisuAI↔SillyTavern 按主题对照);round3-4 保留两侧分篇;round5 为转换形态专项;round6+ 为权威源(规格/能力全景/审计/运行时实证)。**round1-4 综合对比版已归档至 `archive/`**,其内容由权威源 + 两侧调研承载。

## 权威源(优先读,决策/规格)

| 文件 | 内容 |
|---|---|
| `round6-converter-spec.md` | **转换器规格**(实现直接依据):字段映射、prompt 映射、正则 13 字段规则、宏翻译表、差异报告、边界 |
| `round6-risu-capabilities.md` | Risu 能力全景:触发器/世界书/正则/模块/打包,跨子系统决策 |
| `round7-customprompttemplate-toggle.md` | 自定义 prompt 模板开关(toggle)子系统 |
| `round8-risu-source-audit.md` | 源码审计:已核实/待核实结论清单 |
| `round9-risu-chatvar-runtime.md` | `{{setvar}}` 运行时门控实证(runVar),推翻"A 直通" |

## 双侧调研 / 证据层

| 轮 | 文件 | 说明 |
|---|---|---|
| round1 正则 | `round1-risu-tavern-regex.md` | RisuAI↔SillyTavern 正则系统双侧对照(数据结构/模式/flags/替换/作用域/联动/排序) |
| round2 宏 | `round2-risu-tavern-macros.md` | Risu CBS↔Tavern 宏系统双侧对照(171 宏清单 ‖ Tavern 七组清单、语法/引擎/变量作用域/转义) |
| round3 世界书/注入 | `round3-risu-lorebook-injection.md` + `round3-tavern-worldinfo-injection.md` | 两侧架构分叉大,维持分篇(双侧对比视图见 `archive/round3-lorebook-injection.md`) |
| round4 preset | `round4-risu-preset.md`(botPreset ~80 字段 schema)+ `round4-tavern-preset.md` | 结构对称、内容零重叠,维持分篇(对照见 `round6-converter-spec.md` §3) |
| round5 转换形态 | `round5-module-carrier.md`(RisuModule)、`round5-trigger-alternative.md`(触发器)、`round5-tradeoff-alternatives.md`(12 正则实测+深度 OUT 公式) | tradeoff 为决策层(§7 被 round6/DESIGN 按节号引用),必须独立;module+trigger 同属证据层 |

## 归档(`archive/`)

round1-4 综合对比版(约 90% 为两侧调研+权威源的浓缩重述):`round1-regex.md`、`round2-macros.md`、`round3-lorebook-injection.md`、`round4-preset-conversion.md`。其独有信息已迁移:
- round4 转换缺口(`injection_trigger`/`forbid_overrides`/nudge 系列/Instruct 单独转换)→ `round6-converter-spec.md` §3
- 其余对比洞察由两侧调研承载。

> 迁移/归档为 git 可回退操作;历史分析可直接看 `archive/` 对应文件。
