import type { EngineError, RunOk } from './types';
import { runPipeline } from './pipeline';
import type { RedactionRule } from './types';

/**
 * 本地「回归样例集」引擎：样例仅驻留浏览器内存，不参与正式导出。
 *
 * 样例文件是一份 JSON：顶层为数组，或包含 "samples" 数组的对象。
 * 每项形如：
 *   { "id": "C1", "source": "原文…", "expected": "期望脱敏文本…",
 *     "expectedRules": ["R2", "R1"] }   // 可选：期望命中规则编号序列
 *
 * 解析阶段校验编号唯一与字段类型，错误尽量定位到样例编号或数组下标；
 * 任一错误都不返回部分样例，调用方据此保留上一份有效报告。
 * 执行阶段对每项复用「当前有效规则」与完整管线（含必检复核、例外剔除），
 * 单项管线失败只影响该项，显示原有错误位置，不覆盖其它项。
 */

export interface RegressionSample {
  /** 样例编号（文件内唯一）。 */
  id: string;
  /** 样例原文（允许为空串，交由管线判定）。 */
  source: string;
  /** 期望脱敏文本。 */
  expected: string;
  /** 可选的期望命中规则编号序列（按原文顺序，即清单条目顺序）；缺省则不校验序列。 */
  expectedRules: string[] | null;
}

export type ParseSamplesResult =
  | { ok: true; samples: RegressionSample[] }
  | { ok: false; errors: EngineError[] };

/** 两段文本的首个差异位置与周边片段。 */
export interface TextDiff {
  /** 首个不同字符的下标；两段仅长度不同（前缀完全相等）时为较短串长度。 */
  index: number;
  /** 实际片段（差异位置前后各取若干字符，差异在末尾/超长时给出上下文）。 */
  actualSnippet: string;
  expectedSnippet: string;
}

/** 规则编号序列对齐后的一条差异（LCS 对齐）。 */
export interface SequenceOp {
  kind: 'same' | 'actual-only' | 'expected-only';
  ruleId: string;
  /** 在实际/期望序列中的下标；另一序列不存在时为 -1。 */
  actualIndex: number;
  expectedIndex: number;
}

export interface SequenceDiff {
  ops: SequenceOp[];
  /** 首个非 same 操作的下标；完全一致为 null。 */
  firstMismatchIndex: number | null;
  matched: boolean;
}

/** 单项回归结果：通过、文本不符、规则序列不符或管线失败，互不覆盖。 */
export interface RegressionItemResult {
  /** 对应样例在文件中的下标（按文件顺序产出）。 */
  index: number;
  sampleId: string;
  source: string;
  expected: string;
  expectedRules: string[] | null;
  status: 'pass' | 'text-mismatch' | 'sequence-mismatch' | 'pipeline-error';
  /** 管线成功时的实际脱敏文本。 */
  actual: string;
  /** 管线成功时的实际命中规则编号序列（按原文顺序）。 */
  actualRules: string[];
  /** 首个文本差异；文本完全相等时为 null。 */
  textDiff: TextDiff | null;
  /** 规则序列差异；未声明期望序列或序列一致时为 null。 */
  sequenceDiff: SequenceDiff | null;
  /** 管线失败时的原有结构化错误（保留规则编号与位置）。 */
  errors: EngineError[];
}

/** 一次回归执行的完整报告，按文件顺序产出。 */
export interface RegressionReport {
  results: RegressionItemResult[];
  passCount: number;
  failCount: number;
  totalCount: number;
  allPassed: boolean;
}

/**
 * 解析样例 JSON。接受两种形态：
 *   { "samples": [ ... ] }  或  [ ... ]
 * 所有错误尽量带样例编号（id 或「第 N 项」）与数组下标；失败时不返回部分样例。
 */
