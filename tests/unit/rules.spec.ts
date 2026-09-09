import { describe, expect, it } from 'vitest';
import { parseRulesJson } from '../../src/engine/rules';

function rulesJson(rules: unknown[]): string {
  return JSON.stringify({ rules });
}

describe('parseRulesJson 规则解析', () => {
  it('合法规则集解析成功，保留全部字段', () => {
    const parsed = parseRulesJson(
      rulesJson([
        {
          id: 'R1',
          name: '身份证号',
          pattern: '\\b\\d{17}[\\dXx]\\b',
          flags: '',
          priority: 100,
          template: '[证件号]',
          mustCheck: true,
          enabled: true
        }
      ])
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rules).toHaveLength(1);
    const rule = parsed.rules[0];
    expect(rule.id).toBe('R1');
    expect(rule.name).toBe('身份证号');
    expect(rule.priority).toBe(100);
    expect(rule.mustCheck).toBe(true);
    expect(rule.enabledByDefault).toBe(true);
    expect(rule.regex.source).toBe('\\b\\d{17}[\\dXx]\\b');
    expect(rule.regex.flags).toContain('g');
  });

  it('enabled:false 的规则解析为默认停用', () => {
    const parsed = parseRulesJson(
      rulesJson([
        { id: 'R1', name: 'A', pattern: 'a', priority: 1, template: '[A]', enabled: false }
      ])
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rules[0].enabledByDefault).toBe(false);
  });

  it('非法正则：报错携带规则编号与规则序号', () => {
    const parsed = parseRulesJson(
      rulesJson([
        { id: 'OK1', name: '正常', pattern: 'a+', priority: 1, template: '[A]' },
        { id: 'BAD9', name: '坏正则', pattern: '([a-z', priority: 2, template: '[B]' }
      ])
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const error = parsed.errors.find((e) => e.code === 'REGEX_INVALID');
    expect(error).toBeDefined();
    expect(error?.ruleId).toBe('BAD9');
    expect(error?.ruleIndex).toBe(1);
    expect(error?.message).toContain('BAD9');
    expect(error?.message).toContain('第 2 条');
  });

  it('多条规则同时出错时全部汇总，不在第一条停止', () => {
    const parsed = parseRulesJson(
      rulesJson([
        { id: 'E1', name: '甲', pattern: '(', priority: 1, template: '[A]' },
        { id: 'E2', name: '乙', pattern: '[', priority: 2, template: '[B]' },
        { id: 'E3', name: '丙', pattern: 'ok', priority: 3, template: '[C]' }
      ])
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const ids = parsed.errors.map((e) => e.ruleId);
    expect(ids).toContain('E1');
    expect(ids).toContain('E2');
  });

  it('非法 flags：报错给出规则编号与字符位置', () => {
    const parsed = parseRulesJson(
      rulesJson([{ id: 'F1', name: '标志', pattern: 'a', flags: 'igq', priority: 1, template: '[A]' }])
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const flagErrors = parsed.errors.filter((e) => e.code === 'FLAGS_INVALID');
    expect(flagErrors.length).toBeGreaterThanOrEqual(2);
    expect(flagErrors[0].ruleId).toBe('F1');
    expect(flagErrors[0].position).toBeTypeOf('number');
    expect(flagErrors[0].message).toContain('F1');
  });

  it('重复规则编号：报错指出重复的规则编号', () => {
    const parsed = parseRulesJson(
      rulesJson([
        { id: 'DUP', name: '甲', pattern: 'a', priority: 1, template: '[A]' },
        { id: 'DUP', name: '乙', pattern: 'b', priority: 2, template: '[B]' }
      ])
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const dup = parsed.errors.find((e) => e.message.includes('重复'));
    expect(dup).toBeDefined();
    expect(dup?.ruleId).toBe('DUP');
    expect(dup?.ruleIndex).toBe(1);
  });

  it('非法替换模板：报错给出规则编号与模板内字符位置', () => {
    const parsed = parseRulesJson(
      rulesJson([{ id: 'T1', name: '模板', pattern: 'a', priority: 1, template: '金额$q元' }])
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const tpl = parsed.errors.find((e) => e.code === 'TEMPLATE_INVALID');
    expect(tpl).toBeDefined();
    expect(tpl?.ruleId).toBe('T1');
    expect(tpl?.position).toBe(2);
  });

  it('缺少必填字段：逐条报告并携带规则编号', () => {
    const parsed = parseRulesJson(rulesJson([{ id: 'M1', name: '缺字段' }]));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.length).toBeGreaterThanOrEqual(3);
    for (const error of parsed.errors) {
      expect(error.ruleId).toBe('M1');
    }
  });

  it('顶层结构非法与 JSON 语法错误分别报告', () => {
    const badJson = parseRulesJson('{ "rules": [');
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.errors[0].code).toBe('RULES_JSON_INVALID');

    const badShape = parseRulesJson('{"notRules": []}');
    expect(badShape.ok).toBe(false);
    if (!badShape.ok) expect(badShape.errors[0].code).toBe('RULES_SHAPE_INVALID');

    const empty = parseRulesJson('{"rules": []}');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors[0].code).toBe('RULES_SHAPE_INVALID');
  });

  it('priority 必须为有限数值', () => {
    const parsed = parseRulesJson(
      rulesJson([{ id: 'P1', name: '优先级', pattern: 'a', priority: 'high', template: '[A]' }])
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].ruleId).toBe('P1');
    expect(parsed.errors[0].message).toContain('priority');
  });

  it('未提供 id 时按顺序自动编号，且编号可用于定位错误', () => {
    const parsed = parseRulesJson(
      rulesJson([
        { name: '甲', pattern: 'a', priority: 1, template: '[A]' },
        { name: '乙', pattern: '(', priority: 2, template: '[B]' }
      ])
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].ruleId).toBe('R2');
    expect(parsed.errors[0].ruleIndex).toBe(1);
  });
});
