import type { EngineError, RedactionRule, RunResult } from './types';
import { collectCandidates } from './match';
import { arbitrate } from './arbitrate';
import { renderOutput } from './render';

/**
 * 完整管线：匹配（仅原文） → 裁决 → 渲染 → 必检复核。
 * 任何一步失败都返回全部结构化错误，不携带部分产物；
 * 调用方据此保留上一份有效结果，避免污染。
 *
 * @param activeRules  参与匹配的规则（已剔除界面停用的）。
 * @param verifyRules  必检复核使用的规则全集——含被停用的规则。
 *                     必检项是导出闸门：即使用户停用了某条必检规则，
 *                     其模式残留在输出中同样判失败并锁定导出。
 */
export function runPipeline(
  source: string,
  activeRules: RedactionRule[],
  verifyRules: RedactionRule[] = activeRules
): RunResult {
  if (source.length === 0) {
    return {
      ok: false,
      errors: [
        { code: 'SOURCE_EMPTY', message: '原文为空：请先粘贴文本或载入本地 TXT 文件', position: 0 }
      ]
    };
  }
  if (activeRules.length === 0) {
    return {
      ok: false,
      errors: [{ code: 'NO_RULES_ENABLED', message: '没有已启用的规则：请载入规则或开启至少一条规则' }]
    };
  }

  const collected = collectCandidates(source, activeRules);
  if (!collected.ok) return { ok: false, errors: collected.errors };

  const { accepted, rejected } = arbitrate(collected.candidates);
  const { output, segments, checklist } = renderOutput(source, accepted);

  const residualErrors = verifyMustCheck(output, verifyRules);
  if (residualErrors.length > 0) {
    return { ok: false, errors: residualErrors };
  }

  // 人工复核计数：引擎只给出“需要确认”的区间，确认状态由 store 对账维护。
  const reviewRequiredCount = checklist.filter((entry) => entry.reviewRequired).length;

  // 被例外值剔除的命中按原文顺序排列，供规则面板计数与详情区逐项核对。
  const excluded = [...collected.excluded].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.ruleIndex - b.ruleIndex
  );

  return {
    ok: true,
    source,
    output,
    segments,
    accepted,
    rejected,
    excluded,
    checklist,
    activeRules,
    reviewRequiredCount,
    reviewConfirmedCount: 0,
    reviewPendingCount: reviewRequiredCount
  };
}

/**
 * 必检复核：对【最终脱敏文本】重新执行所有 mustCheck 规则。
 * 这是对成品的只读校验，不参与脱敏计算，因此不违反
 * “禁止基于已替换文本继续匹配”的约束（匹配阶段只发生在原文上）。
 * 典型触发场景：必检规则被停用，或其命中在裁决中输给了其它规则，
 * 导致敏感片段残留在输出里 —— 此时整次运行判失败并禁止导出。
 */
export function verifyMustCheck(output: string, rules: RedactionRule[]): EngineError[] {
  const errors: EngineError[] = [];
  for (const rule of rules) {
    if (!rule.mustCheck) continue;
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = regex.exec(output)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex = match.index + 1;
        continue;
      }
      errors.push({
        code: 'MUST_CHECK_RESIDUAL',
        ruleId: rule.id,
        ruleIndex: rule.order,
        position: match.index,
        end: match.index + match[0].length,
        message:
          `必检规则 ${rule.id}（${rule.name}）在脱敏文本的 [${match.index}, ${match.index + match[0].length}) ` +
          `处仍有残留命中，本次结果作废且禁止导出`
      });
      guard += 1;
      if (guard >= 100) {
        errors.push({
          code: 'MUST_CHECK_RESIDUAL',
          ruleId: rule.id,
          ruleIndex: rule.order,
          message: `必检规则 ${rule.id}（${rule.name}）残留命中超过 100 处，仅列出前 100 处`
        });
        break;
      }
    }
  }
  return errors;
}
