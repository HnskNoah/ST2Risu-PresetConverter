#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { convert } from './index.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: st2risu <tavern-preset.json>');
  process.exit(1);
}

let raw: string;
try {
  raw = readFileSync(inputPath, 'utf8');
} catch (err) {
  console.error(`cannot read ${inputPath}: ${(err as Error).message}`);
  process.exit(1);
}

let preset: ReturnType<typeof convert>['preset'];
let report: ReturnType<typeof convert>['report'];
try {
  ({ preset, report } = convert(JSON.parse(raw), { source: basename(inputPath) }));
} catch (err) {
  console.error(`convert failed: ${(err as Error).message}`);
  process.exit(1);
}

const base = inputPath.replace(/\.json$/i, '');
writeFileSync(`${base}.risu.json`, JSON.stringify(preset, null, 2));
writeFileSync(`${base}.report.json`, JSON.stringify(report, null, 2));
console.log(`written ${base}.risu.json + ${base}.report.json`);
