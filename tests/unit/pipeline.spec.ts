import { describe, expect, it } from 'vitest';
import { runPipeline } from '../../src/engine/pipeline';
import { parseRulesJson } from '../../src/engine/rules';
import type { RedactionRule } from '../../src/engine/types';

function makeRules(defs: Array<Partial<{
  id: string;
  name: string;
  pattern: string;
  flags: string;
  priority: number;
  template: string;
  mustCheck: boolean;
}>>): RedactionRule[] {
  const json = JSON.stringify({
    rules: defs.map((def, i) => ({
      id: def.id ?? `R${i + 1}`,
      name: def.name ?? `规则${i + 1}`,
      pattern: def.pattern ?? '\\d+',
      flags: def.flags ?? '',
      priority: def.priority ?? 10,
      template: def.template ?? '[X]',
      mustCheck: def.mustCheck ?? false
    }))
  });
  const parsed = parseRulesJson(json);
  if (!parsed.ok) throw new Error(`测试规则构造失败：${parsed.errors[0].message}`);
  return parsed.rules;
}

describe('runPipeline 端到端', () => {
  it('基本脱敏：命中被替换，清单与输出逐项对应', () => {
    const rules = makeRules([
      { id: 'P1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[手机号]', mustCheck: true }
    ]);
    const source = '联系人电话 13812345678，备用。';
    const result = runPipeline(source, rules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toBe('联系人电话 [手机号]，备用。');
    expect(result.accepted).toHaveLength(1);
    expect(result.checklist).toHaveLength(1);
    const entry = result.checklist[0];
    expect(result.output.slice(entry.outputStart, entry.outputEnd)).toBe(entry.replacement);
    expect(source.slice(entry.sourceStart, entry.sourceEnd)).toBe(entry.sourceText);
    expect(entry.sourceText).toBe('13812345678');
    expect(entry.ruleId).toBe('P1');
  });

  it('禁止基于已替换文本继续匹配：替换产物不触发其它规则', () => {
    const rules = makeRules([
      { id: 'RA', pattern: 'abc', priority: 50, template: '13800001111' },
      { id: 'RB', pattern: '\\d{11}', priority: 40, template: '[N]' }
    ]);
    const result = runPipeline('abc', rules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toBe('13800001111');
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].ruleId).toBe('RA');
  });

  it('必检规则被停用后仍参与残留复核：命中残留则整次失败', () => {
    const [mustRule, filler] = makeRules([
      { id: 'M1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[P]', mustCheck: true },
      { id: 'F1', name: '前缀', pattern: '电话', priority: 10, template: '[T]' }
    ]);
    // M1 被停用（不在 activeRules 中），但仍作为复核规则传入。
    const result = runPipeline('电话 13800001111', [filler], [mustRule, filler]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('MUST_CHECK_RESIDUAL');
    expect(result.errors[0].ruleId).toBe('M1');
    // 输出为 "[T] 13800001111"，残留号码从输出第 4 字符开始。
    expect(result.errors[0].position).toBe(4);
    expect(result.errors[0].message).toContain('M1');
  });

  it('必检命中在裁决中落败导致残留：失败并给出残留位置', () => {
    const rules = makeRules([
      { id: 'M1', name: '长数字串', pattern: '\\d{4,}', priority: 10, template: '[LONG]', mustCheck: true },
      { id: 'H1', name: '前四位', pattern: '1380', priority: 100, template: '####' }
    ]);
    // H1 以更高优先级夺走 [0,4)，M1 的 [0,11) 被否决；输出 "####0001111" 中仍残留 7 位数字。
    const result = runPipeline('13800001111', rules);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const residual = result.errors.find((e) => e.code === 'MUST_CHECK_RESIDUAL');
    expect(residual).toBeDefined();
    expect(residual?.ruleId).toBe('M1');
    expect(residual?.position).toBe(4);
    expect(residual?.end).toBe(11);
  });

  it('替换模板引入必检模式：输出复核拦截模板注入的敏感内容', () => {
    const rules = makeRules([
      { id: 'M1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 10, template: '[P]', mustCheck: true },
      { id: 'H1', name: '称谓', pattern: '电话', priority: 100, template: '电话13800001111' }
    ]);
    // H1 的模板把手机号写进了输出——匹配阶段从不扫描替换文本，但导出前的必检复核必须拦下。
    const result = runPipeline('联系电话。', rules);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const residual = result.errors.find((e) => e.code === 'MUST_CHECK_RESIDUAL');
    expect(residual).toBeDefined();
    expect(residual?.ruleId).toBe('M1');
    expect(residual?.position).toBe(4);
  });

  it('零长度匹配：失败并报告规则编号与字符位置', () => {
    const rules = makeRules([{ id: 'Z1', pattern: 'x*' }]);
    const result = runPipeline('abc', rules);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('ZERO_LENGTH_MATCH');
    expect(result.errors[0].ruleId).toBe('Z1');
    expect(result.errors[0].position).toBe(0);
  });

  it('空原文与空规则集分别给出明确错误', () => {
    const rules = makeRules([{ id: 'R1' }]);
    const emptySource = runPipeline('', rules);
    expect(emptySource.ok).toBe(false);
    if (!emptySource.ok) expect(emptySource.errors[0].code).toBe('SOURCE_EMPTY');

    const noRules = runPipeline('有文本', []);
    expect(noRules.ok).toBe(false);
    if (!noRules.ok) expect(noRules.errors[0].code).toBe('NO_RULES_ENABLED');
  });

  it('相同输入两次计算结果完全一致（确定性）', () => {
    const rules = makeRules([
      { id: 'A', pattern: '\\d{4}', priority: 50, template: '<$&>' },
      { id: 'B', pattern: '\\d{2}', priority: 50, template: '($&)' }
    ]);
    const source = '编号 2026 年 09 月 09 日';
    const first = runPipeline(source, rules);
    const second = runPipeline(source, rules);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.output).toBe(second.output);
    expect(first.accepted.map((a) => [a.ruleId, a.start, a.end])).toEqual(
      second.accepted.map((a) => [a.ruleId, a.start, a.end])
    );
    expect(first.rejected.map((r) => [r.ruleId, r.start, r.end])).toEqual(
      second.rejected.map((r) => [r.ruleId, r.start, r.end])
    );
  });

  it('多规则重叠时裁决稳定：优先级 > 区间长度 > 规则顺序', () => {
    const rules = makeRules([
      { id: 'LOW', pattern: '\\d{17}[\\dXx]', priority: 60, template: '[低]' },
      { id: 'HIGH', pattern: '\\d{6}(?=\\d{11}[\\dXx])', priority: 100, template: '[高]' }
    ]);
    const result = runPipeline('ID 11010119900307777X', rules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted.map((a) => a.ruleId)).toEqual(['HIGH']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].ruleId).toBe('LOW');
    expect(result.rejected[0].winnerRuleId).toBe('HIGH');
    expect(result.output).toContain('[高]');
  });

  it('清单输出区间连续覆盖全部遮蔽块，与 segments 一一对应', () => {
    const rules = makeRules([
      { id: 'R1', pattern: '\\d+', priority: 10, template: '#' }
    ]);
    const result = runPipeline('a1b22c333', rules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const maskedSegments = result.segments.filter((s) => s.kind === 'masked');
    expect(maskedSegments).toHaveLength(result.checklist.length);
    maskedSegments.forEach((seg, i) => {
      const entry = result.checklist[seg.intervalIndex];
      expect(entry.index).toBe(i);
      expect(seg.text).toBe(entry.replacement);
      expect(result.output.slice(entry.outputStart, entry.outputEnd)).toBe(seg.text);
    });
  });
});
