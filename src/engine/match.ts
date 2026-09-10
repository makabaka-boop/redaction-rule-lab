import type { Candidate, EngineError, ExcludedCandidate, RedactionRule } from './types';
import { parseTemplate, expandTokens } from './template';

/**
 * 在【原文】上收集全部规则的命中候选。
 * 引擎只在原文上匹配一次，绝不在已替换文本上继续匹配，
 * 因此替换模板引入的字符不会触发新的命中。
 *
 * 非零命中展开模板后、进入重叠裁决前，若原文命中文本与规则
 * excludedValues 中任一项全量精确相等，则该命中作为例外剔除：
 * 不遮蔽、不参与裁决、不进入清单与导出。比较是否忽略大小写跟随
 * 该规则的 i 标志，等价语义与正则引擎一致（u 标志启用 Unicode
 * 简单大小写折叠，如 ſ 与 S 等价）。
 *
 * 零长度命中属于规则缺陷：记录规则编号与字符位置后停止该规则的扫描，
 * 全部错误汇总后由管线统一判失败。
 */
export function collectCandidates(
  source: string,
  rules: RedactionRule[]
): { ok: true; candidates: Candidate[]; excluded: ExcludedCandidate[] } | { ok: false; errors: EngineError[] } {
  const candidates: Candidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const errors: EngineError[] = [];

  for (const rule of rules) {
    const parsed = parseTemplate(rule.template, rule.id, rule.order);
    if (!parsed.ok) {
      errors.push(...parsed.errors);
      continue;
    }

    // 例外值预处理：
    //   - 无 i 标志：全量精确比较（Set 查找）；
    //   - 有 i 标志：委托正则引擎自身的大小写等价语义——用规则声明的标志
    //     构造“仅字面量”的全串匹配正则。u 标志启用 Unicode 简单大小写折叠
    //     （如 ſ 与 S、ẞ 与 ß 等价），与命中阶段的大小写行为严格一致；
    //     简单的 toLowerCase 比较无法覆盖这些等价关系。
    //     构造时必须剥离 m 标志：^/$ 在 m 下退化为行边界，会把
    //     “末行等于例外值”的多行命中误判为全量相等；m 对纯字面量的
    //     全串比较本无意义（s 同理无害，但保留不影响结果）。
    const ignoreCase = rule.flags.includes('i');
    let excludedSet: Set<string> | null = null;
    let excludedRegex: RegExp | null = null;
    if (rule.excludedValues.length > 0) {
      if (ignoreCase) {
        const literals = rule.excludedValues.map((value) =>
          value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        );
        const compareFlags = rule.flags.replace('m', '');
        excludedRegex = new RegExp(`^(?:${literals.join('|')})$`, compareFlags);
      } else {
        excludedSet = new Set(rule.excludedValues);
      }
    }

    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    regex.lastIndex = 0;
    let zeroLengthReported = false;

    for (;;) {
      const match = regex.exec(source);
      if (match === null) break;

      if (match[0].length === 0) {
        if (!zeroLengthReported) {
          zeroLengthReported = true;
          errors.push({
            code: 'ZERO_LENGTH_MATCH',
            ruleId: rule.id,
            ruleIndex: rule.order,
            position: match.index,
            message: `规则 ${rule.id}（第 ${rule.order + 1} 条）：在字符位置 ${match.index} 处产生零长度命中，无法界定遮蔽区间，请修正正则`
          });
        }
        // 防御性推进，避免在继续收集其它命中时死循环。
        regex.lastIndex = match.index + 1;
        continue;
      }

      const replacement = expandTokens(parsed.tokens, match);

      // 模板展开后、裁决前：原文命中文本与例外值全量精确相等即剔除。
      if (excludedSet !== null || excludedRegex !== null) {
        const matched = match[0];
        const isExcluded = excludedRegex !== null
          ? excludedRegex.test(matched)
          : excludedSet!.has(matched);
        if (isExcluded) {
          excluded.push({
            ruleId: rule.id,
            ruleName: rule.name,
            ruleIndex: rule.order,
            start: match.index,
            end: match.index + matched.length,
            matched
          });
          continue;
        }
      }

      candidates.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleIndex: rule.order,
        priority: rule.priority,
        mustCheck: rule.mustCheck,
        reviewRequired: rule.reviewRequired,
        start: match.index,
        end: match.index + match[0].length,
        matched: match[0],
        replacement
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, candidates, excluded };
}
