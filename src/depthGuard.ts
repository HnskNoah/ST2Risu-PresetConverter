// M3: minDepth/maxDepth -> OUT {{#if}} 深度守卫。
// 依据 round5 §7:chatindex = lastmessageid - depth;深度范围 [min,max] 对应
//   lastmessageid - max <= chatindex <= lastmessageid - min
// 公式(规范化小写宏名,Risu parser.svelte.ts:1055 等价 greater_equal/greaterequal):
//   {{#if [{{and::}}]GE(chatindex, last-max)::LE(chatindex, last-min)}}OUT{{/if}}

export function wrapDepthGuard(out: string, min: number, max: number | null): string {
  const clauses: string[] = [];
  // 深度 <= max(默认∞)→ chatindex >= last-max;max=null 时恒真,省略
  if (max !== null) clauses.push(`{{greaterequal::{{chatindex}}::{{? {{lastmessageid}}-${max}}}}} `);
  // 深度 >= min(默认0)→ chatindex <= last-min;min=0 时恒真,省略
  if (min > 0) clauses.push(`{{lessequal::{{chatindex}}::{{? {{lastmessageid}}-${min}}}}} `);
  if (clauses.length === 0) return out;
  const cond = clauses.length === 1 ? clauses[0].trim() : `{{and::${clauses.map((c) => c.trim()).join('::')}}}`;
  return `{{#if ${cond}}}${out}{{/if}}`;
}

// in 吞尾换行:#if 为假时整体删除,若 in 不含尾部吞并,删除后留空行(round5 §7.4)
export function swallowTrailingNewline(inPattern: string): string {
  if (inPattern.endsWith('[\\s\\S]*')) return inPattern;
  if (inPattern.endsWith('$')) {
    if (inPattern.endsWith('\\$')) return `${inPattern}[\\s\\S]*`; // 字面 $,直接追加
    inPattern = inPattern.slice(0, -1); // 行尾锚 $ 后追加吞并无意义
  }
  return `${inPattern}[\\s\\S]*`;
}
