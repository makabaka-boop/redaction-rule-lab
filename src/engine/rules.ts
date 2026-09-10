import type { EngineError, ParseRulesResult, RedactionRule } from './types';
import { parseTemplate } from './template';

/** 允许用户声明的标志（g 由引擎强制附加，d 等索引类标志不开放）。 */
const ALLOWED_FLAGS = new Set(['i', 'm', 's', 'u']);

interface RawRule {
  id?: unknown;
  name?: unknown;
  pattern?: unknown;
  flags?: unknown;
  priority?: unknown;
  template?: unknown;
  mustCheck?: unknown;
  reviewRequired?: unknown;
  enabled?: unknown;
  excludedValues?: unknown;
}

/**
 * 解析规则 JSON。接受两种形态：
 *   { "rules": [ ... ] }  或  [ ... ]
 * 所有错误都带规则编号（id 或自动编号）与规则序号；解析失败时不返回任何部分规则。
 */
export function parseRulesJson(jsonText: string): ParseRulesResult {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [
        {
          code: 'RULES_JSON_INVALID',
          message: `规则文件不是合法 JSON：${message}`,
          position: extractJsonErrorPosition(message)
        }
      ]
    };
  }

  const list: unknown = Array.isArray(data)
    ? data
    : data !== null && typeof data === 'object' && Array.isArray((data as { rules?: unknown }).rules)
      ? (data as { rules: unknown[] }).rules
      : null;

  if (list === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'RULES_SHAPE_INVALID',
          message: '规则文件必须是数组，或包含 "rules" 数组的对象'
        }
      ]
    };
  }
  if ((list as unknown[]).length === 0) {
    return {
      ok: false,
      errors: [{ code: 'RULES_SHAPE_INVALID', message: '规则列表为空，至少需要一条规则' }]
    };
  }

  const errors: EngineError[] = [];
  const rules: RedactionRule[] = [];
  const seenIds = new Set<string>();

  (list as RawRule[]).forEach((raw, index) => {
    const autoId = `R${index + 1}`;
    const before = errors.length;

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: autoId,
        ruleIndex: index,
        message: `规则 ${autoId}（第 ${index + 1} 条）：必须是对象`
      });
      return;
    }

    const id = raw.id === undefined ? autoId : raw.id;
    if (typeof id !== 'string' || id.trim() === '') {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: autoId,
        ruleIndex: index,
        message: `规则 ${autoId}（第 ${index + 1} 条）：id 必须是非空字符串`
      });
      return;
    }
    if (seenIds.has(id)) {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: id,
        ruleIndex: index,
        message: `规则 ${id}（第 ${index + 1} 条）：规则编号重复`
      });
      return;
    }
    seenIds.add(id);

    if (typeof raw.name !== 'string' || raw.name.trim() === '') {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: id,
        ruleIndex: index,
        message: `规则 ${id}（第 ${index + 1} 条）：name 必须是非空字符串`
      });
    }
    if (typeof raw.pattern !== 'string' || raw.pattern === '') {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: id,
        ruleIndex: index,
        message: `规则 ${id}（第 ${index + 1} 条）：pattern 必须是非空字符串`
      });
    }

    let flags = '';
    if (raw.flags !== undefined) {
      if (typeof raw.flags !== 'string') {
        errors.push({
          code: 'FLAGS_INVALID',
          ruleId: id,
          ruleIndex: index,
          message: `规则 ${id}（第 ${index + 1} 条）：flags 必须是字符串`
        });
      } else {
        for (let i = 0; i < raw.flags.length; i += 1) {
          const f = raw.flags[i];
          if (!ALLOWED_FLAGS.has(f)) {
            errors.push({
              code: 'FLAGS_INVALID',
              ruleId: id,
              ruleIndex: index,
              position: i,
              message: `规则 ${id}（第 ${index + 1} 条）：flags 第 ${i} 个字符 "${f}" 不被支持（仅允许 i/m/s/u，g 由引擎自动附加）`
            });
          } else if (flags.includes(f)) {
            errors.push({
              code: 'FLAGS_INVALID',
              ruleId: id,
              ruleIndex: index,
              position: i,
              message: `规则 ${id}（第 ${index + 1} 条）：flags 第 ${i} 个字符 "${f}" 重复`
            });
          } else {
            flags += f;
          }
        }
      }
    }

    if (typeof raw.priority !== 'number' || !Number.isFinite(raw.priority)) {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: id,
        ruleIndex: index,
        message: `规则 ${id}（第 ${index + 1} 条）：priority 必须是有限数值`
      });
    }
    if (typeof raw.template !== 'string') {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: id,
        ruleIndex: index,
        message: `规则 ${id}（第 ${index + 1} 条）：template 必须是字符串`
      });
    }
    if (raw.mustCheck !== undefined && typeof raw.mustCheck !== 'boolean') {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: id,
        ruleIndex: index,
        message: `规则 ${id}（第 ${index + 1} 条）：mustCheck 必须是布尔值`
      });
    }
    if (raw.reviewRequired !== undefined && typeof raw.reviewRequired !== 'boolean') {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: id,
        ruleIndex: index,
        message: `规则 ${id}（第 ${index + 1} 条）：reviewRequired 必须是布尔值`
      });
    }
    if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
      errors.push({
        code: 'RULE_FIELD_INVALID',
        ruleId: id,
        ruleIndex: index,
        message: `规则 ${id}（第 ${index + 1} 条）：enabled 必须是布尔值`
      });
    }

    // 例外值：可选字符串数组，缺省为空。非字符串、空字符串或重复项
    // 都定位到规则编号与数组下标；任一非法即整条规则解析失败，
    // 调用方据此保留上一份有效规则集。
    let excludedValues: string[] = [];
    if (raw.excludedValues !== undefined) {
      if (!Array.isArray(raw.excludedValues)) {
        errors.push({
          code: 'RULE_FIELD_INVALID',
          ruleId: id,
          ruleIndex: index,
          message: `规则 ${id}（第 ${index + 1} 条）：excludedValues 必须是字符串数组`
        });
      } else {
        const seenValues = new Set<string>();
        (raw.excludedValues as unknown[]).forEach((item, itemIndex) => {
          if (typeof item !== 'string') {
            errors.push({
              code: 'RULE_FIELD_INVALID',
              ruleId: id,
              ruleIndex: index,
              position: itemIndex,
              message: `规则 ${id}（第 ${index + 1} 条）：excludedValues 第 ${itemIndex} 项必须是字符串`
            });
          } else if (item === '') {
            errors.push({
              code: 'RULE_FIELD_INVALID',
              ruleId: id,
              ruleIndex: index,
              position: itemIndex,
              message: `规则 ${id}（第 ${index + 1} 条）：excludedValues 第 ${itemIndex} 项是空字符串，例外值必须非空`
            });
          } else if (seenValues.has(item)) {
            errors.push({
              code: 'RULE_FIELD_INVALID',
              ruleId: id,
              ruleIndex: index,
              position: itemIndex,
              message: `规则 ${id}（第 ${index + 1} 条）：excludedValues 第 ${itemIndex} 项 "${item}" 与前面的例外值重复`
            });
          } else {
            seenValues.add(item);
          }
        });
        excludedValues = raw.excludedValues as string[];
      }
    }

    let regex: RegExp | null = null;
    if (typeof raw.pattern === 'string' && raw.pattern !== '') {
      try {
        regex = new RegExp(raw.pattern, `g${flags}`);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        errors.push({
          code: 'REGEX_INVALID',
          ruleId: id,
          ruleIndex: index,
          message: `规则 ${id}（第 ${index + 1} 条）：正则无法编译 —— ${detail}`
        });
      }
    }

    if (typeof raw.template === 'string') {
      const tpl = parseTemplate(raw.template, id, index);
      if (!tpl.ok) errors.push(...tpl.errors);
    }

    if (errors.length === before && regex !== null) {
      rules.push({
        id,
        name: (raw.name as string).trim(),
        pattern: raw.pattern as string,
        flags,
        priority: raw.priority as number,
        template: raw.template as string,
        mustCheck: raw.mustCheck === true,
        reviewRequired: raw.reviewRequired === true,
        enabledByDefault: raw.enabled !== false,
        excludedValues,
        order: index,
        regex
      });
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rules };
}

/** V8 的 JSON 报错里通常带 "position N"，尽力提取为字符位置。 */
function extractJsonErrorPosition(message: string): number | undefined {
  const m = /position (\d+)/.exec(message);
  return m ? Number(m[1]) : undefined;
}
