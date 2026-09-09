import { reactive, watch } from 'vue';
import type { EngineError, RedactionRule, RunOk } from './engine/types';
import { parseRulesJson } from './engine/rules';
import { runPipeline } from './engine/pipeline';

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
  selectedInterval: -1
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
    store.run = result;
    store.runErrors = [];
    if (store.selectedInterval >= result.accepted.length) {
      store.selectedInterval = result.accepted.length > 0 ? 0 : -1;
    }
  } else {
    // 失败：只记录错误，上一份有效结果原样保留。
    store.runErrors = result.errors;
  }
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

export function initStoreWatchers(): void {
  watch(
    () => store.sourceText,
    () => scheduleRecompute()
  );
}