export function parseSamplesJson(jsonText: string): ParseSamplesResult {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [
        {
          code: 'SAMPLES_JSON_INVALID',
          message: `回归样例文件不是合法 JSON：${message}`,
          position: extractJsonErrorPosition(message)
        }
      ]
    };
  }

  const list: unknown = Array.isArray(data)
    ? data
    : data !== null && typeof data === 'object' && Array.isArray((data as { samples?: unknown }).samples)
      ? (data as { samples: unknown[] }).samples
      : null;

  if (list === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'SAMPLES_SHAPE_INVALID',
          message: '回归样例文件必须是数组，或包含 "samples" 数组的对象'
        }
      ]
    };
  }

  const items = list as unknown[];
  if (items.length === 0) {
    return {
      ok: false,
      errors: [{ code: 'SAMPLES_SHAPE_INVALID', message: '回归样例列表为空，至少需要一个样例' }]
    };
  }

  const errors: EngineError[] = [];
  const samples: RegressionSample[] = [];
  const seenIds = new Set<string>();

  items.forEach((raw, index) => {
    const label = `第 ${index + 1} 项（数组下标 ${index}）`;

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push({
        code: 'SAMPLE_FIELD_INVALID',
        position: index,
        message: `回归样例 ${label}：必须是对象`
      });
      return;
    }

    const obj = raw as Record<string, unknown>;

    let id: string | null = null;
    if (typeof obj.id !== 'string' || obj.id.trim() === '') {
      errors.push({
        code: 'SAMPLE_FIELD_INVALID',
        position: index,
        message: `回归样例 ${label}：id 必须是非空字符串`
      });
    } else if (seenIds.has(obj.id)) {
      errors.push({
        code: 'SAMPLE_FIELD_INVALID',
        ruleId: obj.id,
        position: index,
        message: `回归样例 ${obj.id}（${label}）：样例编号重复`
      });
    } else {
      seenIds.add(obj.id);
      id = obj.id;
    }

    if (typeof obj.source !== 'string') {
      errors.push({
        code: 'SAMPLE_FIELD_INVALID',
        ...(id !== null ? { ruleId: id } : {}),
        position: index,
        message: `回归样例 ${id ?? label}（${label}）：source（原文）必须是字符串`
      });
    }
    if (typeof obj.expected !== 'string') {
      errors.push({
        code: 'SAMPLE_FIELD_INVALID',
        ...(id !== null ? { ruleId: id } : {}),
        position: index,
        message: `回归样例 ${id ?? label}（${label}）：expected（期望脱敏文本）必须是字符串`
      });
    }

    let expectedRules: string[] | null = null;
    if (obj.expectedRules !== undefined && obj.expectedRules !== null) {
      if (!Array.isArray(obj.expectedRules)) {
        errors.push({
          code: 'SAMPLE_FIELD_INVALID',
          ...(id !== null ? { ruleId: id } : {}),
          position: index,
          message: `回归样例 ${id ?? label}（${label}）：expectedRules 必须是规则编号字符串数组`
        });
      } else {
        let valid = true;
        obj.expectedRules.forEach((ruleId, ruleIndex) => {
          if (typeof ruleId !== 'string' || ruleId.trim() === '') {
            valid = false;
            errors.push({
              code: 'SAMPLE_FIELD_INVALID',
              ...(id !== null ? { ruleId: id } : {}),
              position: ruleIndex,
              message:
                `回归样例 ${id ?? label}（${label}）：expectedRules 第 ${ruleIndex} 项` +
                ' 必须是非空规则编号字符串'
            });
          }
        });
        if (valid) expectedRules = obj.expectedRules as string[];
      }
    }

    if (id !== null && typeof obj.source === 'string' && typeof obj.expected === 'string') {
      samples.push({ id, source: obj.source, expected: obj.expected, expectedRules });
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, samples };
}

/** 片段上下文半径：差异位置前后各保留的字符数。 */
const SNIPPET_RADIUS = 12;

function snippetAround(text: string, index: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + SNIPPET_RADIUS + 1);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/**
 * 定位两段文本的首个差异：按字符（UTF-16 码元）逐个比较。
 * 返回首个不同位置与该位置周边的实际/期望片段；完全相等返回 null。
 * 前缀完全相同但长度不同（一段是另一段前缀）时，差异位置为较短串长度。
 */
