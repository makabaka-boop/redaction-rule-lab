import { describe, expect, it } from 'vitest';
import { arbitrate } from '../../src/engine/arbitrate';
import type { Candidate } from '../../src/engine/types';

function cand(partial: Partial<Candidate> & { start: number; end: number }): Candidate {
  return {
    ruleId: partial.ruleId ?? 'R1',
    ruleName: partial.ruleName ?? partial.ruleId ?? 'R1',
    ruleIndex: partial.ruleIndex ?? 0,
    priority: partial.priority ?? 10,
    mustCheck: partial.mustCheck ?? false,
    start: partial.start,
    end: partial.end,
    matched: partial.matched ?? 'x'.repeat(partial.end - partial.start),
    replacement: partial.replacement ?? '[X]'
  };
}

describe('arbitrate 重叠裁决', () => {
  it('优先级高者胜出，败者记录原因与胜者区间', () => {
    const low = cand({ ruleId: 'RL', ruleIndex: 0, priority: 10, start: 0, end: 6 });
    const high = cand({ ruleId: 'RH', ruleIndex: 1, priority: 90, start: 3, end: 9 });
    const { accepted, rejected } = arbitrate([low, high]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].ruleId).toBe('RH');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].ruleId).toBe('RL');
    expect(rejected[0].winnerRuleId).toBe('RH');
    expect(rejected[0].winnerStart).toBe(3);
    expect(rejected[0].winnerEnd).toBe(9);
    expect(rejected[0].reason).toContain('优先级');
    expect(rejected[0].reason).toContain('90');
  });

  it('优先级相同时区间更长者胜出', () => {
    const short = cand({ ruleId: 'RS', ruleIndex: 0, priority: 50, start: 0, end: 4 });
    const long = cand({ ruleId: 'RL', ruleIndex: 1, priority: 50, start: 2, end: 10 });
    const { accepted, rejected } = arbitrate([short, long]);
    expect(accepted.map((a) => a.ruleId)).toEqual(['RL']);
    expect(rejected[0].reason).toContain('区间更长');
  });

  it('优先级与长度都相同时规则顺序靠前者胜出', () => {
    const first = cand({ ruleId: 'RA', ruleIndex: 0, priority: 50, start: 0, end: 4 });
    const second = cand({ ruleId: 'RB', ruleIndex: 1, priority: 50, start: 2, end: 6 });
    const { accepted, rejected } = arbitrate([second, first]);
    expect(accepted.map((a) => a.ruleId)).toEqual(['RA']);
    expect(rejected[0].reason).toContain('规则顺序更靠前');
  });

  it('同一规则的重叠命中按起始位置稳定取舍', () => {
    const a = cand({ ruleId: 'R1', ruleIndex: 0, priority: 50, start: 0, end: 4 });
    const b = cand({ ruleId: 'R1', ruleIndex: 0, priority: 50, start: 2, end: 6 });
    const { accepted } = arbitrate([b, a]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].start).toBe(0);
  });

  it('不重叠的候选全部保留，结果按原文顺序排列', () => {
    const a = cand({ ruleId: 'R1', ruleIndex: 0, start: 10, end: 12 });
    const b = cand({ ruleId: 'R2', ruleIndex: 1, start: 0, end: 3 });
    const c = cand({ ruleId: 'R3', ruleIndex: 2, start: 5, end: 8 });
    const { accepted, rejected } = arbitrate([a, b, c]);
    expect(rejected).toHaveLength(0);
    expect(accepted.map((x) => x.start)).toEqual([0, 5, 10]);
  });

  it('端点相接（end === start）不算重叠', () => {
    const a = cand({ ruleId: 'R1', ruleIndex: 0, start: 0, end: 5 });
    const b = cand({ ruleId: 'R2', ruleIndex: 1, start: 5, end: 9 });
    const { accepted, rejected } = arbitrate([a, b]);
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(2);
  });

  it('裁决结果与候选传入顺序无关（稳定性）', () => {
    const candidates = [
      cand({ ruleId: 'RA', ruleIndex: 0, priority: 30, start: 0, end: 6 }),
      cand({ ruleId: 'RB', ruleIndex: 1, priority: 80, start: 2, end: 8 }),
      cand({ ruleId: 'RC', ruleIndex: 2, priority: 80, start: 7, end: 12 }),
      cand({ ruleId: 'RD', ruleIndex: 3, priority: 10, start: 20, end: 25 })
    ];
    const reversed = [...candidates].reverse();
    const r1 = arbitrate(candidates);
    const r2 = arbitrate(reversed);
    expect(r1.accepted.map((a) => `${a.ruleId}@${a.start}`)).toEqual(
      r2.accepted.map((a) => `${a.ruleId}@${a.start}`)
    );
    expect(r1.rejected.map((a) => `${a.ruleId}@${a.start}`)).toEqual(
      r2.rejected.map((a) => `${a.ruleId}@${a.start}`)
    );
  });

  it('胜者记录被击败者名单与裁决说明', () => {
    const winner = cand({ ruleId: 'RW', ruleIndex: 0, priority: 99, start: 0, end: 10 });
    const loser1 = cand({ ruleId: 'L1', ruleIndex: 1, priority: 10, start: 1, end: 3 });
    const loser2 = cand({ ruleId: 'L2', ruleIndex: 2, priority: 20, start: 5, end: 8 });
    const { accepted } = arbitrate([winner, loser1, loser2]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].defeated.map((d) => d.ruleId).sort()).toEqual(['L1', 'L2']);
    expect(accepted[0].reason).toContain('L1');
    expect(accepted[0].reason).toContain('L2');
  });

  it('无竞争者的区间说明为直接保留', () => {
    const solo = cand({ ruleId: 'R1', ruleIndex: 0, start: 0, end: 3 });
    const { accepted } = arbitrate([solo]);
    expect(accepted[0].reason).toBe('无重叠竞争者，直接保留');
  });
});
