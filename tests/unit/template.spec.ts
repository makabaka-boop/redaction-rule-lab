import { describe, expect, it } from 'vitest';
import { expandTemplate, parseTemplate } from '../../src/engine/template';

function execOn(pattern: string, flags: string, text: string): RegExpExecArray {
  const match = new RegExp(pattern, flags).exec(text);
  if (match === null) throw new Error(`测试前置失败：/${pattern}/ 未命中 "${text}"`);
  return match;
}

describe('替换模板展开', () => {
  it('$& 展开为整个命中片段', () => {
    const match = execOn('\\d+', 'g', '编号 12345 完');
    expect(expandTemplate('[ID:$&]', match)).toBe('[ID:12345]');
  });

  it('$1..$9 展开为对应捕获组，缺失组展开为空串', () => {
    const match = execOn('(\\d{3})-(\\d{4})', 'g', '010-1234');
    expect(expandTemplate('$1****', match)).toBe('010****');
    expect(expandTemplate('[$3]', match)).toBe('[]');
  });

  it('$<name> 展开为命名捕获组', () => {
    const match = execOn('(?<year>\\d{4})-(?<month>\\d{2})', 'g', '2026-09');
    expect(expandTemplate('$<year>年$<month>月', match)).toBe('2026年09月');
  });

  it('$$ 展开为字面量美元符号', () => {
    const match = execOn('\\d+', 'g', '100');
    expect(expandTemplate('$$$&', match)).toBe('$100');
  });

  it('普通文本原样保留', () => {
    const match = execOn('secret', 'g', 'a secret b');
    expect(expandTemplate('[已遮蔽]', match)).toBe('[已遮蔽]');
  });

  it('非法占位符在校验阶段报错并给出模板内字符位置', () => {
    const parsed = parseTemplate('金额$q元', 'R3', 2);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].position).toBe(2);
    expect(parsed.errors[0].ruleId).toBe('R3');
    expect(parsed.errors[0].message).toContain('$q');
  });

  it('末尾孤立 $ 报错', () => {
    const parsed = parseTemplate('abc$', 'R1', 0);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].position).toBe(3);
  });

  it('$< 未闭合报错并指向起始位置', () => {
    const parsed = parseTemplate('x$<name', 'R1', 0);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].position).toBe(1);
  });

  it('展开过程不修改原始命中数组', () => {
    const match = execOn('(\\d+)', 'g', '42');
    expandTemplate('[$1][$&]', match);
    expect(match[0]).toBe('42');
    expect(match[1]).toBe('42');
  });
});
