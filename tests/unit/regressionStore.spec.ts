import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRulesText,
  applySamplesText,
  exportBlockReason,
  isRegressionStale,
  recompute,
  runRegressionNow,
  selectRegressionItem,
  store,
  toggleRule
} from '../../src/store';

const PHONE_RULES = JSON.stringify({
  rules: [
    { id: 'P1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[手机号]', mustCheck: true }
  ]
});

// 初始模板错误：先造一个会让样例失败、修正后全通过的规则集。
const BROKEN_TEMPLATE_RULES = JSON.stringify({
  rules: [
    { id: 'P1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[手机]', mustCheck: true }
  ]
});

function samplesJson(samples: unknown[]): string {
  return JSON.stringify({ samples });
}

const SAMPLE_SET = samplesJson([
  { id: 'C1', source: '电话 13800001111。', expected: '电话 [手机号]。' },
  { id: 'C2', source: '电话 13900002222。', expected: '电话 [手机号]。', expectedRules: ['P1'] }
]);

function resetStore(): void {
  store.sourceText = '';
  store.rulesText = '';
  store.rules = [];
  store.ruleErrors = [];
  store.disabledRuleIds = new Set();
  store.run = null;
  store.runErrors = [];
  store.ioErrors = [];
  store.selectedInterval = -1;
  store.excludedViewRuleId = null;
  store.confirmedReviewKeys = new Set();
  store.reviewRevocations = [];
  store.regSamples = [];
  store.regReport = null;
  store.regErrors = [];
  store.regFileName = '';
  store.regStale = false;
  store.regSelectedIndex = -1;
}

