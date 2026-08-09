import { parseST } from './ir.js';
import { createReport } from './report.js';
import { mapFields } from './mapFields.js';
import { mapPrompts } from './mapPrompts.js';
import { mapRegexes } from './mapRegexes.js';
import { buildModule } from './mapTriggers.js';
import type { ConvertResult } from './types.js';

export function convert(tavernJson: unknown, opts: { source?: string } = {}): ConvertResult {
  const report = createReport(opts.source ?? 'preset');
  const ir = parseST(tavernJson);
  const fields = mapFields(ir.topLevel, report);
  const { cards: promptTemplate, setvars } = mapPrompts(ir, report);
  const regex = mapRegexes(ir.regexScripts, report);
  const preset = { ...fields, promptTemplate, regex };
  const module = buildModule({ setvars, source: opts.source ?? 'preset' })?.module ?? null;
  return { preset, report, module };
}
