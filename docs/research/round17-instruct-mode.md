# round17: instruct 模式转换(ST instruct preset → Risu JinjaTemplate)

日期:2026-08-10
状态:完成(137 测试全绿)
实现:`src/mapInstruct.ts`

## 背景:覆盖度审计的 B 类缺口

round16 覆盖度审计遗留 3 项 B 类(可映射未做):
1. **instruct 三件套**(useInstructPrompt / instructChatTemplate / JinjaTemplate)——阻碍:需 ST 第二输入文件,现已实现
2. **moduleIntergration**——自洽增强,低优先
3. (空)

## Risu 侧消费方式(调研定稿)

- `useInstructPrompt`:仅 OpenRouter 路径消费(`openAI/requests.ts:441-445`)——true 时删 messages、`applyChatTemplate(formated)` 渲染单串进 `body.prompt`;false 走结构化 messages 数组。**本地后端(Ooba/Kobold/Horde/WebLLM)无条件走模板渲染,不查此布尔**(request.ts 多处)。
- `instructChatTemplate`:模板名选择器(`chatTemplate.ts:33-38`),`'jinja'` 走 `db.JinjaTemplate` 文本,其余走内置表(chatml/llama2/llama3/gpt2/gemma/mistral/vicuna/alpaca,本身也是预置 Jinja)。
- `JinjaTemplate`:仅 `type==='jinja'` 时读取,用 `@huggingface/jinja` 渲染。可用变量:`messages`(数组,元素 `{role, content}`)、`add_generation_prompt`、`risu_char`、`risu_user`、`eos_token`、`bos_token`(chatTemplate.ts:94-101)。
- 结论:**不必须自定义 Jinja**——填内置模板名即可工作,但内置模板是固定格式,ST 自定义 sequence 无法注入。要精确还原必须走 Jinja 生成路径。

## 算法(以官方 prompt.ts:453-484 为蓝本)

```
[story_string 预处理段]
{% for message in messages %}\
{% if message.role == 'user' %}{input_sequence}{{ message.content }}{input_suffix}{% endif %}\
{% if message.role == 'assistant' %}{first/last/default}{{ message.content }}{output_suffix}{% endif %}\
{% if message.role == 'system' %}{system_sequence}{system_sequence_prefix}{{ message.content }}{system_sequence_suffix}{system_suffix}{% endif %}\
{% endfor %}{output_sequence}
```

### 两处修复官方缺陷

| 缺陷 | 官方行为(prompt.ts) | 我们的修复 |
|---|---|---|
| `first_output_sequence`/`last_output_sequence` 全丢弃 | 官方完全不用,ST Libra-32B 主分隔符 `\n### Response:` 就在 last_output_sequence,导入即丢 | Jinja `loop.first`/`loop.last` 区分:first > last > 默认 output_sequence |
| story_string 预处理误删 | 官方先 `{{user}}`→`{{risu_user}}` 再删残留 `{{...}}`,risu_user 被删;system_prompt 替换同样会被清理 | NUL 占位符(`\u0000RISU_USER\u0000`/`\u0000RISU_SYSTEM\u0000`)避开残留花括号清理,最后还原 |

### 决策

- **`system_same_as_user=true`**:system 消息按 user 序列包裹(`input_sequence` + content + `output_sequence` + `system_suffix`),对齐官方 prompt.ts:371-375。
- **`story_string_prefix`/`suffix`**:仅附着 story_string 段落(仿 instruct-mode.js:490-496,`{{name}}`→System);无 story_string 时不输出(避免孤立前缀)。
- **story_string 中 ST 宏(`{{char}}` 等)清除**:与官方一致(残留花括号清理),ST 宏改由 promptTemplate 卡注入,避免未知 Jinja 语法冲突。
- **instruct 与既有管线正交**:instruct 只接管 prompt 渲染;变量卡组(toggle)、setvar 触发器、regex 不受影响。

## 接口

- **CLI**:`st2risu <tavern-preset.json> [--instruct <instruct-preset.json>]`
- **convert()**:`opts.instruct`(显式)?? 主预设顶层 `instruct` 块(隐式自动识别)
- **mapInstruct 兼容两种形态**:顶层直放序列字段 / `{instruct:{...}}` 嵌套
- **MCP**:`convert_preset` / `convert_and_validate` 增加可选 `instruct_json`

## 验证

- `test/m9.test.ts` 10 条:role 分支、loop.first/last、system_same_as_user、story_string 预处理(占位符)、story_string_prefix、嵌套/顶层形态、顶层块自动识别、无 instruct 缺省。
- 真实端到端:V18 主预设 + Libra-32B instruct preset → 产物 `useInstructPrompt: true`、`JinjaTemplate: 290 chars`、assistant 分支含 `{% if loop.last %}\n### Response:`。
