import type { Report, ReportAction, ReportEntry, ReportSection } from './types.js';

const ACTION_KEYS: readonly ReportAction[] = ['converted', 'dropped', 'degraded', 'manual'];

export function createReport(source = 'preset'): Report {
  return {
    source,
    summary: { converted: 0, dropped: 0, degraded: 0, manual: 0 },
    sections: { topLevel: [], regex: [], prompts: [], macros: [], toggles: [] },
    add(section: ReportSection, entry: ReportEntry) {
      if (ACTION_KEYS.includes(entry.action as ReportAction)) this.summary[entry.action as ReportAction]++;
      this.sections[section].push(entry);
    },
  };
}
