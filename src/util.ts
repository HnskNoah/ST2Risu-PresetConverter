// 通用工具函数

// 任意值安全转字符串:null/undefined -> '',对象/数字 -> JSON/字符串序列化,避免 .trim() 崩溃
export function asString(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
