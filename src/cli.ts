#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { convert } from './index.js';
import { validateAll } from './validate.js';

// usage: st2risu <tavern-preset.json> [--instruct <instruct-preset.json>]
//  --instruct 指定 ST instruct 预设(独立第二输入),生成 Risu instruct 模式(JinjaTemplate)
const argv = process.argv.slice(2);
const inputPath = argv[0];
const instrIdx = argv.indexOf('--instruct');
const instructPath = instrIdx >= 0 ? argv[instrIdx + 1] : undefined;
if (!inputPath || inputPath.startsWith('--')) {
  console.error('usage: st2risu <tavern-preset.json> [--instruct <instruct-preset.json>]');
  process.exit(1);
}

let raw: string;
try {
  raw = readFileSync(inputPath, 'utf8');
} catch (err) {
  console.error(`cannot read ${inputPath}: ${(err as Error).message}`);
  process.exit(1);
}

let instructRaw: unknown;
if (instructPath) {
  try {
    instructRaw = JSON.parse(readFileSync(instructPath, 'utf8'));
  } catch (err) {
    console.error(`cannot read --instruct ${instructPath}: ${(err as Error).message}`);
    process.exit(1);
  }
}

let preset: ReturnType<typeof convert>['preset'];
let report: ReturnType<typeof convert>['report'];
let module: ReturnType<typeof convert>['module'];
try {
  ({ preset, report, module } = convert(JSON.parse(raw), {
    source: basename(inputPath),
    ...(instructRaw !== undefined ? { instruct: instructRaw } : {}),
  }));
} catch (err) {
  console.error(`convert failed: ${(err as Error).message}`);
  process.exit(1);
}

const base = inputPath.replace(/\.json$/i, '');
writeFileSync(`${base}.risu.json`, JSON.stringify(preset, null, 2));
writeFileSync(`${base}.report.json`, JSON.stringify(report, null, 2));
if (module) {
  writeFileSync(`${base}.module.json`, JSON.stringify(module, null, 2));
}
console.log(`written ${base}.risu.json + ${base}.report.json${module ? ` + ${base}.module.json` : ''}`);

const v = validateAll(preset, module);
if (v.issues.length === 0) {
  console.log(`validate: OK (${preset.promptTemplate?.length ?? 0} cards, ${preset.regex?.length ?? 0} regex)`);
} else {
  for (const issue of v.issues) {
    const mark = issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '△' : 'ℹ';
    console.log(`validate ${mark} [${issue.code}]${issue.where ? ` ${issue.where}` : ''}: ${issue.message}`);
  }
  if (!v.ok) {
    console.error('validate: FAILED (errors above;产物可能无法正常导入 Risu)');
    process.exitCode = 1;
  }
}
