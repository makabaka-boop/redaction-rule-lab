import { describe, expect, it } from 'vitest';
import { parseRulesJson } from '../../src/engine/rules';
import { runPipeline } from '../../src/engine/pipeline';
import { buildExport } from '../../src/engine/exporter';
import type { RedactionRule } from '../../src/engine/types';

function makeRules(defs: unknown[]): RedactionRule[] {
  const parsed = parseRulesJson(JSON.stringify({ rules: defs }));
  if (!parsed.ok) throw new Error(`测试规则构造失败：${parsed.errors[0].message}`);
  return parsed.rules;
}

describe('excludedValues 解析', () => {
  it('缺省 excludedValues 解析为空数组，旧规则字段保持一致', () => {
    const parsed = parseRulesJson(
      JSON.stringify({
        rules: [{ id: 'R1', name: '数字', pattern: '\\d+', priority: 10, template: '[N]' }]
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rules[0].excludedValues).toEqual([]);
  });

  it('合法例外值数组原样保留', () => {
    const parsed = parseRulesJson(
      JSON.stringify({
        rules: [
          {
            id: 'R1',
            name: '信用代码',
            pattern: '[0-9A-Z]{18}',
            priority: 10,
            template: '[C]',
            excludedValues: ['91310115MA1K4P2X8Q', 'HT-2026-001']
          }
        ]
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rules[0].excludedValues).toEqual(['91310115MA1K4P2X8Q', 'HT-2026-001']);
  });

  it('非字符串项：错误定位规则编号与数组下标', () => {
    const parsed = parseRulesJson(
      JSON.stringify({
        rules: [
          { id: 'OK1', name: '正常', pattern: 'a', priority: 1, template: '[A]' },
          {
            id: 'EX1',
            name: '例外',
            pattern: '\\d+',
            priority: 1,
            template: '[N]',
            excludedValues: ['123', 456]
          }
        ]
      })
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const error = parsed.errors.find((e) => e.ruleId === 'EX1');
    expect(error).toBeDefined();
    expect(error?.code).toBe('RULE_FIELD_INVALID');
    expect(error?.ruleIndex).toBe(1);
    expect(error?.position).toBe(1);
    expect(error?.message).toContain('EX1');
    expect(error?.message).toContain('excludedValues');
    expect(error?.message).toContain('第 1 项');
  });

  it('空值（null 与空字符串）：分别定位到数组下标', () => {
    const parsed = parseRulesJson(
      JSON.stringify({
        rules: [
          {
            id: 'EX2',
            name: '例外',
            pattern: '\\d+',
            priority: 1,
            template: '[N]',
            excludedValues: [null, '']
          }
        ]
      })
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0].position).toBe(0);
    expect(parsed.errors[1].position).toBe(1);
    for (const error of parsed.errors) {
      expect(error.ruleId).toBe('EX2');
      expect(error.ruleIndex).toBe(0);
    }
  });

  it('重复项：报错并定位到重复出现的下标', () => {
    const parsed = parseRulesJson(
      JSON.stringify({
        rules: [
          {
            id: 'EX3',
            name: '例外',
            pattern: '\\d+',
            priority: 1,
            template: '[N]',
            excludedValues: ['A', 'B', 'A']
          }
        ]
      })
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const error = parsed.errors.find((e) => e.message.includes('重复'));
    expect(error).toBeDefined();
    expect(error?.ruleId).toBe('EX3');
    expect(error?.position).toBe(2);
  });

  it('excludedValues 不是数组时报错，解析失败不产出任何部分规则', () => {
    const parsed = parseRulesJson(
      JSON.stringify({
        rules: [
          { id: 'OK1', name: '正常', pattern: 'a', priority: 1, template: '[A]' },
          { id: 'EX4', name: '例外', pattern: '\\d+', priority: 1, template: '[N]', excludedValues: '123' }
        ]
      })
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const error = parsed.errors.find((e) => e.ruleId === 'EX4');
    expect(error).toBeDefined();
    expect(error?.message).toContain('字符串数组');
  });
});

describe('excludedValues 匹配语义', () => {
  it('例外在裁决前剔除：被剔除的高优先级命中不再压制其它规则', () => {
    const rules = makeRules([
      {
        id: 'HIGH',
        name: '长数字串',
        pattern: '\\d{11}',
        priority: 100,
        template: '[LONG]',
        excludedValues: ['13800001111']
      },
      { id: 'LOW', name: '前四位', pattern: '1380', priority: 10, template: '[PREFIX]' }
    ]);
    // “电话 ”占 3 个字符：HIGH 命中 [3,14)，LOW 命中 [3,7)。
    const result = runPipeline('电话 13800001111。', rules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // HIGH 的命中被例外剔除，从未进入裁决：LOW 无竞争者直接保留，rejected 为空。
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]).toMatchObject({
      ruleId: 'HIGH',
      start: 3,
      end: 14,
      matched: '13800001111'
    });
    expect(result.accepted.map((a) => a.ruleId)).toEqual(['LOW']);
    expect(result.rejected).toHaveLength(0);
    expect(result.output).toBe('电话 [PREFIX]0001111。');
  });

  it('比较是否忽略大小写跟随规则的 i 标志', () => {
    const withI = makeRules([
      {
        id: 'R1',
        name: '代码',
        pattern: '[a-z]{3}\\d{3}',
        flags: 'i',
        priority: 10,
        template: '[C]',
        excludedValues: ['ABC123']
      }
    ]);
    const result = runPipeline('编号 abc123 与 ABC123。', withI);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // i 标志下两处命中都与例外值相等，全部剔除。
    expect(result.excluded).toHaveLength(2);
    expect(result.accepted).toHaveLength(0);
    expect(result.output).toBe('编号 abc123 与 ABC123。');
  });

  it('无 i 标志时例外比较区分大小写', () => {
    const noI = makeRules([
      {
        id: 'R1',
        name: '代码',
        pattern: '[A-Za-z]{3}\\d{3}',
        priority: 10,
        template: '[C]',
        excludedValues: ['ABC123']
      }
    ]);
    const result = runPipeline('编号 abc123 与 ABC123。', noI);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].matched).toBe('ABC123');
    expect(result.accepted).toHaveLength(1);
    expect(result.output).toBe('编号 [C] 与 ABC123。');
  });

  it('RunOk.excluded 携带规则编号、原文区间与命中文本，跨规则按原文顺序排列', () => {
    const rules = makeRules([
      { id: 'RA', name: '甲', pattern: 'bbb', priority: 10, template: '[A]', excludedValues: ['bbb'] },
      { id: 'RB', name: '乙', pattern: 'aaa', priority: 10, template: '[B]', excludedValues: ['aaa'] }
    ]);
    // RB 的命中在原文中更靠前，但收集按规则顺序进行：管线必须按原文顺序重排。
    const result = runPipeline('aaa-bbb', rules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.excluded.map((e) => [e.ruleId, e.matched, e.start, e.end])).toEqual([
      ['RB', 'aaa', 0, 3],
      ['RA', 'bbb', 4, 7]
    ]);
    expect(result.accepted).toHaveLength(0);
    expect(result.output).toBe('aaa-bbb');
  });

  it('合法例外不进入 AcceptedInterval、人工确认清单与导出文件', () => {
    const rules = makeRules([
      {
        id: 'P1',
        name: '手机号',
        pattern: '1[3-9]\\d{9}',
        priority: 90,
        template: '[手机号]',
        excludedValues: ['13800001111']
      }
    ]);
    const result = runPipeline('电话 13800001111 或 13755556666。', rules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toHaveLength(1);
    expect(result.checklist).toHaveLength(1);
    expect(result.checklist[0].sourceText).toBe('13755556666');
    expect(result.reviewRequiredCount).toBe(0);
    const bundle = buildExport(result);
    expect(bundle.selfCheckErrors).toEqual([]);
    // 例外原文保留在脱敏文本中，但不作为条目进入清单 JSON。
    expect(bundle.redactedText).toContain('13800001111');
    expect(bundle.redactedText).toContain('[手机号]');
    expect(bundle.checklistJson).not.toContain('13800001111');
  });

  it('必检残留复核仍可发现例外配置造成的敏感内容', () => {
    const rules = makeRules([
      {
        id: 'M1',
        name: '手机号',
        pattern: '1[3-9]\\d{9}',
        priority: 90,
        template: '[手机号]',
        mustCheck: true,
        excludedValues: ['13800001111']
      }
    ]);
    // 例外值留在输出中，必检复核必须拦下：整次失败并给出残留位置。
    const result = runPipeline('电话 13800001111。', rules);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const residual = result.errors.find((e) => e.code === 'MUST_CHECK_RESIDUAL');
    expect(residual).toBeDefined();
    expect(residual?.ruleId).toBe('M1');
    expect(residual?.position).toBe(3);
    expect(residual?.end).toBe(14);
  });
});
