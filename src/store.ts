import { reactive, watch } from 'vue';
import type { EngineError, RedactionRule, RunOk } from './engine/types';
import { parseRulesJson } from './engine/rules';
import { runPipeline } from './engine/pipeline';
import { entryKey, reconcileReview, reviewEntries, withAllConfirmed, withConfirmed } from './engine/review';

/** 一次重算中被撤销的人工确认（用于页面提示，可定位到规则编号与原文区间）。 */
export interface ReviewRevocation {
  ruleId: string;
  ruleName: string;
  start: number;
  end: number;
  replacement: string;
}

/**
 * 全局状态（纯内存，不落盘、不外发）。
 * 关键不变量：store.run 永远保存【上一份完全通过校验】的结果；
 * 任何一步失败只更新 store.runErrors，绝不清空或部分改写 store.run。
 */
export const store = reactive({
  /** 原文（粘贴或本地 TXT 解码而来）。 */
  sourceText: '',
  /** 规则 JSON 原文。 */
  rulesText: '',
  /** 最近一次成功解析的规则全集（含被停用的）。 */
  rules: [] as RedactionRule[],
  /** 规则解析错误（带规则编号）。 */
  ruleErrors: [] as EngineError[],
  /** 被停用的规则编号集合。 */
  disabledRuleIds: new Set<string>(),
  /** 最近一次完全通过校验的脱敏结果；失败时保持不变。 */
  run: null as RunOk | null,
  /** 本次计算的错误；为空表示当前展示的结果与当前输入一致。 */
  runErrors: [] as EngineError[],
  /** 输入/规则文件读取错误（编码、JSON 等）。 */
  ioErrors: [] as EngineError[],
  /** 当前选中的遮蔽块（accepted 下标），-1 表示未选中。 */
  selectedInterval: -1,
  /** 详情区当前展示例外命中（未遮蔽片段）的规则编号；null 表示未查看。 */
  excludedViewRuleId: null as string | null,
  /** 已人工确认区间的稳定键集合（规则编号 + 原文区间 + 替换内容）。 */
  confirmedReviewKeys: new Set<string>(),
  /** 最近一次成功重算中被撤销的确认（重算成功时刷新；失败保留，与上一份有效结果一致）。 */
  reviewRevocations: [] as ReviewRevocation[]
});

let recomputeTimer: ReturnType<typeof setTimeout> | null = null;

/** 输入变化后防抖重算，避免粘贴大文本时逐字符触发。 */
export function scheduleRecompute(): void {
  if (recomputeTimer !== null) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, 150);
}

export function recompute(): void {
  if (recomputeTimer !== null) {
    clearTimeout(recomputeTimer);
    recomputeTimer = null;
  }
  if (store.sourceText.length === 0 || store.rules.length === 0) {
    // 输入不完整不属于错误，只是没有可计算的内容；保留旧结果并在界面上提示。
    store.runErrors = [];
    return;
  }
  const activeRules = store.rules.filter((rule) => !store.disabledRuleIds.has(rule.id));
  // 匹配只用启用规则；必检复核用规则全集——停用必检规则不能成为绕过导出闸门的手段。
  const result = runPipeline(store.sourceText, activeRules, store.rules);
  if (result.ok) {
    // 人工确认对账：只有稳定键（规则编号 + 原文区间 + 替换内容）与新结果
    // 完全对应的旧确认才保留，其余一律撤销并提示，杜绝旧结果误授权。
    store.reviewRevocations = collectRevocations(result, store.confirmedReviewKeys);
    store.confirmedReviewKeys = reconcileReview(result, store.confirmedReviewKeys);
    store.run = result;
    store.runErrors = [];
    if (store.selectedInterval >= result.accepted.length) {
      store.selectedInterval = result.accepted.length > 0 ? 0 : -1;
    }
  } else {
    // 失败：只记录错误，上一份有效结果（含其确认状态）原样保留。
    store.runErrors = result.errors;
  }
}

/**
 * 找出已确认但不再与新结果完全对应的复核项：规则启停、原文或模板变化
 * 都可能让某个稳定键消失或改变，这些旧确认必须撤销。
 */
function collectRevocations(run: RunOk, confirmedKeys: ReadonlySet<string>): ReviewRevocation[] {
  if (confirmedKeys.size === 0 || store.run === null) return [];
  // 上一份有效结果里“已确认”的键，在新结果中仍完全对应才有效。
  const nextKeys = new Set(reviewEntries(run).map((entry) => entryKey(entry)));
  const revoked: ReviewRevocation[] = [];
  for (const entry of reviewEntries(store.run)) {
    if (entry.reviewStatus !== 'confirmed') continue;
    const key = entryKey(entry);
    if (confirmedKeys.has(key) && !nextKeys.has(key)) {
      revoked.push({
        ruleId: entry.ruleId,
        ruleName: entry.ruleName,
        start: entry.sourceStart,
        end: entry.sourceEnd,
        replacement: entry.replacement
      });
    }
  }
  // 清单按原文起点升序，撤销提示同样按原文顺序排列。
  revoked.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId));
  return revoked;
}

