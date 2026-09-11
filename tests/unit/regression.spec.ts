import { describe, expect, it } from 'vitest';
import {
  diffRuleSequences,
  firstTextDiff,
  parseSamplesJson,
  runRegression
} from '../../src/engine/regression';
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

const phoneRules = () =>
  makeRules([
    { id: 'P1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[手机号]', mustCheck: true }
  ]);

describe('parseSamplesJson 样例解析', () => {
  it('解析 {samples:[...]} 与纯数组两种形态，按文件顺序保留样例', () => {
    const wrapped = parseSamplesJson(
      JSON.stringify({
        samples: [
          { id: 'C1', source: '电话 13800001111', expected: '电话 [手机号]' },
          { id: 'C2', source: '电话 13900002222', expected: '电话 [手机号]', expectedRules: ['P1'] }
        ]
      })
    );
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    expect(wrapped.samples.map((s) => s.id)).toEqual(['C1', 'C2']);
    expect(wrapped.samples[1].expectedRules).toEqual(['P1']);
    expect(wrapped.samples[0].expectedRules).toBeNull();

    const arr = parseSamplesJson(
      JSON.stringify([{ id: 'A1', source: 's', expected: 'e' }])
    );
    expect(arr.ok).toBe(true);
    if (arr.ok) expect(arr.samples).toHaveLength(1);
  });

  it('非法 JSON 语法：报 SAMPLES_JSON_INVALID', () => {
    const result = parseSamplesJson('{"samples": [ { ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('SAMPLES_JSON_INVALID');
    expect(result.errors[0].message).toContain('不是合法 JSON');
  });

  it('顶层既不是数组也不含 samples 数组：报形态错误', () => {
    const result = parseSamplesJson(JSON.stringify({ nope: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('SAMPLES_SHAPE_INVALID');
  });

  it('空样例列表：报形态错误', () => {
    const result = parseSamplesJson(JSON.stringify({ samples: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('SAMPLES_SHAPE_INVALID');
  });

  it('编号重复：错误定位到样例编号与数组下标，且不返回部分样例', () => {
    const result = parseSamplesJson(
      JSON.stringify({
        samples: [
          { id: 'DUP', source: 'a', expected: 'a' },
          { id: 'DUP', source: 'b', expected: 'b' }
        ]
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const error = result.errors.find((e) => e.message.includes('重复'));
    expect(error).toBeDefined();
    expect(error?.ruleId).toBe('DUP');
    expect(error?.position).toBe(1);
  });

  it('编号缺失/非字符串：错误带数组下标（第 N 项）', () => {
    const result = parseSamplesJson(JSON.stringify({ samples: [{ source: 'a', expected: 'a' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].position).toBe(0);
    expect(result.errors[0].message).toContain('第 1 项');
    expect(result.errors[0].message).toContain('下标 0');
  });

  it('source / expected 字段类型错误：定位到样例编号', () => {
    const result = parseSamplesJson(
      JSON.stringify({ samples: [{ id: 'C9', source: 123, expected: null }] })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.ruleId === 'C9' && e.message.includes('source'))).toBe(true);
    expect(result.errors.some((e) => e.ruleId === 'C9' && e.message.includes('expected'))).toBe(true);
  });

  it('expectedRules 不是数组或含非字符串：定位到样例编号与数组下标', () => {
    const badType = parseSamplesJson(
      JSON.stringify({ samples: [{ id: 'C1', source: 'a', expected: 'a', expectedRules: 'P1' }] })
    );
    expect(badType.ok).toBe(false);
    if (!badType.ok) expect(badType.errors[0].message).toContain('expectedRules');

    const badItem = parseSamplesJson(
      JSON.stringify({
        samples: [{ id: 'C2', source: 'a', expected: 'a', expectedRules: ['P1', '', 'P2'] }]
      })
    );
    expect(badItem.ok).toBe(false);
    if (badItem.ok) return;
    const error = badItem.errors.find((e) => e.message.includes('第 1 项'));
    expect(error).toBeDefined();
    expect(error?.ruleId).toBe('C2');
    expect(error?.position).toBe(1);
  });

  it('单项不是对象：错误带数组下标', () => {
    const result = parseSamplesJson(JSON.stringify({ samples: [{ id: 'X', source: 'a', expected: 'a' }, 42] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const error = result.errors.find((e) => e.message.includes('必须是对象'));
    expect(error?.position).toBe(1);
    expect(error?.message).toContain('下标 1');
  });

  it('空字符串原文合法（交由管线判定），但 expected 必须存在', () => {
    const ok = parseSamplesJson(JSON.stringify({ samples: [{ id: 'E1', source: '', expected: '' }] }));
    expect(ok.ok).toBe(true);
  });
});

describe('firstTextDiff 首个文本差异定位', () => {
  it('完全相等返回 null', () => {
    expect(firstTextDiff('abc', 'abc')).toBeNull();
  });

  it('返回首个不同字符下标', () => {
    const diff = firstTextDiff('电话 [手机号]，备用', '电话 [手机]，备用');
    // 电0 话1 空2 [3 手4 机5，首个不同字符「号」位于 6。
    expect(diff?.index).toBe(6);
  });

  it('前缀相同仅长度不同：差异位置为较短串长度，片段包含上下文', () => {
    const diff = firstTextDiff('abcXYZ', 'abc');
    expect(diff?.index).toBe(3);
    expect(diff?.actualSnippet).toContain('X');
    expect(diff?.expectedSnippet).toBe('abc');
  });

  it('片段在差异前后给出省略号上下文', () => {
    const actual = '0123456789ABCDEF-diff-tail';
    const expected = '0123456789ABCDEF-DIFF-tail';
    const diff = firstTextDiff(actual, expected);
    expect(diff?.index).toBe(17);
    expect(diff?.actualSnippet).toContain('…');
    expect(diff?.expectedSnippet).toContain('…');
  });
});

describe('diffRuleSequences 规则序列对齐', () => {
  it('序列一致：matched 为 true 且无差异操作', () => {
    const diff = diffRuleSequences(['R1', 'R2'], ['R1', 'R2']);
    expect(diff.matched).toBe(true);
    expect(diff.firstMismatchIndex).toBeNull();
    expect(diff.ops.every((op) => op.kind === 'same')).toBe(true);
  });

  it('实际多出的命中标 actual-only，期望多出的标 expected-only', () => {
    const diff = diffRuleSequences(['R1', 'R2'], ['R1']);
    expect(diff.matched).toBe(false);
    expect(diff.firstMismatchIndex).toBe(1);
    expect(diff.ops).toContainEqual(
      expect.objectContaining({ kind: 'actual-only', ruleId: 'R2' })
    );

    const diff2 = diffRuleSequences(['R1'], ['R1', 'R3']);
    expect(diff2.ops).toContainEqual(
      expect.objectContaining({ kind: 'expected-only', ruleId: 'R3' })
    );
  });

  it('同编号乱序按 LCS 对齐，标出首个不一致位置', () => {
    const diff = diffRuleSequences(['R1', 'R2'], ['R2', 'R1']);
    expect(diff.matched).toBe(false);
    expect(diff.firstMismatchIndex).toBe(0);
    expect(diff.ops.filter((op) => op.kind === 'same')).toHaveLength(1);
  });
});

describe('runRegression 顺序执行与单项隔离', () => {
  it('按文件顺序产出结果，全部通过时 allPassed', () => {
    const samples = parseOrThrow([
      { id: 'S1', source: '电话 13800001111。', expected: '电话 [手机号]。' },
      { id: 'S2', source: '电话 13900002222。', expected: '电话 [手机号]。', expectedRules: ['P1'] }
    ]);
    const report = runRegression(samples, phoneRules());
    expect(report.totalCount).toBe(2);
    expect(report.passCount).toBe(2);
    expect(report.failCount).toBe(0);
    expect(report.allPassed).toBe(true);
    expect(report.results.map((r) => r.sampleId)).toEqual(['S1', 'S2']);
    expect(report.results[1].actualRules).toEqual(['P1']);
  });

  it('脱敏文本不符：status=text-mismatch 并带首个差异位置与片段', () => {
    const samples = parseOrThrow([
      { id: 'S1', source: '电话 13800001111。', expected: '电话 [手机]。' }
    ]);
    const report = runRegression(samples, phoneRules());
    const item = report.results[0];
    expect(item.status).toBe('text-mismatch');
    expect(item.textDiff?.index).toBe(6);
    expect(item.actual).toBe('电话 [手机号]。');
    expect(report.allPassed).toBe(false);
  });

  it('规则序列不符但文本一致：status=sequence-mismatch 并给序列差异', () => {
    const samples = parseOrThrow([
      { id: 'S1', source: '电话 13800001111。', expected: '电话 [手机号]。', expectedRules: ['P1', 'P1'] }
    ]);
    const report = runRegression(samples, phoneRules());
    const item = report.results[0];
    expect(item.status).toBe('sequence-mismatch');
    expect(item.textDiff).toBeNull();
    expect(item.sequenceDiff?.matched).toBe(false);
    expect(item.sequenceDiff?.ops.some((op) => op.kind === 'expected-only')).toBe(true);
  });

  it('单项管线失败（零长度匹配）：该项 pipeline-error 并显示原有规则编号与位置，不覆盖其它项', () => {
    const rules = makeRules([{ id: 'Z9', name: '零宽', pattern: 'x*', priority: 1, template: '[Z]' }]);
    const samples = parseOrThrow([
      { id: 'BAD', source: 'abc', expected: '不应到达' },
      { id: 'OK', source: '', expected: '' }
    ]);
    const report = runRegression(samples, rules);
    expect(report.results).toHaveLength(2);
    const bad = report.results[0];
    expect(bad.status).toBe('pipeline-error');
    const zeroError = bad.errors.find((e) => e.code === 'ZERO_LENGTH_MATCH');
    expect(zeroError?.ruleId).toBe('Z9');
    expect(zeroError?.position).toBe(0);
    // 第二项照常独立产出（空原文同样是管线错误，但来自 SOURCE_EMPTY，而非被第一项污染）。
    const ok = report.results[1];
    expect(ok.status).toBe('pipeline-error');
    expect(ok.errors[0].code).toBe('SOURCE_EMPTY');
  });

  it('必检残留在样例管线中同样判失败，保留 MUST_CHECK_RESIDUAL 位置', () => {
    const [mustRule, filler] = makeRules([
      { id: 'M1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[P]', mustCheck: true },
      { id: 'F1', name: '前缀', pattern: '电话', priority: 10, template: '[T]' }
    ]);
    // M1 被停用：active 只含 filler，复核仍用全集。
    const samples = parseOrThrow([{ id: 'S1', source: '电话 13800001111', expected: '[T] 13800001111' }]);
    const report = runRegression(samples, [filler], [mustRule, filler]);
    const item = report.results[0];
    expect(item.status).toBe('pipeline-error');
    const residual = item.errors.find((e) => e.code === 'MUST_CHECK_RESIDUAL');
    expect(residual?.ruleId).toBe('M1');
    expect(residual?.position).toBe(4);
  });

  it('多个命中：实际规则序列按原文顺序取自清单', () => {
    const samples = parseOrThrow([
      {
        id: 'S1',
        source: '电话 13800001111 与 13900002222',
        expected: '电话 [手机号] 与 [手机号]',
        expectedRules: ['P1', 'P1']
      }
    ]);
    const report = runRegression(samples, phoneRules());
    expect(report.results[0].status).toBe('pass');
    expect(report.results[0].actualRules).toEqual(['P1', 'P1']);
  });
});

function parseOrThrow(raw: Array<{ id: string; source: string; expected: string; expectedRules?: string[] }>) {
  const parsed = parseSamplesJson(JSON.stringify({ samples: raw }));
  if (!parsed.ok) throw new Error(`测试样例构造失败：${parsed.errors.map((e) => e.message).join('; ')}`);
  return parsed.samples;
}
