import { describe, expect, it } from 'vitest';
import { collectCandidates } from '../../src/engine/match';
import { parseRulesJson } from '../../src/engine/rules';
import type { RedactionRule } from '../../src/engine/types';

function makeRule(overrides: Partial<{
  id: string;
  name: string;
  pattern: string;
  flags: string;
  priority: number;
  template: string;
  mustCheck: boolean;
}>): RedactionRule {
  const json = JSON.stringify({
    rules: [
      {
        id: overrides.id ?? 'R1',
        name: overrides.name ?? '测试规则',
        pattern: overrides.pattern ?? '\\d+',
        flags: overrides.flags ?? '',
        priority: overrides.priority ?? 10,
        template: overrides.template ?? '[X]',
        mustCheck: overrides.mustCheck ?? false
      }
    ]
  });
  const parsed = parseRulesJson(json);
  if (!parsed.ok) throw new Error(`测试规则构造失败：${parsed.errors[0].message}`);
  return parsed.rules[0];
}

describe('collectCandidates（只在原文上匹配）', () => {
  it('收集全部命中并展开替换模板', () => {
    const rule = makeRule({ pattern: '\\d{4}', template: '[$&]' });
    const result = collectCandidates('a 1234 b 5678 c', [rule]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({ start: 2, end: 6, matched: '1234', replacement: '[1234]' });
    expect(result.candidates[1]).toMatchObject({ start: 9, end: 13 });
  });

  it('零长度匹配报错，给出规则编号与字符位置', () => {
    const rule = makeRule({ id: 'RZ', pattern: 'x*' });
    const result = collectCandidates('abc', [rule]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('ZERO_LENGTH_MATCH');
    expect(result.errors[0].ruleId).toBe('RZ');
    expect(result.errors[0].position).toBe(0);
  });

  it('多条规则同时命中同一原文区间时全部保留，交由裁决层处理', () => {
    const wide = makeRule({ id: 'RW', pattern: '\\d{17}[\\dXx]', priority: 100 });
    const narrow = makeRule({ id: 'RN', pattern: '\\d{6}', priority: 10 });
    const result = collectCandidates('ID:11010119900307777X end', [wide, narrow]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const atStart = result.candidates.filter((c) => c.start === 3);
    expect(atStart.map((c) => c.ruleId).sort()).toEqual(['RN', 'RW']);
  });

  it('替换文本不会成为新的匹配对象（只扫描原文）', () => {
    // 规则 A 把 "abc" 替换为 11 位数字；规则 B 匹配 11 位数字。
    // 若引擎在替换结果上继续匹配，B 会命中 A 的替换内容 —— 此处必须只有 A 一个候选。
    const a = makeRule({ id: 'RA', pattern: 'abc', template: '12345678901', priority: 50 });
    const b = makeRule({ id: 'RB', pattern: '\\d{11}', template: '[N]', priority: 40 });
    const result = collectCandidates('abc', [a, b]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].ruleId).toBe('RA');
  });

  it('lastIndex 状态不会跨规则串扰', () => {
    const rule = makeRule({ pattern: '\\d' });
    const first = collectCandidates('1 2 3', [rule]);
    const second = collectCandidates('4 5', [rule]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.candidates).toHaveLength(3);
    expect(second.candidates).toHaveLength(2);
    expect(second.candidates[0].matched).toBe('4');
  });
});
