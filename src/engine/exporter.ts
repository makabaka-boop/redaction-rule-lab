import type { RunOk } from './types';

export interface ExportBundle {
  /** 脱敏文本（与界面展示逐字一致）。 */
  redactedText: string;
  /** 审阅清单 JSON（每项与脱敏文本中的遮蔽块一一对应）。 */
  checklistJson: string;
  /** 一致性自检：逐项核对清单与两份文本的区间内容，全部通过才允许导出。 */
  selfCheckErrors: string[];
}

/**
 * 组装导出物。导出前做一致性自检：
 *   - 清单每项的 output 区间在脱敏文本中切出的内容 === 记录的替换内容；
 *   - 清单每项的 source 区间在原文中切出的内容 === 记录的原文片段；
 *   - 遮蔽块数量 === 清单条目数。
 * 任一项不符即视为内部状态损坏，返回 selfCheckErrors，调用方必须阻止导出。
 */
export function buildExport(run: RunOk): ExportBundle {
  const entries = run.checklist.map((item) => ({
    index: item.index,
    ruleId: item.ruleId,
    ruleName: item.ruleName,
    priority: item.priority,
    mustCheck: item.mustCheck,
    source: { start: item.sourceStart, end: item.sourceEnd, text: item.sourceText },
    output: { start: item.outputStart, end: item.outputEnd, text: item.outputText },
    replacement: item.replacement,
    arbitration: item.arbitration
  }));

  const checklistJson = JSON.stringify(
    {
      format: 'redaction-review-checklist/1',
      generatedBy: 'redaction-lab（纯前端，无网络外发）',
      sourceLength: run.source.length,
      outputLength: run.output.length,
      activeRules: run.activeRules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        mustCheck: rule.mustCheck
      })),
      entryCount: entries.length,
      entries
    },
    null,
    2
  );

  const selfCheckErrors: string[] = [];
  const maskedCount = run.segments.filter((seg) => seg.kind === 'masked').length;
  if (maskedCount !== entries.length) {
    selfCheckErrors.push(`遮蔽块数量（${maskedCount}）与清单条目数（${entries.length}）不一致`);
  }
  for (const item of run.checklist) {
    const fromOutput = run.output.slice(item.outputStart, item.outputEnd);
    if (fromOutput !== item.outputText || fromOutput !== item.replacement) {
      selfCheckErrors.push(
        `清单第 ${item.index + 1} 项（规则 ${item.ruleId}）：脱敏文本区间 [${item.outputStart}, ${item.outputEnd}) ` +
          `内容为 "${fromOutput}"，与记录的替换内容 "${item.replacement}" 不一致`
      );
    }
    const fromSource = run.source.slice(item.sourceStart, item.sourceEnd);
    if (fromSource !== item.sourceText) {
      selfCheckErrors.push(
        `清单第 ${item.index + 1} 项（规则 ${item.ruleId}）：原文区间 [${item.sourceStart}, ${item.sourceEnd}) ` +
          `内容与记录不符`
      );
    }
  }

  return { redactedText: run.output, checklistJson, selfCheckErrors };
}

/** 触发浏览器下载（仅生成本地文件，不发生任何网络请求）。 */
export function downloadTextFile(fileName: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