/** 解析规则文本；失败时保留上一份有效规则集，只展示错误。 */
export function applyRulesText(text: string): void {
  // 规则内容以本次输入为准：此前针对规则文件的读取/解码错误随之失效。
  clearIoErrors('rules');
  store.rulesText = text;
  const parsed = parseRulesJson(text);
  if (parsed.ok) {
    store.rules = parsed.rules;
    store.ruleErrors = [];
    // 依据规则文件的 enabled 初值重建启停状态，再保留仍然存在的界面停用项。
    const next = new Set<string>();
    for (const rule of parsed.rules) {
      if (!rule.enabledByDefault) next.add(rule.id);
    }
    for (const id of store.disabledRuleIds) {
      if (parsed.rules.some((rule) => rule.id === id)) next.add(id);
    }
    store.disabledRuleIds = next;
    scheduleRecompute();
  } else {
    store.ruleErrors = parsed.errors;
  }
}

export function setSourceText(text: string): void {
  // 原文以本次输入为准：此前针对原文文件的读取/解码错误随之失效。
  clearIoErrors('source');
  store.sourceText = text;
  store.selectedInterval = -1;
  scheduleRecompute();
}

/** 清除某一输入来源（原文 / 规则）的文件读取与解码错误。 */
export function clearIoErrors(scope: 'source' | 'rules'): void {
  if (store.ioErrors.some((error) => error.scope === scope)) {
    store.ioErrors = store.ioErrors.filter((error) => error.scope !== scope);
  }
}

/**
 * 导出闸门：上一份有效结果可以继续展示，但只要当前输入存在
 * 规则解析错误、文件读取/解码错误或本次计算错误，两个导出入口都锁定，
 * 避免把与当前输入不一致的旧结果误外发。返回 null 表示允许导出。
 */
export function exportBlockReason(): string | null {
  if (store.run === null) return '暂无有效结果';
  if (store.ruleErrors.length > 0) {
    return '当前规则存在解析错误，展示的是上一份有效结果，与最新规则不一致';
  }
  if (store.ioErrors.length > 0) {
    return '当前存在文件读取或解码错误，展示的是上一份有效结果，与最新输入不一致';
  }
  if (store.runErrors.length > 0) {
    return '当前输入未通过校验，展示的是上一份有效结果';
  }
  if (store.run.reviewPendingCount > 0) {
    return `还有 ${store.run.reviewPendingCount} 个高风险遮蔽块待人工确认`;
  }
  return null;
}

export function toggleRule(ruleId: string, enabled: boolean): void {
  if (enabled) store.disabledRuleIds.delete(ruleId);
  else store.disabledRuleIds.add(ruleId);
  recompute();
}

export function selectInterval(index: number): void {
  store.selectedInterval = index;
}

/** 点击规则面板的排除数：在详情区查看/收起该规则被例外剔除的未遮蔽片段。 */
export function toggleExcludedView(ruleId: string): void {
  store.excludedViewRuleId = store.excludedViewRuleId === ruleId ? null : ruleId;
}

export function closeExcludedView(): void {
  store.excludedViewRuleId = null;
}

/** 确认当前选中的遮蔽块；只对要求复核且仍待确认的区间生效。 */
export function confirmInterval(intervalIndex: number): void {
  const run = store.run;
  if (run === null) return;
  store.confirmedReviewKeys = withConfirmed(run, store.confirmedReviewKeys, intervalIndex);
  reconcileReview(run, store.confirmedReviewKeys);
}

/** 按原文顺序一次性确认当前结果中的全部待办区间。 */
export function confirmAllPending(): void {
  const run = store.run;
  if (run === null) return;
  store.confirmedReviewKeys = withAllConfirmed(run);
  reconcileReview(run, store.confirmedReviewKeys);
}

/** 手动关闭撤销提示（下一次成功重算时会按新结果重新生成）。 */
export function dismissReviewRevocations(): void {
  store.reviewRevocations = [];
}

/** 点击撤销提示：定位到新结果中同一规则编号、区间最接近的遮蔽块。 */
export function locateRevocation(revocation: ReviewRevocation): void {
  const run = store.run;
  if (run === null) return;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of run.checklist) {
    if (entry.ruleId !== revocation.ruleId) continue;
    const distance = Math.abs(entry.sourceStart - revocation.start) + Math.abs(entry.sourceEnd - revocation.end);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry.index;
    }
  }
  if (best >= 0) store.selectedInterval = best;
}

export function initStoreWatchers(): void {
  watch(
    () => store.sourceText,
    () => scheduleRecompute()
  );
}
