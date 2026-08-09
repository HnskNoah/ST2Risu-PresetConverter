# 转换范围:SillyTavern 预设的哪些部分要"管"

> 依据真实预设盘点(此间小镇 1.6:顶层 45 键、prompts 98 个、regex_scripts 12 个)。
> 原则:每部分要么**转换**、要么**报告**(dropped/manual/degraded),绝不静默忽略(GOALS 第 4 条)。

## 一、转换(高价值,已实现或已排期)

| # | 部分 | 状态 | 说明 |
|---|---|---|---|
| 1 | 采样参数 + 上下文/输出长度 | ✅ 已实现 | temperature/penalty/top_p/k/a/min_p/rep_penalty/maxContext/maxResponse |
| 2 | prompts + prompt_order → promptTemplate | ✅ 基础版 | 任意 identifier(含 UUID 自定义块)降级 plain 卡,保真文本/角色/顺序/启用态 |
| 3 | 正则脚本 → customscript | ✅ M2 已实现 | 13 字段决策树 |
| 4 | 宏翻译 | ⏳ M3 | `{{char}}/{{user}}/{{setvar}}/{{getvar}}/{{match}}/{{//}}` 等,顶层字符串+prompt 文本+正则 in/out 统一处理 |
| 5 | 正则深度过滤 | ⏳ M3 | minDepth/maxDepth → 深度 OUT 脚本(三份预设的正则核心功能) |

## 二、待决策(需要拍板方向)

| # | 部分 | 现状问题 |
|---|---|---|
| 6 | **prompt_order 多角色** | ~~ST 可含多条 prompt_order(按 character_id);Risu 是单模板。~~ **已决(2026-08-09):只转换 `prompt_order[0]`,其余不管**。真实预设(此间小镇)仅 1 条,多角色场景不投入。 |
| 7 | **顶层行为字符串** | **已决(2026-08-09):v1 报告 manual,不转换**。`impersonation_prompt / new_chat_prompt / new_group_chat_prompt / new_example_chat_prompt / continue_nudge_prompt / group_nudge_prompt / continue_postfix / continue_prefill / send_if_empty / assistant_impersonation` → mapFields 逐项 manual 报告。 |
| 8 | **思考参数** | **已决(2026-08-09):v1 报告 manual,不转换**。`reasoning_effort / show_thoughts` → mapFields manual 报告,待调研 Risu 思考参数映射。 |
| 9 | **格式模板** | `wi_format / scenario_format / personality_format` → scenario_format 已用于 description 卡 innerFormat;`wi_format` 未消费 → manual 报告。 |

## 三、忽略(报告即可,不转换)

| 部分 | 处理 | 状态 |
|---|---|---|
| 平台开关:stream_openai / seed / n / max_context_unlocked / squash_system_messages / names_behavior / wrap_in_quotes / image_inlining / video_inlining / inline_image_quality / claude_use_sysprompt / use_makersuite_sysprompt / function_calling / enable_web_search / request_images | dropped | ✅ 已实现(mapFields DROPPED_NO_EQUIVALENT) |
| 插件扩展:extensions.SPreset / extensions.tavern_helper | manual | ✅ 已实现(mapFields 遍历 extensions 子键) |
| 正则脚本 id(内部 UUID) | dropped(单条汇总) | ✅ 已实现(mapRegexes) |
| bias_preset_selected | dropped | ✅ 已实现 |
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
