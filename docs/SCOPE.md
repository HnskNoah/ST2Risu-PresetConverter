# 转换范围:SillyTavern 预设的哪些部分要"管"

> 依据真实预设盘点(此间小镇 1.6:顶层 45 键、prompts 98 个、regex_scripts 12 个)。
> 原则:每部分要么**转换**、要么**报告**(dropped/manual/degraded),绝不静默忽略(GOALS 第 4 条)。

## 一、转换(高价值,已实现或已排期)

| # | 部分 | 状态 | 说明 |
|---|---|---|---|
| 1 | 采样参数 + 上下文/输出长度 | ✅ 已实现 | temperature/penalty/top_p/k/a/min_p/rep_penalty/maxContext/maxResponse |
| 2 | prompts + prompt_order → promptTemplate | ✅ 基础版 | 任意 identifier(含 UUID 自定义块)降级 plain 卡,保真文本/角色/顺序/启用态 |
| 3 | 正则脚本 → customscript | ✅ M2 已实现 | 13 字段决策树 |
| 4 | 宏翻译 | ✅ M3 已实现 | A 直通/B 同名不同义/C 翻译/D 未知透传(`macroTable.ts`);`{{setglobalvar}}`→manual(Risu 无此宏) |
| 5 | 正则深度过滤 | ✅ M3 已实现 | minDepth/maxDepth → OUT `{{#if}}` 守卫 + `<cbs>` + in 吞换行(round5 §7);`{{chatindex}}=-1` 边界报 degraded |
| 6 | setvar/addvar/incvar/decvar → start 触发器 | ✅ round10 已实现 | `mapTriggers.ts` 提取为 start 触发器 setvar effect(每次 prompt 构建前执行),从卡文本剔除宏;嵌套宏值用 `setvarParse.ts` 平衡解析提取。输出 `<base>.module.json`(risuModule)。详见 DESIGN #14、docs/research/round10-risu-triggers.md |
| 7 | 变量卡组 → customPromptTemplateToggle | ✅ round11 已实现 | ST"开关卡"=候选卡组+enabled 快照;`mapToggles.ts` → select 保留全部选项,消费点 `{{getvar::X}}` → N 分支 if 内容注入(默认项 or-null 兜底),写入 `preset.customPromptTemplateToggle`;toggle 化变量从触发器排除。详见 DESIGN #15、docs/research/round11-risu-toggle.md |
| 7b | instruct 模式三件套 | ✅ round17 已实现 | ST instruct preset(`--instruct <file>` 第二输入,或主预设顶层 `instruct` 块)→ `useInstructPrompt` + `instructChatTemplate='jinja'` + `JinjaTemplate`(官方 prompt.ts 算法蓝本;修复官方 first/last_output_sequence 丢弃与 story_string 预处理误删)。详见 docs/research/round17-instruct-mode.md |
| 7c | disabled prompt 卡(孤立) | ✅ round18 已实现 | ST 关掉的卡(无 setvar 变量,如破限示例/提示卡)→ 默认关闭的开关 toggle + 守卫卡(开启才注入),让用户可在 Risu 重新打开;含 `{{setvar::` 的变量组候选归 toggle 不重复。详见 docs/research/round18-disabled-switches.md |

## 二、待决策(需要拍板方向)

| # | 部分 | 现状问题 |
|---|---|---|
| 8 | **prompt_order 多角色** | ~~ST 可含多条 prompt_order(按 character_id);Risu 是单模板。~~ **已决(2026-08-09):只转换 `prompt_order[0]`,其余不管**。真实预设(此间小镇)仅 1 条,多角色场景不投入。 |
| 9 | **顶层行为字符串** | **已决(2026-08-09 调研定稿)**。Risu 这些提示词全部硬编码、无 botPreset 字段:① `continue_postfix` → `promptSettings.postEndInnerFormat`(degraded:每次生成追加,非仅续写);② `assistant_prefill` → 官方 stChatConvert 同款 postEverything 卡 + `{{#if {{prefill_supported}}}}`(mapPrompts 已实现);③ `continue_nudge_prompt`/`impersonation_prompt`/`continue_prefill` 有值时 manual(带具体语义理由:续写提示硬编码、无非真名检测、无 prefill 字段);④ `new_chat_prompt`/`new_group_chat_prompt`/`new_example_chat_prompt`/`group_nudge_prompt`/`send_if_empty` 空值忽略不报噪音。 |
| 10 | **思考参数** | **已决(2026-08-09):v1 报告 manual,不转换**。`reasoning_effort / show_thoughts` → mapFields manual 报告,待调研 Risu 思考参数映射。 |
| 11 | **格式模板** | `wi_format / scenario_format / personality_format` → scenario_format 已用于 description 卡 innerFormat;`wi_format` 未消费 → manual 报告。 |

## 三、忽略(报告即可,不转换)

| 部分 | 处理 | 状态 |
|---|---|---|
| 平台开关:stream_openai / seed / n / max_context_unlocked / squash_system_messages / names_behavior / wrap_in_quotes / image_inlining / video_inlining / inline_image_quality / use_sysprompt / function_calling / enable_web_search / request_images | dropped | ✅ 已实现(mapFields DROPPED_NO_EQUIVALENT) |
| 插件扩展:extensions.SPreset / extensions.tavern_helper | manual | ✅ 已实现(mapFields 遍历 extensions 子键) |
| 正则脚本 id(内部 UUID) | dropped(单条汇总) | ✅ 已实现(mapRegexes) |
| bias_preset_selected | manual(未提供 ST 全局 bias_presets) | ✅ 已实现 |
| 连接字段:apiType / aiModel(若存在) | manual(Risu 默认连接设置) | ✅ 已实现 |

**补充实现细节(2026-08-09):**
- `charDescription` 若 content 非标准(`≠ {{description}}`):内容并入 description 卡 innerFormat(自定义前缀),并报 `degraded`;与 scenario 合并顺序无关。
- 顶层未知键(不在消费/报告白名单且有值)→ `manual`,不静默忽略。

## 四、明确排除(v1 不做)

- **世界书条目本体**:在 character/worldInfo 文件里,preset 只引用;转换器不生成,报告提示用户另行处理。
- **资产文件**:角色卡、背景图等,不在 preset 内。
- 群聊、`edittrans`、`.risup` 容器(架构留扩展位,GOALS §4)。

## 关键事实(从真实预设盘点得出,决定通用性设计)

1. **98 个 prompts 中约 80 个是 UUID 自定义块** —— 转换器必须把"任意 identifier"都处理成卡,不能只认固定槽位;固定槽位(main/charDescription/scenario/chatHistory/…)只是特例优化。
2. **prompt_order 可能多条(per-role)** —— 需决策(见 #6)。
3. **此间小镇预设没有 assistant_prefill**(空串),但保留支持。
4. **深度过滤 + 宏变量系统是这批预设的命脉** —— M3 优先级高于一切后续。
