import type { AcceptedInterval, ChecklistEntry, Segment } from './types';

export interface RenderResult {
  output: string;
  segments: Segment[];
  checklist: ChecklistEntry[];
}

/**
 * 依据胜出区间把原文渲染为脱敏文本。
 * 只接受按起点升序、互不重叠的区间；渲染同时产出：
 *   - segments：原文片段与遮蔽块交替的视图模型（下标与 accepted 一一对应）；
 *   - checklist：逐项记录源区间、输出区间、规则与替换内容的审阅清单。
 * 清单条目与脱敏文本逐字对应：output.slice(outputStart, outputEnd) === replacement。
 */
export function renderOutput(source: string, accepted: AcceptedInterval[]): RenderResult {
  const sorted = [...accepted].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Segment[] = [];
  const checklist: ChecklistEntry[] = [];
  let output = '';
  let cursor = 0;

  sorted.forEach((interval, index) => {
    if (interval.start < cursor) {
      // 防御：裁决层保证不重叠，此处若触发说明上游被破坏，直接抛错而不是产出错位文本。
      throw new Error(
        `内部错误：区间 [${interval.start}, ${interval.end}) 与前一区间重叠，裁决结果不一致`
      );
    }
    if (interval.start > cursor) {
      const plain = source.slice(cursor, interval.start);
      segments.push({ kind: 'plain', text: plain, intervalIndex: -1 });
      output += plain;
    }
    const outputStart = output.length;
    output += interval.replacement;
    segments.push({ kind: 'masked', text: interval.replacement, intervalIndex: index });
    checklist.push({
      index,
      ruleId: interval.ruleId,
      ruleName: interval.ruleName,
      priority: interval.priority,
      mustCheck: interval.mustCheck,
      reviewRequired: interval.reviewRequired,
      // 管线只产出“待确认”初始态；已确认状态由 store 依据稳定键对账写回。
      reviewStatus: interval.reviewRequired ? ('pending' as const) : ('confirmed' as const),
      sourceStart: interval.start,
      sourceEnd: interval.end,
      sourceText: source.slice(interval.start, interval.end),
      outputStart,
      outputEnd: output.length,
      outputText: interval.replacement,
      replacement: interval.replacement,
      arbitration: interval.reason
    });
    cursor = interval.end;
  });

  if (cursor < source.length) {
    const tail = source.slice(cursor);
    segments.push({ kind: 'plain', text: tail, intervalIndex: -1 });
    output += tail;
  }

  return { output, segments, checklist };
}
