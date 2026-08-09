# 项目目标:ST2Risu 通用转换器

> 一句话目标:**把任意 SillyTavern 预设(OpenAI 系)转换成一个等价的、可被 RisuAI 直接导入的预设,并给出完整、可解释的差异报告。**

本项目**不是**"把某几个 preset 转好的专用工具"。三份真实 preset(此间小镇/可待/梦鲸)只是**测试样本**,用于验证通用规则;它们不是目标本身。

---

## 1. "通用"的五个维度

| 维度 | 含义 | 反例(不是通用) |
|---|---|---|
| **输入通用** | 接受**任意**合法的 ST OpenAI 系 preset JSON,不依赖特定 preset 的字段组合或出现顺序 | 只处理"prompts 包含 main"的 preset |
| **映射通用** | 映射逻辑**表驱动/数据驱动**:新增字段靠加映射表项,不改代码 | 为某个字段写死 if 分支 |
| **覆盖通用** | 覆盖 ST 正则的**全部 13 字段**及其**合法组合**(placement 数组×三分法×深度×substituteRegex×trim…),决策树完备,不存在"没见过的组合" | 只处理本次遇到的 3 个组合 |
| **策略通用** | 转换缺口(minDepth/maxDepth、双开、宏、trimStrings、runOnEdit…)有**通用的**等价生成策略(深度 OUT 生成器、宏翻译表、拆分规则),而非逐个正则定制 | 为某个正则手写特例 |
| **输出通用** | 产出标准 Risu `botPreset` 结构 + 标准报告 schema,可被 Risu `importPreset` 的 json 分支消费;对**任意**输入产物结构一致 | 输出里夹杂特定 preset 的痕迹 |

---

## 2. 设计原则(由目标派生)

1. **纯函数管线**:`parseST → mapFields/mapPrompts/mapRegexes → compose`,无副作用,输入决定输出。
2. **表驱动优先**:字段映射表、`identifier`→卡映射、宏翻译表、`placement`/三分法决策表都是数据,不是代码。
3. **每个决策可解释**:任何 dropped / degraded / manual 都必须进报告,带原因和建议;不静默丢字段。
4. **未知输入 → manual**:表外字段/组合一律进 `manual` 报告,不猜、不硬编。
5. **模块化阶段**(M2-M5)是"通用扩展"而非"补丁":正则映射、深度生成、宏翻译、触发器/世界书/资产增强都是独立、可组合的模块。

---

## 3. 验收标准(通用性的证明)

- [ ] 任意合法 ST preset(含极端字段组合)转换**不崩溃**,都产出 preset + 报告。
- [ ] 正则 13 字段**全覆盖**:`findRegex/replaceString/trimStrings/placement/markdownOnly/promptOnly/runOnEdit/substituteRegex/minDepth/maxDepth/disabled/scriptName/id` 都有明确定义的映射(含"丢弃+报告"型)。
- [ ] 报告对**每个** dropped/degraded/manual 条目标注原因与建议;summary 可被程序消费。
- [ ] 深度过滤、双开拆分、宏翻译对任意输入产出一致、符合文档规则的结果(有单测矩阵)。
- [ ] 产物结构稳定:任何 preset 的输出都能直接进 Risu `importPreset`。

## 4. 边界(通用 ≠ 无限,但架构留扩展位)

本轮明确排除:群聊、`edittrans`、`.risup` 容器、`substituteRegex=ESCAPED`(仅报告)。这些在架构上预留接口,后续可作为通用能力补齐,而不是推翻设计。

---

## 5. 目标的可验证写法(拒绝模糊)

- 不是:"帮我把这三个 preset 转好"
- 而是:"**任意** ST preset 转换后:① 能导入 Risu;② 报告无遗漏(每个非直通字段都有解释);③ 转换规则可用单测覆盖的组合矩阵证明"
