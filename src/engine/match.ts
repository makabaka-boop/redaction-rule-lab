import type { Candidate, EngineError, ExcludedCandidate, RedactionRule } from './types';
import { parseTemplate, expandTokens } from './template';

/**
 * 在【原文】上收集全部规则的命中候选。
 * 引擎只在原文上匹配一次，绝不在已替换文本上继续匹配，
 * 因此替换模板引入的字符不会触发新的命中。
 *
 * 非零命中展开模板后、进入重叠裁决前，若原文命中文本与规则
 * excludedValues 中任一项全量精确相等（是否忽略大小写跟随该规则的
 * i 标志），则该命中作为例外剔除：不遮蔽、不参与裁决、不进入清单与导出。
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

    // 例外值预处理为集合：比较语义跟随规则的 i 标志，与正则匹配的大小写行为一致。
    const ignoreCase = rule.flags.includes('i');
    const excludedSet = new Set(
      rule.excludedValues.map((value) => (ignoreCase ? value.toLowerCase() : value))
    );

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
      if (excludedSet.size > 0) {
        const matched = match[0];
        const key = ignoreCase ? matched.toLowerCase() : matched;
        if (excludedSet.has(key)) {
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
