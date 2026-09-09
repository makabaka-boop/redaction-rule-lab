import type { EngineError } from './types';

/**
 * 替换模板：
 *   $$       -> 字面量 $
 *   $&       -> 整个命中片段
 *   $1..$99  -> 第 n 个捕获组（不存在时展开为空串）
 *   $<name>  -> 命名捕获组（不存在时展开为空串）
 * 其它 $ 用法一律视为模板错误，并在校验时给出模板内的字符位置。
 */

export interface TemplateToken {
  kind: 'literal' | 'whole' | 'group' | 'named';
  text?: string;
  index?: number;
  name?: string;
}

export function parseTemplate(
  template: string,
  ruleId: string,
  ruleIndex: number
): { ok: true; tokens: TemplateToken[] } | { ok: false; errors: EngineError[] } {
  const tokens: TemplateToken[] = [];
  const errors: EngineError[] = [];
  let literal = '';
  const flush = () => {
    if (literal.length > 0) {
      tokens.push({ kind: 'literal', text: literal });
      literal = '';
    }
  };

  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== '$') {
      literal += ch;
      i += 1;
      continue;
    }
    const next = template[i + 1];
    if (next === '$') {
      literal += '$';
      i += 2;
      continue;
    }
    if (next === '&') {
      flush();
      tokens.push({ kind: 'whole' });
      i += 2;
      continue;
    }
    if (next !== undefined && next >= '1' && next <= '9') {
      let j = i + 1;
      let num = '';
      while (j < template.length && template[j] >= '0' && template[j] <= '9' && num.length < 2) {
        num += template[j];
        j += 1;
      }
      flush();
      tokens.push({ kind: 'group', index: Number(num) });
      i = j;
      continue;
    }
    if (next === '<') {
      const close = template.indexOf('>', i + 2);
      if (close === -1) {
        errors.push({
          code: 'TEMPLATE_INVALID',
          ruleId,
          ruleIndex,
          position: i,
          message: `规则 ${ruleId}：替换模板第 ${i} 个字符处的 "$<" 缺少收尾的 ">"`
        });
        i += 2;
        continue;
      }
      const name = template.slice(i + 2, close);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        errors.push({
          code: 'TEMPLATE_INVALID',
          ruleId,
          ruleIndex,
          position: i,
          message: `规则 ${ruleId}：替换模板第 ${i} 个字符处的命名捕获 "${name}" 不是合法标识符`
        });
        i = close + 1;
        continue;
      }
      flush();
      tokens.push({ kind: 'named', name });
      i = close + 1;
      continue;
    }
    errors.push({
      code: 'TEMPLATE_INVALID',
      ruleId,
      ruleIndex,
      position: i,
      message:
        next === undefined
          ? `规则 ${ruleId}：替换模板第 ${i} 个字符处的 "$" 位于末尾，请写作 "$$"`
          : `规则 ${ruleId}：替换模板第 ${i} 个字符处的 "$${next}" 不是合法占位符（支持 $$、$&、$1-$99、$<name>）`
    });
    i += next === undefined ? 1 : 2;
  }
  flush();

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, tokens };
}

export function expandTokens(tokens: TemplateToken[], match: RegExpExecArray): string {
  let out = '';
  for (const token of tokens) {
    switch (token.kind) {
      case 'literal':
        out += token.text;
        break;
      case 'whole':
        out += match[0];
        break;
      case 'group': {
        const value = match[token.index as number];
        out += value === undefined ? '' : value;
        break;
      }
      case 'named': {
        const groups = match.groups as Record<string, string | undefined> | undefined;
        const value = groups ? groups[token.name as string] : undefined;
        out += value === undefined ? '' : value;
        break;
      }
    }
  }
  return out;
}

/** 便捷封装：先解析再展开（测试与引擎共用同一条路径）。 */
export function expandTemplate(template: string, match: RegExpExecArray): string {
  const parsed = parseTemplate(template, '?', -1);
  if (!parsed.ok) {
    throw new Error(parsed.errors.map((e) => e.message).join('; '));
  }
  return expandTokens(parsed.tokens, match);
}
