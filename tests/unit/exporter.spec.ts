import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/engine/exporter';
import { runPipeline } from '../../src/engine/pipeline';
import { parseRulesJson } from '../../src/engine/rules';
import type { RunOk } from '../../src/engine/types';

function makeRun(): RunOk {
  const parsed = parseRulesJson(
    JSON.stringify({
      rules: [
        {
          id: 'R1',
          name: '手机号',
          pattern: '1[3-9]\\d{9}',
          flags: '',
          priority: 90,
          template: '[手机号]',
          mustCheck: true
        },
        {
          id: 'R2',
          name: '姓名',
          pattern: '(?<=联系人：)[\\u4e00-\\u9fa5]{2,4}',
          flags: 'u',
          priority: 50,
          template: '[姓名]',
          mustCheck: false
        }
      ]
    })
  );
  if (!parsed.ok) throw new Error(parsed.errors[0].message);
  const result = runPipeline('联系人：张三，电话 13800001111。', parsed.rules);
  if (!result.ok) throw new Error(result.errors[0].message);
  return result;
}

describe('buildExport 导出物一致性', () => {
  it('自检通过，清单与脱敏文本逐项对应', () => {
    const run = makeRun();
    const bundle = buildExport(run);
    expect(bundle.selfCheckErrors).toEqual([]);
    expect(bundle.redactedText).toBe(run.output);

    const checklist = JSON.parse(bundle.checklistJson) as {
      entryCount: number;
      entries: Array<{
        index: number;
        ruleId: string;
        source: { start: number; end: number; text: string };
        output: { start: number; end: number; text: string };
        replacement: string;
      }>;
    };
    expect(checklist.entryCount).toBe(run.checklist.length);
    expect(checklist.entries).toHaveLength(run.checklist.length);

    for (const entry of checklist.entries) {
      // 清单记录的输出区间在脱敏文本中切出的内容必须等于替换内容。
      expect(bundle.redactedText.slice(entry.output.start, entry.output.end)).toBe(entry.replacement);
      expect(entry.output.text).toBe(entry.replacement);
      // 清单记录的原文区间在原文中切出的内容必须等于记录的原文片段。
      expect(run.source.slice(entry.source.start, entry.source.end)).toBe(entry.source.text);
      // 清单条目与运行结果逐项对应。
      const fromRun = run.checklist[entry.index];
      expect(entry.ruleId).toBe(fromRun.ruleId);
      expect(entry.source.start).toBe(fromRun.sourceStart);
      expect(entry.source.end).toBe(fromRun.sourceEnd);
      expect(entry.output.start).toBe(fromRun.outputStart);
      expect(entry.output.end).toBe(fromRun.outputEnd);
    }
  });

  it('清单记录规则编号、优先级与必检标记', () => {
    const run = makeRun();
    const bundle = buildExport(run);
    const checklist = JSON.parse(bundle.checklistJson) as {
      entries: Array<{ ruleId: string; priority: number; mustCheck: boolean }>;
    };
    const phone = checklist.entries.find((e) => e.ruleId === 'R1');
    expect(phone).toBeDefined();
    expect(phone?.priority).toBe(90);
    expect(phone?.mustCheck).toBe(true);
  });

  it('输出区间单调递增且不重叠', () => {
    const run = makeRun();
    const bundle = buildExport(run);
    const checklist = JSON.parse(bundle.checklistJson) as {
      entries: Array<{ output: { start: number; end: number } }>;
    };
    let cursor = 0;
    for (const entry of checklist.entries) {
      expect(entry.output.start).toBeGreaterThanOrEqual(cursor);
      expect(entry.output.end).toBeGreaterThan(entry.output.start);
      cursor = entry.output.end;
    }
  });
});
