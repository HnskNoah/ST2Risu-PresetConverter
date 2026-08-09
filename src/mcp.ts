#!/usr/bin/env node
// MCP server:ST preset -> Risu preset 转换器(通用)。
// 通过 stdio 暴露工具:convert_preset / validate_preset / convert_and_validate。
// 核心逻辑复用 src/index.ts(convert)与 src/validate.ts(validateAll),本文件只做协议层封装。

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { convert } from './index.js';
import { validateAll, validatePreset } from './validate.js';

function toText(parts: string[]): { type: 'text'; text: string }[] {
  return parts.map((text) => ({ type: 'text' as const, text }));
}

// 从 report 条目提取"定位字段"(identifier/field/key/scriptName 之一),兼容 index signature
function entryLabel(e: { [k: string]: unknown }): string {
  for (const k of ['identifier', 'field', 'key', 'scriptName', 'macro']) {
    const v = e[k];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}

function manualEntries(report: { sections: Record<string, { action: string; [k: string]: unknown }[]> }) {
  return Object.entries(report.sections)
    .flatMap(([sec, entries]) =>
      entries.map((e) => ({ ...e, section: sec } as { section: string; action: string; reason: string; [k: string]: unknown })),
    )
    .filter((e) => e.action === 'manual' || e.action === 'degraded');
}

const server = new McpServer({
  name: 'st2risu',
  version: '0.1.0',
});

// —— convert_preset:ST 预设 -> Risu preset + module + report summary ——
server.registerTool(
  'convert_preset',
  {
    title: 'Convert ST preset to Risu',
    description:
      '将 SillyTavern 预设 JSON 转换为 RisuAI 预设(botPreset)。返回转换后的 preset 对象、触发器模块(module)、报告摘要(report.summary 与 manual/degraded 明细)。对任意 ST 预设通用。',
    inputSchema: z.object({
      tavern_json: z.unknown().describe('SillyTavern 预设对象(顶层含 prompts/prompt_order 的 JSON)'),
      source: z.string().optional().describe('预设来源名(用于报告标识)'),
    }),
  },
  async ({ tavern_json, source }) => {
    try {
      const { preset, module, report } = convert(tavern_json, { source });
      const manual = manualEntries(report);
      return {
        content: toText([
          `converted ${preset.promptTemplate?.length ?? 0} cards, ${preset.regex?.length ?? 0} regex, ${module ? '1 module' : 'no module'}`,
          `summary: ${JSON.stringify(report.summary)}`,
          ...(manual.length
            ? ['', 'manual/degraded 明细:', ...manual.map((e) => `- [${e.section}] ${entryLabel(e)} (${e.action}): ${e.reason}`)]
            : []),
        ]),
        structuredContent: { preset, module, reportSummary: report.summary, issues: manual },
      };
    } catch (err) {
      return { isError: true, content: toText([`转换失败: ${(err as Error).message}`]) };
    }
  },
);

// —— validate_preset:校验转换产物能否被 Risu 消费 ——
server.registerTool(
  'validate_preset',
  {
    title: 'Validate Risu preset',
    description:
      '校验转换产物(或任意 Risu botPreset 对象)能否被 Risu 正常导入消费。三层:结构校验(卡类型/type2/regex in/toggle 语法)、templateCheck 复刻(8 条警告)、一致性(toggle 引用)。',
    inputSchema: z.object({
      risu_json: z.unknown().describe('Risu botPreset 对象'),
    }),
  },
  async ({ risu_json }) => {
    try {
      const result = validatePreset(risu_json as import('./types.js').RisuPreset);
      const lines = result.issues.length
        ? result.issues.map((i) => `[${i.severity.toUpperCase()}] ${i.code}${i.where ? ` ${i.where}` : ''}: ${i.message}`)
        : ['OK: 产物可被 Risu 正常消费'];
      return { content: toText(lines), structuredContent: result };
    } catch (err) {
      return { isError: true, content: toText([`校验失败: ${(err as Error).message}`]) };
    }
  },
);

// —— convert_and_validate:一步到位 ——
server.registerTool(
  'convert_and_validate',
  {
    title: 'Convert and validate',
    description:
      '转换 ST 预设为 Risu preset 并立即校验产物。返回 preset、module、report summary、校验结果。推荐主流程。',
    inputSchema: z.object({
      tavern_json: z.unknown().describe('SillyTavern 预设对象'),
      source: z.string().optional().describe('预设来源名'),
    }),
  },
  async ({ tavern_json, source }) => {
    try {
      const { preset, module, report } = convert(tavern_json, { source });
      const v = validateAll(preset, module);
      const manual = manualEntries(report);
      const lines = [
        `converted ${preset.promptTemplate?.length ?? 0} cards, ${preset.regex?.length ?? 0} regex, ${module ? '1 module' : 'no module'}`,
        `summary: ${JSON.stringify(report.summary)}`,
        v.issues.length ? `validate: ${v.ok ? 'PASS (warnings/info)' : 'FAIL'} ${v.issues.length} issues` : 'validate: OK',
        ...v.issues.map((i) => `  [${i.severity.toUpperCase()}] ${i.code}${i.where ? ` ${i.where}` : ''}: ${i.message}`),
        ...(manual.length ? ['', 'manual/degraded 明细:', ...manual.map((e) => `- [${e.section}] ${entryLabel(e)} (${e.action}): ${e.reason}`)] : []),
      ];
      return {
        content: toText(lines),
        structuredContent: { preset, module, reportSummary: report.summary, validation: v, issues: manual },
      };
    } catch (err) {
      return { isError: true, content: toText([`转换失败: ${(err as Error).message}`]) };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
