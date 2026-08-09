// M2: ST RegEx(13 字段) -> Risu customscript[] 的通用决策树。
// M3: 深度过滤(minDepth/maxDepth -> OUT {{#if}}) + 宏翻译。
// 依据:docs/DESIGN.md §5 与 docs/GOALS.md(通用转换器:全部字段及组合全覆盖)。
import type { RegexScript, Report, RisuCustomScript } from './types.js';
import { swallowTrailingNewline, wrapDepthGuard } from './depthGuard.js';
import { translateMacros } from './macroTable.js';

const PLACEMENT = Object.freeze({
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
});

const RISU_FLAGS = 'dgimsuvy';

const isEmpty = (v: unknown): v is null | undefined | '' => v === undefined || v === null || v === '';

function normalizePlacement(placement: RegexScript['placement']): number[] {
  if (typeof placement === 'string') placement = placement.split(',').map((p) => Number(p.trim()));
  if (Array.isArray(placement)) return placement;
  if (isEmpty(placement)) return [PLACEMENT.USER_INPUT, PLACEMENT.AI_OUTPUT];
  return [placement];
}

// 提取 /pattern/flags 形式;否则视为纯 pattern。id 字段是 ST 内部 UUID(跨引用用),
// Risu customscript 无等价字段,故不报告、直接忽略。
function parseFindRegex(findRegex: unknown): { pattern: string; tailFlags: string[] } {
  if (isEmpty(findRegex)) return { pattern: '', tailFlags: [] };
  const m = /^\/([\s\S]*)\/([dgimsuvyXAJx]*)$/.exec(String(findRegex));
  if (m) return { pattern: m[1], tailFlags: [...m[2]] };
  return { pattern: String(findRegex), tailFlags: [] };
}

// 决策树:返回目标 type 列表;null 表示整脚本被丢弃。
function decideTypes(s: RegexScript, name: string, report: Report): string[] | null {
  if (s.disabled) {
    report.add('regex', {
      scriptName: name, action: 'dropped', reason: 'disabled 脚本', fields: ['disabled'],
    });
    return null;
  }

  const placement = normalizePlacement(s.placement);
  let usable = false;
  for (const p of placement) {
    switch (p) {
      case PLACEMENT.USER_INPUT:
      case PLACEMENT.AI_OUTPUT:
        usable = true;
        break;
      case PLACEMENT.SLASH_COMMAND:
        report.add('regex', {
          scriptName: name, action: 'dropped', reason: 'SLASH_COMMAND 对应 ST 斜杠命令,Risu customscript 无等价入口', fields: ['placement'],
        });
        return null;
      case PLACEMENT.REASONING:
        report.add('regex', {
          scriptName: name, action: 'dropped', reason: 'REASONING 处理建议改用原生思考参数,Risu customscript 不对 reasoning 生效', fields: ['placement'],
        });
        return null;
      case PLACEMENT.WORLD_INFO:
        report.add('regex', {
          scriptName: name, action: 'degraded', reason: 'WORLD_INFO 处理建议改走世界书 useRegex,v1 不自动生成', fields: ['placement'],
          suggestion: '迁移到 ST 世界书条目的 useRegex 字段',
        });
        break;
      default:
        report.add('regex', {
          scriptName: name, action: 'manual', reason: '未知 placement 值,按有效 placement 处理', fields: ['placement'],
        });
    }
  }
  if (!usable) return null;

  const has1 = placement.includes(PLACEMENT.USER_INPUT);
  const has2 = placement.includes(PLACEMENT.AI_OUTPUT);

  const M = !!s.markdownOnly;
  const P = !!s.promptOnly;

  // 三分法(仅 AI_OUTPUT 路径)
  let base: string[];
  if (M && P) base = ['editprocess', 'editdisplay'];
  else if (M) base = ['editdisplay'];
  else if (P) base = ['editprocess'];
  else base = ['editoutput'];

  // placement 修正:仅用户输入 -> editinput;两者都有 -> 主类型 + editinput
  if (has1 && !has2) return ['editinput'];
  if (has1 && has2) return [...new Set([...base, 'editinput'])];
  return base;
}

// 脚本级转换缺口检测(报告,不影响主体转换)
function reportGaps(s: RegexScript, name: string, report: Report): void {
  if (Array.isArray(s.trimStrings) && s.trimStrings.length) {
    report.add('regex', {
      scriptName: name, action: 'degraded', reason: 'trimStrings 无 Risu 等价,该 trim 行为不生效', fields: ['trimStrings'],
    });
  }
  if (s.runOnEdit === false) {
    report.add('regex', {
      scriptName: name, action: 'degraded', reason: 'Risu 正则恒在编辑时运行,与 runOnEdit=false 不符(行为差异)', fields: ['runOnEdit'],
    });
  }
  if (s.substituteRegex === 2) {
    report.add('regex', {
      scriptName: name, action: 'manual', reason: 'substituteRegex=ESCAPED 需人工核对替换串的特殊字符转义', fields: ['substituteRegex'],
    });
  }
}

