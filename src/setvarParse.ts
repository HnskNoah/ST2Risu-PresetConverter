// setvar 宏的平衡解析。
//
// ST 的 `{{setvar::name::value}}` 值可以含嵌套宏(如 `{{user}}`、`{{#if x}}y{{/if}}`),
// 值以"未嵌套的 `}}`"结束。简单正则 `[^{}]*` 会在遇到值内 `{` 时截断,漏掉含嵌套宏的卡。
// 这里用深度计数扫描:跳过配对的 `{{...}}`,直到遇到不属于嵌套的 `}}`。
//
// 注意:ST 官方正则(variables.js)用 `[^}]*)` 截断,本身也不支持值内裸 `}`;本解析器与
// ST 一致 —— 裸 `}`(非 `}}`)原样保留在值里(仅 `}}` 对触发结束)。嵌套 `{{...}}` 配对跳过。

export interface BalancedMacro {
  /** 宏类型:setvar/addvar */
  kind: 'setvar' | 'addvar';
  /** 变量名(已 trim) */
  name: string;
  /** 值(原始文本,含嵌套宏) */
  value: string;
  /** 宏在原文中的起始位置 */
  start: number;
  /** 宏在原文中的结束位置(不含,指向 `}}` 之后的字符) */
  end: number;
}

/** 从 text 提取所有 {setvar/addvar}::name::value 宏(支持嵌套宏值)。 */
export function scanSetvarMacros(text: string): BalancedMacro[] {
  const out: BalancedMacro[] = [];
  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf('{{setvar::', pos);
    const openAdd = text.indexOf('{{addvar::', pos);
    let start = -1;
    if (open === -1) start = openAdd;
    else if (openAdd === -1) start = open;
    else start = Math.min(open, openAdd);
    if (start === -1) break;

    const kind: 'setvar' | 'addvar' = text.startsWith('{{addvar::', start) ? 'addvar' : 'setvar';
    const afterKind = start + (kind === 'addvar' ? '{{addvar::'.length : '{{setvar::'.length);

    // name: 到 `::` 为止
    const sepIdx = text.indexOf('::', afterKind);
    if (sepIdx === -1) break;
    const name = text.slice(afterKind, sepIdx).trim();
    if (!name) {
      pos = sepIdx + 2;
      continue;
    }
    const valueStart = sepIdx + 2;

    // value:深度扫描,跳过 {{...}} 配对,直到未嵌套的 }}
    let depth = 0;
    let i = valueStart;
    for (; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') {
        depth++;
        i++;
      } else if (text[i] === '}' && text[i + 1] === '}') {
        if (depth === 0) break;
        depth--;
        i++;
      }
    }
    if (i >= text.length - 1) {
      // 未闭合:不提取,跳过本宏
      pos = valueStart;
      continue;
    }
    const value = text.slice(valueStart, i);
    const end = i + 2;
    out.push({ kind, name, value, start, end });
    pos = end;
  }
  return out;
}

/** 用 scanSetvarMacros 的结果从原文剔除所有宏,返回剔除后的文本。 */
export function stripSetvarMacros(text: string, macros: BalancedMacro[]): string {
  if (macros.length === 0) return text;
  const parts: string[] = [];
  let cursor = 0;
  for (const m of macros) {
    parts.push(text.slice(cursor, m.start));
    cursor = m.end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}
