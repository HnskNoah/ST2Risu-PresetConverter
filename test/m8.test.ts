// M8: MCP server 集成测试 —— 启动 dist/src/mcp.js 子进程,发 JSON-RPC 握手 + tools/call,断言结果。
// 验证:initialize 握手、tools/list 3 工具、convert_preset/convert_and_validate 正确转换与校验。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../src/mcp.js', import.meta.url));

interface RpcResponse {
  id: number;
  result?: {
    content?: { type: string; text: string }[];
    structuredContent?: unknown;
    tools?: unknown[];
    serverInfo?: { name: string; version: string };
  };
  error?: { message: string };
}

function startServer(): { send: (obj: object) => Promise<RpcResponse>; kill: () => void } {
  const child = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const pending = new Map<number, { resolve: (r: RpcResponse) => void }>();
  let nextId = 0;
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
          pending.get(msg.id)!.resolve(msg as RpcResponse);
          pending.delete(msg.id);
        }
      } catch {
        // 忽略非 JSON 行
      }
    }
  });
  const send = (obj: object): Promise<RpcResponse> =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, { resolve });
      child.stdin?.write(JSON.stringify({ ...obj, id }) + '\n');
    });
  return {
    send,
    kill: () => child.kill(),
  };
}

const minimalPreset = {
  name: 'minimal',
  temperature: 1,
  prompts: [
    { identifier: 'main', name: 'Main', role: 'system', content: 'You are {{char}}.' },
    { identifier: 'charDescription', name: 'Desc', role: 'system', content: '{{description}}' },
    { identifier: 'chatHistory', name: 'History', role: 'system', content: '' },
  ],
  prompt_order: [
    {
      character_id: 1,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'chatHistory', enabled: true },
      ],
    },
  ],
};

test('MCP: initialize 握手 + tools/list 返回 3 个工具', async () => {
  const s = startServer();
  try {
    const init = await s.send({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } },
    });
    assert.equal(init.result?.serverInfo?.name, 'st2risu');
    await s.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

    const list = await s.send({ jsonrpc: '2.0', method: 'tools/list', params: {} });
    const names = ((list.result?.tools as { name: string }[]) ?? []).map((t) => t.name);
    assert.deepEqual(names.sort(), ['convert_and_validate', 'convert_preset', 'validate_preset']);
  } finally {
    s.kill();
  }
});

test('MCP: convert_preset 转换最小预设,返回 preset + summary', async () => {
  const s = startServer();
  try {
    await s.send({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } },
    });
    await s.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

    const r = await s.send({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'convert_preset', arguments: { source: 'minimal', tavern_json: minimalPreset } },
    });
    assert.ok(!r.error, `no error: ${r.error?.message}`);
    const sc = r.result?.structuredContent as { preset?: { promptTemplate?: unknown[] }; reportSummary?: Record<string, number> };
    assert.ok(sc?.preset?.promptTemplate?.length === 4, 'main + description + chat + globalNote');
    assert.equal(sc?.reportSummary?.converted, 0);
  } finally {
    s.kill();
  }
});

test('MCP: convert_preset 对非 ST 输入返回 isError', async () => {
  const s = startServer();
  try {
    await s.send({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } },
    });
    await s.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

    const r = await s.send({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'convert_preset', arguments: { source: 'bad', tavern_json: { foo: 1 } } },
    });
    assert.ok(r.result?.content?.[0]?.text.includes('转换失败'));
  } finally {
    s.kill();
  }
});

test('MCP: convert_and_validate 变异预设转换 + 校验 OK', async () => {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test', 'fixtures', 'variation-st.json'), 'utf8'));
  const s = startServer();
  try {
    await s.send({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } },
    });
    await s.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

    const r = await s.send({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'convert_and_validate', arguments: { source: 'variation', tavern_json: fixture } },
    });
    assert.ok(!r.error, `no error: ${r.error?.message}`);
    const sc = r.result?.structuredContent as {
      validation?: { ok?: boolean; issues?: unknown[] };
      preset?: { promptTemplate?: unknown[]; regex?: unknown[] };
    };
    assert.equal(sc?.validation?.ok, true);
    assert.equal(sc?.preset?.promptTemplate?.length, 12); // 11 + disabled jailbreak 守卫卡
    assert.equal(sc?.preset?.regex?.length, 11);
  } finally {
    s.kill();
  }
});
