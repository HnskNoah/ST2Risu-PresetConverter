import { parseST } from './ir.js';
import { createReport } from './report.js';
import { mapFields } from './mapFields.js';
import { mapPrompts } from './mapPrompts.js';
import { mapRegexes } from './mapRegexes.js';
import type { Report, RisuPreset } from './types.js';

export function convert(tavernJson: unknown, opts: { source?: string } = {}): { preset: RisuPreset; report: Report } {
  const report = createReport(opts.source ?? 'preset');
  const ir = parseST(tavernJson);
  const fields = mapFields(ir.topLevel, report);
  const promptTemplate = mapPrompts(ir, report);
  const regex = mapRegexes(ir.regexScripts, report);
  const preset: RisuPreset = { ...fields, promptTemplate, regex };
  return { preset, report };
}