function buildScript(s: RegexScript, name: string, type: string, order: number, report: Report): RisuCustomScript {
  const { pattern, tailFlags } = parseFindRegex(s.findRegex);
  if (!s.findRegex) {
    report.add('regex', {
      scriptName: name, action: 'manual', reason: 'findRegex 为空,脚本将无法正确匹配', fields: ['findRegex'],
    });
  }
  const invalid = tailFlags.filter((f) => !RISU_FLAGS.includes(f));
  if (invalid.length) {
    report.add('regex', {
      scriptName: name, action: 'degraded',
      reason: `正则 flag ${invalid.map((f) => `'${f}'`).join(',')} Risu 不支持,已剔除(白名单 ${RISU_FLAGS})`,
      fields: ['findRegex'],
    });
  }
  const flags = new Set(tailFlags.filter((f) => RISU_FLAGS.includes(f)));
  flags.add('g');

  if (s.substituteRegex === 1 || s.substituteRegex === true) flags.add('<cbs>');

  let out = isEmpty(s.replaceString) ? '' : String(s.replaceString);
  if (out.endsWith('>')) {
    out = out.slice(0, -1);
    flags.add('<no_end_nl>');
  }
  // Tavern 的 {{match}} 全匹配宏,Risu 对应 {{data}};整 token 替换,不触碰 {{match_foo}} 类
  out = out.replace(/\{\{match\}\}/g, '{{data}}');

  let inPattern = pattern;

  // M3: 深度过滤(minDepth/maxDepth -> OUT {{#if}} 守卫,round5 §7)
  // 门控:仅 min>0 或 max 非空才过滤(ST 的"无过滤"序列化状态是 minDepth:0/maxDepth:null)
  const minDepth = isEmpty(s.minDepth) ? 0 : Number(s.minDepth);
  const maxDepth = isEmpty(s.maxDepth) ? null : Number(s.maxDepth);
  if (minDepth > 0 || maxDepth !== null) {
    out = wrapDepthGuard(out, minDepth, maxDepth);
    flags.add('<cbs>'); // OUT 使用宏(chatindex/lastmessageid)的前提
    inPattern = swallowTrailingNewline(inPattern);
    report.add('regex', {
      scriptName: name, action: 'degraded', fields: ['minDepth', 'maxDepth'],
      reason: `深度过滤经 OUT {{#if}} 实现(min=${minDepth}, max=${maxDepth ?? '∞'});无消息上下文时 {{chatindex}}=-1,条件落假分支(不写兜底,决策 2026-08-09)`,
    });
  }

  // M3: 宏翻译(out 总是;in 在需 <cbs> 时,即 substituteRegex=1 或深度过滤)
  out = translateMacros(out, report, name);
  if (flags.has('<cbs>')) inPattern = translateMacros(inPattern, report, name);

  flags.add(`<order ${order}>`);

  const flag = [...flags].join('');
  return {
    type,
    ableFlag: true, // flag 恒含 <order N>,须保留,Risu 才能按指定顺序执行
    flag,
    in: inPattern,
    out,
    comment: `[${name}]`,
  };
}

export function mapRegexes(scripts: RegexScript[], report: Report): RisuCustomScript[] {
  const out: RisuCustomScript[] = [];
  const total = scripts.length;
  const idCount = scripts.filter((s) => s.id).length;
  if (idCount > 0) {
    // id 是 ST 内部 UUID,无 Risu 等价;单条汇总报告(GOALS §3 要求每个字段有定义)
    report.add('regex', {
      action: 'dropped',
      reason: `${idCount} 个脚本的 id(内部 UUID)无 Risu 等价,已丢弃`,
      fields: ['id'],
    });
  }
  scripts.forEach((s, index) => {
    const name = s.scriptName ?? `script${index + 1}`;
    const types = decideTypes(s, name, report);
    if (!types) return;
    reportGaps(s, name, report);
    // 降序 order:Tavern 先执行的脚本获得更大 order(Risu 按 order 降序执行)
    const order = total - index;
    for (const type of types) {
      const script = buildScript(s, name, type, order, report);
      if (types.length > 1) script.comment = `[${name} (${type})]`;
      out.push(script);
      report.add('regex', {
        scriptName: name, type, action: 'converted', reason: `type=${type}, order=${order}`,
      });
    }
  });
  return out;
}