describe('store：回归样例集闭环', () => {
  beforeEach(resetStore);

  it('选择样例文件后自动按当前规则运行，逐项结果按文件顺序产出', () => {
    applyRulesText(PHONE_RULES);
    recompute();
    applySamplesText(SAMPLE_SET, 'cases.json');
    expect(store.regFileName).toBe('cases.json');
    expect(store.regErrors).toEqual([]);
    expect(store.regReport).not.toBeNull();
    expect(store.regReport?.allPassed).toBe(true);
    expect(store.regReport?.passCount).toBe(2);
    expect(store.regReport?.results.map((r) => r.sampleId)).toEqual(['C1', 'C2']);
    expect(store.regReport?.results[1].actualRules).toEqual(['P1']);
  });

  it('规则文本变化触发重跑：失败样例在规则修正后全量通过', () => {
    applyRulesText(BROKEN_TEMPLATE_RULES);
    recompute();
    applySamplesText(SAMPLE_SET);
    expect(store.regReport?.allPassed).toBe(false);
    expect(store.regReport?.failCount).toBe(2);
    expect(store.regReport?.results[0].status).toBe('text-mismatch');
    expect(store.regReport?.results[0].textDiff?.index).toBe(6);

    // 修正规则模板并重算：全量重跑（两项都重新执行），全部通过。
    applyRulesText(PHONE_RULES);
    recompute();
    expect(store.regReport?.allPassed).toBe(true);
    expect(store.regReport?.failCount).toBe(0);
    expect(isRegressionStale()).toBe(false);
    expect(store.regReport?.results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('规则启停变化触发全量重跑：停用必检规则使样例管线失败，恢复后通过', () => {
    applyRulesText(PHONE_RULES);
    recompute();
    applySamplesText(SAMPLE_SET);
    expect(store.regReport?.allPassed).toBe(true);

    // 停用 P1：样例管线没有任何启用规则，逐项得到 NO_RULES_ENABLED 原有错误。
    toggleRule('P1', false);
    expect(store.regReport?.allPassed).toBe(false);
    expect(store.regReport?.results.every((r) => r.status === 'pipeline-error')).toBe(true);
    expect(store.regReport?.results[0].errors[0].code).toBe('NO_RULES_ENABLED');

    toggleRule('P1', true);
    expect(store.regReport?.allPassed).toBe(true);
  });

  it('规则变化后、下次重算前报告标记为过期（stale）', () => {
    applyRulesText(PHONE_RULES);
    recompute();
    applySamplesText(SAMPLE_SET);
    expect(isRegressionStale()).toBe(false);

    // applyRulesText 只调度防抖重算；尚未重算前，指纹已变化。
    applyRulesText(BROKEN_TEMPLATE_RULES);
    expect(isRegressionStale()).toBe(true);
    expect(store.regReport?.passCount).toBe(2); // 上一份有效报告保留展示

    recompute();
    expect(isRegressionStale()).toBe(false);
    expect(store.regReport?.failCount).toBe(2);
  });

  it('规则解析失败：沿用上一份有效回归报告，regErrors 之外报告保留并标记过期', () => {
    applyRulesText(PHONE_RULES);
    recompute();
    applySamplesText(SAMPLE_SET);
    const passedReport = store.regReport;

    applyRulesText('{ "rules": [ { ');
    expect(store.ruleErrors.length).toBeGreaterThan(0);
    expect(store.regReport).toBe(passedReport);
    expect(isRegressionStale()).toBe(true);

    // 恢复合法规则后自动重跑。
    applyRulesText(PHONE_RULES);
    recompute();
    expect(store.regReport).not.toBe(passedReport);
    expect(isRegressionStale()).toBe(false);
  });

  it('样例文件语法错误：错误被记录，保留上一份有效样例集与报告', () => {
    applyRulesText(PHONE_RULES);
    recompute();
    applySamplesText(SAMPLE_SET);
    expect(store.regReport?.allPassed).toBe(true);

    applySamplesText('{ not json');
    expect(store.regErrors.length).toBeGreaterThan(0);
    expect(store.regErrors[0].code).toBe('SAMPLES_JSON_INVALID');
    // 上一份有效样例集与报告原样保留。
    expect(store.regSamples.map((s) => s.id)).toEqual(['C1', 'C2']);
    expect(store.regReport?.allPassed).toBe(true);
  });

  it('样例字段错误（编号重复 / 类型错误）：定位到样例编号或下标，报告不被覆盖', () => {
    applyRulesText(PHONE_RULES);
    recompute();
    applySamplesText(SAMPLE_SET);

    applySamplesText(
      samplesJson([
        { id: 'DUP', source: 'a', expected: 'a' },
        { id: 'DUP', source: 'b', expected: 'b' }
      ])
    );
    expect(store.regErrors.some((e) => e.ruleId === 'DUP' && e.position === 1)).toBe(true);
    expect(store.regReport?.results.map((r) => r.sampleId)).toEqual(['C1', 'C2']);

    applySamplesText(samplesJson([{ id: 'X1', source: 7, expected: 'e' }]));
    expect(store.regErrors.some((e) => e.ruleId === 'X1' && e.message.includes('source'))).toBe(true);
  });

  it('手动立即重跑按最新规则产出', () => {
    applyRulesText(BROKEN_TEMPLATE_RULES);
    recompute();
    applySamplesText(SAMPLE_SET);
    expect(store.regReport?.failCount).toBe(2);
    applyRulesText(PHONE_RULES);
    runRegressionNow();
    expect(store.regReport?.allPassed).toBe(true);
  });

  it('点击失败项可展开/收起详情', () => {
    applyRulesText(BROKEN_TEMPLATE_RULES);
    recompute();
    applySamplesText(SAMPLE_SET);
    selectRegressionItem(0);
    expect(store.regSelectedIndex).toBe(0);
    selectRegressionItem(0);
    expect(store.regSelectedIndex).toBe(-1);
  });

  it('回归检查不改变规则启停、人工确认与下载闸门', () => {
    applyRulesText(
      JSON.stringify({
        rules: [
          {
            id: 'RV1',
            name: '姓名',
            pattern: '(?<=联系人：)[\\u4e00-\\u9fa5]{2,4}',
            flags: 'u',
            priority: 80,
            template: '[姓名]',
            reviewRequired: true
          },
          { id: 'P1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[手机号]', mustCheck: true }
        ]
      })
    );
    store.sourceText = '甲方联系人：王建国，电话 13800001111。';
    recompute();
    expect(store.run?.reviewPendingCount).toBe(1);
    const gateBefore = exportBlockReason();
    const disabledBefore = new Set(store.disabledRuleIds);
    const confirmedBefore = store.confirmedReviewKeys.size;

    // 载入含一项失败的样例集：闸门、启停、确认状态均不变。
    const failingSet = samplesJson([
      { id: 'OK1', source: '电话 13800001111。', expected: '电话 [手机号]。' },
      { id: 'BAD1', source: '电话 13800001111。', expected: '电话 [错误]。' }
    ]);
    applySamplesText(failingSet);
    expect(store.regReport?.failCount).toBe(1);
    expect(exportBlockReason()).toBe(gateBefore);
    expect(store.disabledRuleIds).toEqual(disabledBefore);
    expect(store.confirmedReviewKeys.size).toBe(confirmedBefore);
    expect(store.run?.reviewPendingCount).toBe(1);

    // 修正为全通过样例集，闸门依旧不受影响。
    applySamplesText(SAMPLE_SET);
    expect(store.regReport?.allPassed).toBe(true);
    expect(exportBlockReason()).toBe(gateBefore);
  });
});
