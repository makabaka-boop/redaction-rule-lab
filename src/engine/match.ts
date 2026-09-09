import type { Candidate, EngineError, RedactionRule } from './types';
import { parseTemplate, expandTokens } from './template';

/**
 * 在【原文】上收集全部规则的命中候选。
 * 引擎只在原文上匹配一次，绝不在已替换文本上继续匹配，
 * 因此替换模板引入的字符不会触发新的命中。
 *
 * 零长度命中属于规则缺陷：记录规则编号与字符位置后停止该规则的扫描，
 * 全部错误汇总后由管线统一判失败。
 */
export function collectCandidates(
  source: string,
  rules: RedactionRule[]
): { ok: true; candidates: Candidate[] } | { ok: false; errors: EngineError[] } {
  const candidates: Candidate[] = [];
  const errors: EngineError[] = [];

  for (const rule of rules) {
    const parsed = parseTemplate(rule.template, rule.id, rule.order);
    if (!parsed.ok) {
      errors.push(...parsed.errors);
      continue;
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
        replacement: expandTokens(parsed.tokens, match)
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, candidates };
}
