# MCP 使用

ST→Risu 转换器可作为 MCP server 通过 stdio 接入任何 MCP 客户端,让 LLM 直接调用转换能力。

## 启动

```bash
npm run build   # 构建 dist/src/mcp.js
node dist/src/mcp.js    # 或 npx st2risu-mcp(全局安装后)
```

## 工具

| 工具 | 用途 | 入参 |
|---|---|---|
| `convert_preset` | ST 预设 → Risu preset + module + report summary | `tavern_json`(ST 预设对象)、`source?` |
| `validate_preset` | 校验 Risu 产物能否被正常消费(结构/templateCheck/一致性) | `risu_json`(Risu botPreset 对象) |
| `convert_and_validate` | 转换 + 校验一步到位(推荐) | `tavern_json`、`source?` |

所有工具返回 `content`(人类可读文本)+ `structuredContent`(结构化:preset/module/reportSummary/validation/issues),错误返回 `isError: true`。

## 配置示例

### opencode(`~/.config/opencode/opencode.json` 或项目 `opencode.json`)

```jsonc
{
  "mcp": {
    "st2risu": {
      "type": "local",
      "command": ["node", "dist/src/mcp.js"],
      "environment": {}
    }
  }
}
```

### Claude Code(`.mcp.json`)

```json
{
  "mcpServers": {
    "st2risu": {
      "command": "node",
      "args": ["dist/src/mcp.js"]
    }
  }
}
```

> 提示:构建产物在 `dist/src/mcp.js`,配置时用绝对路径或在项目根运行。

## 与 CLI 的关系

- **CLI**(`st2risu`):本地文件转换,写 `<base>.risu.json`/`.report.json`/`.module.json`。
- **MCP**(`st2risu-mcp`):程序化/LLM 调用,返回内存对象,不写文件。

两者共享同一套 `convert`/`validate` 核心逻辑,行为一致。

## 转换/校验流程

```
tavern_json ──convert──▶ { preset, module, report }
                           │
                           └──validate──▶ { ok, issues }
```
