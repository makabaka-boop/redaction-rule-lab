import type { AcceptedInterval, Candidate, RejectedCandidate } from './types';

export interface ArbitrationResult {
  accepted: AcceptedInterval[];
  rejected: RejectedCandidate[];
}

/**
 * 稳定裁决重叠区间：
 *   1. 优先级高者胜；
 *   2. 优先级相同，区间长者胜；
 *   3. 仍相同，规则在列表中的顺序靠前者胜；
 *   4. 再相同（同一条规则的多个命中），起始位置靠前者胜。
 * 排序键完全确定，因此同样的输入永远得到同样的裁决结果。
 * 被否决的候选记录击败它的区间与原因，供界面展示裁决依据。
 */
export function arbitrate(candidates: Candidate[]): ArbitrationResult {
  const sorted = [...candidates].sort(compareCandidates);
  const accepted: AcceptedInterval[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const candidate of sorted) {
    const blocker = accepted.find(
      (acc) => candidate.start < acc.end && acc.start < candidate.end
    );
    if (blocker === undefined) {
      accepted.push({ ...candidate, reason: '', defeated: [] });
    } else {
      rejected.push({
        ...candidate,
        winnerRuleId: blocker.ruleId,
        winnerStart: blocker.start,
        winnerEnd: blocker.end,
        reason:
          `与规则 ${blocker.ruleId} 的区间 [${blocker.start}, ${blocker.end}) 重叠，` +
          `${explainWin(blocker, candidate)}，本候选被否决`
      });
    }
  }

  // 为每个胜出区间补充裁决说明与被击败者名单。
  for (const acc of accepted) {
    const defeated = rejected.filter(
      (rej) => rej.winnerRuleId === acc.ruleId && rej.winnerStart === acc.start && rej.winnerEnd === acc.end
    );
    acc.defeated = defeated.map((rej) => ({
      ruleId: rej.ruleId,
      ruleName: rej.ruleName,
      start: rej.start,
      end: rej.end,
      reason: rej.reason
    }));
    acc.reason =
      defeated.length === 0
        ? '无重叠竞争者，直接保留'
        : defeated
            .map((rej) => `与规则 ${rej.ruleId} 的区间 [${rej.start}, ${rej.end}) 重叠，${explainWin(acc, rej)}`)
            .join('；');
  }

  accepted.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleIndex - b.ruleIndex);
  return { accepted, rejected };
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const lenA = a.end - a.start;
  const lenB = b.end - b.start;
  if (lenA !== lenB) return lenB - lenA;
  if (a.ruleIndex !== b.ruleIndex) return a.ruleIndex - b.ruleIndex;
  if (a.start !== b.start) return a.start - b.start;
  return a.end - b.end;
}

/** 用一句话解释 winner 为何胜过 loser，与排序键严格一致。 */
function explainWin(winner: Candidate, loser: Candidate): string {
  if (winner.priority !== loser.priority) {
    return `对方优先级更高（${winner.priority} > ${loser.priority}）`;
  }
  const winLen = winner.end - winner.start;
  const loseLen = loser.end - loser.start;
  if (winLen !== loseLen) {
    return `对方区间更长（${winLen} 字 > ${loseLen} 字）`;
  }
  if (winner.ruleIndex !== loser.ruleIndex) {
    return `对方规则顺序更靠前（第 ${winner.ruleIndex + 1} 条先于第 ${loser.ruleIndex + 1} 条）`;
  }
  if (winner.start !== loser.start) {
    return `对方起始位置更靠前（${winner.start} < ${loser.start}）`;
  }
  return '双方完全同区间同规则，先扫描到者保留';
}