export function firstTextDiff(actual: string, expected: string): TextDiff | null {
  if (actual === expected) return null;
  const limit = Math.min(actual.length, expected.length);
  let index = 0;
  while (index < limit && actual[index] === expected[index]) index += 1;
  return {
    index,
    actualSnippet: snippetAround(actual, index),
    expectedSnippet: snippetAround(expected, index)
  };
}

/**
 * 对齐两条规则编号序列（LCS），产出 same / actual-only / expected-only 操作序列。
 * 实际序列多出的编号为「实际命中、期望缺失」，期望序列多出的为「期望命中、实际缺失」。
 */
export function diffRuleSequences(actualRules: string[], expectedRules: string[]): SequenceDiff {
  const n = actualRules.length;
  const m = expectedRules.length;
  // LCS 长度表。
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        actualRules[i] === expectedRules[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: SequenceOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (actualRules[i] === expectedRules[j]) {
      ops.push({ kind: 'same', ruleId: actualRules[i], actualIndex: i, expectedIndex: j });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: 'actual-only', ruleId: actualRules[i], actualIndex: i, expectedIndex: -1 });
      i += 1;
    } else {
      ops.push({ kind: 'expected-only', ruleId: expectedRules[j], actualIndex: -1, expectedIndex: j });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: 'actual-only', ruleId: actualRules[i], actualIndex: i, expectedIndex: -1 });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: 'expected-only', ruleId: expectedRules[j], actualIndex: -1, expectedIndex: j });
    j += 1;
  }

  const mismatchPos = ops.findIndex((op) => op.kind !== 'same');
  return {
    ops,
    firstMismatchIndex: mismatchPos === -1 ? null : mismatchPos,
    matched: mismatchPos === -1
  };
}

/**
 * 执行完整回归：对每个样例复用当前有效规则与完整管线，按文件顺序产出结果。
 * 单项管线失败（零长度命中、必检残留等）只记录该项原有错误位置，
 * 不抛错、不覆盖其它项。
 *
 * @param activeRules  当前启用规则（与主界面启停状态一致）。
 * @param verifyRules  必检复核使用的规则全集（含停用规则），与主管线一致。
 */
export function runRegression(
  samples: RegressionSample[],
  activeRules: RedactionRule[],
  verifyRules: RedactionRule[] = activeRules
): RegressionReport {
  const results: RegressionItemResult[] = samples.map((sample, index) => {
    const base: RegressionItemResult = {
      index,
      sampleId: sample.id,
      source: sample.source,
      expected: sample.expected,
      expectedRules: sample.expectedRules,
      status: 'pass',
      actual: '',
      actualRules: [],
      textDiff: null,
      sequenceDiff: null,
      errors: []
    };

    const result = runPipeline(sample.source, activeRules, verifyRules);
    if (!result.ok) {
      return { ...base, status: 'pipeline-error', errors: result.errors };
    }

    const run: RunOk = result;
    base.actual = run.output;
    // 清单已按原文起点升序，规则编号序列即「命中规则编号序列」。
    base.actualRules = run.checklist.map((entry) => entry.ruleId);
    base.textDiff = firstTextDiff(run.output, sample.expected);

    let failed = false;
    if (base.textDiff !== null) {
      base.status = 'text-mismatch';
      failed = true;
    }
    if (sample.expectedRules !== null) {
      base.sequenceDiff = diffRuleSequences(base.actualRules, sample.expectedRules);
      if (!base.sequenceDiff.matched) {
        base.status = failed ? 'text-mismatch' : 'sequence-mismatch';
        failed = true;
      }
    }
    if (!failed) base.status = 'pass';
    return base;
  });

  const failCount = results.filter((item) => item.status !== 'pass').length;
  return {
    results,
    passCount: results.length - failCount,
    failCount,
    totalCount: results.length,
    allPassed: failCount === 0
  };
}

/** V8 的 JSON 报错里通常带 "position N"，尽力提取为字符位置。 */
function extractJsonErrorPosition(message: string): number | undefined {
  const m = /position (\d+)/.exec(message);
  return m ? Number(m[1]) : undefined;
}
