import type { Report, ReportAction, ReportEntry, ReportSection } from './types.js';

const ACTION_KEYS: readonly ReportAction[] = ['converted', 'dropped', 'degraded', 'manual'];

export function createReport(source = 'preset'): Report {
  return {
    source,
    summary: { converted: 0, dropped: 0, degraded: 0, manual: 0 },
    sections: { topLevel: [], regex: [], prompts: [], macros: [] },
    add(section: ReportSection, entry: ReportEntry) {
      if (ACTION_KEYS.includes(entry.action)) this.summary[entry.action]++;
      this.sections[section].push(entry);
    },
  };
}
