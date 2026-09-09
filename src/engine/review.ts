import type { ChecklistEntry, RunOk } from './types';

/**
 * 人工复核的稳定键：由规则编号、原文区间、替换内容三元组组成。
 * 只在三者与新结果【完全对应】时，旧确认才会在重算后保留：
 * 规则启停、原文或模板任何一处变化导致三元组不同，旧确认立即失效，
 * 避免旧结果对新结果构成误授权。
 *
 * 编码必须无歧义：规则编号与替换内容都可能包含制表符等任意字符，
 * 直接用分隔符拼接会让不同的三元组得到同一个键（例如
 * ("A\t1", 2, 3, "X") 与 ("A", 1, 2, "3\tX") 在 \t 拼接下碰撞，
 * 旧确认会错误授权新条目）。这里对【定长 JSON 数组】做序列化：
 * 字符串恒带引号且制表符/引号/反斜杠均被转义，数字恒无引号，
 * 因此编码是单射——四个组成值任一变化都得到不同的键。
 */
export function reviewKey(ruleId: string, sourceStart: number, sourceEnd: number, replacement: string): string {
  return JSON.stringify([ruleId, sourceStart, sourceEnd, replacement]);
}

/** 取一个清单条目的稳定键。 */
export function entryKey(entry: ChecklistEntry): string {
  return reviewKey(entry.ruleId, entry.sourceStart, entry.sourceEnd, entry.replacement);
}

/** 结果中全部需要人工复核的条目（清单已按原文起点升序，保持原文顺序）。 */
export function reviewEntries(run: RunOk): ChecklistEntry[] {
  return run.checklist.filter((entry) => entry.reviewRequired);
}

/**
 * 依据已确认键集合对新结果对账：就地写回每条复核项的确认状态与汇总计数。
 * 返回本次对账后仍然有效的确认键（即与新结果完全对应、被保留下来的子集）。
 * 调用方必须用返回值替换其确认集合——不在返回值中的旧键一律视为撤销。
 */
export function reconcileReview(run: RunOk, confirmedKeys: ReadonlySet<string>): Set<string> {
  const retained = new Set<string>();
  let required = 0;
  let confirmed = 0;
  for (const entry of run.checklist) {
    if (!entry.reviewRequired) continue;
    required += 1;
    const key = entryKey(entry);
    if (confirmedKeys.has(key)) {
      entry.reviewStatus = 'confirmed';
      confirmed += 1;
      retained.add(key);
    } else {
      entry.reviewStatus = 'pending';
    }
  }
  run.reviewRequiredCount = required;
  run.reviewConfirmedCount = confirmed;
  run.reviewPendingCount = required - confirmed;
  return retained;
}

/** 确认单个区间（按 accepted/清单下标），返回新的确认键集合；非复核项不受影响。 */
export function withConfirmed(run: RunOk, confirmedKeys: ReadonlySet<string>, intervalIndex: number): Set<string> {
  const entry = run.checklist.find((item) => item.index === intervalIndex);
  if (!entry || !entry.reviewRequired) return new Set(confirmedKeys);
  const next = new Set(confirmedKeys);
  next.add(entryKey(entry));
  return next;
}

/** 按原文顺序确认全部待办：返回包含当前结果全部复核键的新集合。 */
export function withAllConfirmed(run: RunOk): Set<string> {
  const next = new Set<string>();
  for (const entry of reviewEntries(run)) next.add(entryKey(entry));
  return next;
}
