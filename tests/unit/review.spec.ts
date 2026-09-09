import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRulesText,
  confirmAllPending,
  recompute,
  setSourceText,
  store,
  exportBlockReason,
  toggleRule,
  confirmInterval
} from '../../src/store';
import { parseRulesJson } from '../../src/engine/rules';
import { runPipeline } from '../../src/engine/pipeline';
import { buildExport } from '../../src/engine/exporter';
import { entryKey, reconcileReview, reviewKey, withAllConfirmed, withConfirmed } from '../../src/engine/review';
import type { RunOk } from '../../src/engine/types';

const SOURCE = '甲方联系人：王建国，电话 13800001111；乙方联系人：李晓梅。';

function reviewRules(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    rules: [
      {
        id: 'RV1',
        name: '联系人姓名',
        pattern: '(?<=联系人：)[一-龥]{2,4}',
        flags: 'u',
        priority: 80,
        template: '[姓名]',
        mustCheck: false,
        reviewRequired: true,
        ...extra
      },
      {
        id: 'P1',
        name: '手机号',
        pattern: '1[3-9]\\d{9}',
        priority: 90,
        template: '[手机号]',
        mustCheck: true,
        reviewRequired: false
      }
    ]
  });
}

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
  store.confirmedReviewKeys = new Set();
  store.reviewRevocations = [];
}

function readyRun(): void {
  applyRulesText(reviewRules());
  setSourceText(SOURCE);
  recompute();
}

describe('reviewRequired 字段缺省', () => {
  beforeEach(resetStore);

  it('规则未声明 reviewRequired 时缺省为 false，结果中不产生复核计数', () => {
    const parsed = parseRulesJson(
      JSON.stringify({
        rules: [
          { id: 'R1', name: '数字', pattern: '\\d+', priority: 10, template: '[N]', mustCheck: false }
        ]
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rules[0].reviewRequired).toBe(false);

    const result = runPipeline('编号 1234', parsed.rules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reviewRequiredCount).toBe(0);
    expect(result.reviewPendingCount).toBe(0);
    expect(result.reviewConfirmedCount).toBe(0);
    expect(result.checklist[0].reviewRequired).toBe(false);
    expect(result.checklist[0].reviewStatus).toBe('confirmed');
  });

  it('显式 reviewRequired:true 时，每个保留区间初始为 pending 且计数正确', () => {
    readyRun();
    expect(store.run).not.toBeNull();
    const run = store.run as RunOk;
    // 王建国、李晓梅两个姓名命中；手机号命中不需要复核。
    const reviewEntries = run.checklist.filter((e) => e.reviewRequired);
    expect(reviewEntries).toHaveLength(2);
    expect(reviewEntries.every((e) => e.reviewStatus === 'pending')).toBe(true);
    expect(run.reviewRequiredCount).toBe(2);
    expect(run.reviewPendingCount).toBe(2);
    expect(run.reviewConfirmedCount).toBe(0);
    // 复核条目按原文顺序排列。
    expect(reviewEntries.map((e) => e.sourceText)).toEqual(['王建国', '李晓梅']);
  });

  it('reviewRequired 必须是布尔值，否则规则解析失败', () => {
    const parsed = parseRulesJson(
      JSON.stringify({
        rules: [
          { id: 'R1', name: '数字', pattern: '\\d+', priority: 10, template: '[N]', reviewRequired: 'yes' }
        ]
      })
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].message).toContain('reviewRequired');
  });

  it('旧规则文件（无 reviewRequired）交互与导出行为保持原样：立即可导出', () => {
    applyRulesText(
      JSON.stringify({
        rules: [{ id: 'P1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[手机号]', mustCheck: true }]
      })
    );
    setSourceText('电话 13800001111。');
    recompute();
    expect(exportBlockReason()).toBeNull();
    const bundle = buildExport(store.run as RunOk);
    expect(bundle.selfCheckErrors).toEqual([]);
    const checklist = JSON.parse(bundle.checklistJson);
    expect(checklist.reviewRequiredCount).toBe(0);
    expect(checklist.reviewPendingCount).toBe(0);
  });
});

describe('稳定键：由规则编号、原文区间、替换内容组成', () => {
  beforeEach(resetStore);

  it('稳定键三元组确定，且清单条目可还原同一键', () => {
    const key = reviewKey('RV1', 4, 7, '[姓名]');
    expect(key).toBe(JSON.stringify(['RV1', 4, 7, '[姓名]']));
    readyRun();
    const run = store.run as RunOk;
    const entry = run.checklist.find((e) => e.ruleId === 'RV1') as (typeof run.checklist)[number];
    expect(entryKey(entry)).toBe(reviewKey('RV1', entry.sourceStart, entry.sourceEnd, entry.replacement));
  });

  it('无歧义编码：编号/替换内容含制表符时不发生跨三元组碰撞', () => {
        // 直接拼接 \t 会让两者同为 "A\t1\t2\t3\tX"，从而错误继承确认。
    const confirmed = reviewKey('A\t1', 2, 3, 'X');
    const recomputed = reviewKey('A', 1, 2, '3\tX');
    expect(confirmed).not.toBe(recomputed);
    // 四个组成值逐一变化都产生不同的键。
    expect(reviewKey('A', 1, 2, 'X')).not.toBe(reviewKey('B', 1, 2, 'X'));
    expect(reviewKey('A', 1, 2, 'X')).not.toBe(reviewKey('A', 9, 2, 'X'));
    expect(reviewKey('A', 1, 2, 'X')).not.toBe(reviewKey('A', 1, 9, 'X'));
    expect(reviewKey('A', 1, 2, 'X')).not.toBe(reviewKey('A', 1, 2, 'Y'));
    // 引号、反斜杠等 JSON 特殊字符同样不得制造碰撞。
    expect(reviewKey('A","x",[1,2', 3, 4, 'X')).not.toBe(reviewKey('A', 1, 2, 'x'));
    // 同一三元组两次编码完全一致（确定性）。
    expect(reviewKey('A\t1', 2, 3, 'X\t"\n')).toBe(reviewKey('A\t1', 2, 3, 'X\t"\n'));
  });

  it('碰撞回归：编号与替换内容含制表符的重算不会继承旧确认，新条目保持待确认', () => {
    // 旧结果：规则编号 "A\t1"，命中源文 [2,3)，替换内容 "X"——确认之。
    applyRulesText(
      JSON.stringify({
        rules: [
          { id: 'A\t1', name: '含制表符编号', pattern: 'c', priority: 10, template: 'X', reviewRequired: true }
        ]
      })
    );
    setSourceText('abc');
    recompute();
    let run = store.run as RunOk;
    expect(run.checklist).toHaveLength(1);
    expect([run.checklist[0].sourceStart, run.checklist[0].sourceEnd]).toEqual([2, 3]);
    expect(run.checklist[0].replacement).toBe('X');
    confirmAllPending();
    expect(run.reviewConfirmedCount).toBe(1);
    // 旧的 \t 拼接方案下该键即 "A\t1\t2\t3\tX"。
    expect(store.confirmedReviewKeys.has('A\t1\t2\t3\tX')).toBe(false);
    expect(store.confirmedReviewKeys.has(reviewKey('A\t1', 2, 3, 'X'))).toBe(true);

    // 新结果：三元组 ("A", [1,2), "3\tX")——\t 拼接时与旧键碰撞为同一串。
    applyRulesText(
      JSON.stringify({
        rules: [
          { id: 'A', name: '另一规则', pattern: 'b', priority: 10, template: '3\tX', reviewRequired: true }
        ]
      })
    );
    recompute();
    run = store.run as RunOk;
    expect(run.checklist).toHaveLength(1);
    expect(run.checklist[0].ruleId).toBe('A');
    expect([run.checklist[0].sourceStart, run.checklist[0].sourceEnd]).toEqual([1, 2]);
    expect(run.checklist[0].replacement).toBe('3\tX');
    // 无歧义编码下新条目不得继承旧确认：保持待确认、计数清零、导出锁定。
    expect(run.reviewRequiredCount).toBe(1);
    expect(run.reviewConfirmedCount).toBe(0);
    expect(run.reviewPendingCount).toBe(1);
    expect(run.checklist[0].reviewStatus).toBe('pending');
    expect(store.confirmedReviewKeys.size).toBe(0);
    expect(store.reviewRevocations).toHaveLength(1);
    expect(store.reviewRevocations[0].ruleId).toBe('A\t1');
    expect([store.reviewRevocations[0].start, store.reviewRevocations[0].end]).toEqual([2, 3]);
    expect(exportBlockReason()).toContain('待人工确认');
    const bundle = buildExport(run);
    expect(bundle.selfCheckErrors.some((msg) => msg.includes('仍待人工确认'))).toBe(true);
  });

  it('替换内容不同（模板变化）则键不同', () => {
    expect(reviewKey('RV1', 0, 3, '[A]')).not.toBe(reviewKey('RV1', 0, 3, '[B]'));
  });

  it('区间不同则键不同，即使规则与替换内容相同', () => {
    expect(reviewKey('RV1', 0, 3, '[X]')).not.toBe(reviewKey('RV1', 5, 8, '[X]'));
  });

  it('withConfirmed / withAllConfirmed 只影响要求复核的条目', () => {
    readyRun();
    const run = store.run as RunOk;
    const firstReview = run.checklist.find((e) => e.reviewRequired) as (typeof run.checklist)[number];
    const phone = run.checklist.find((e) => e.ruleId === 'P1') as (typeof run.checklist)[number];

    let keys = withConfirmed(run, new Set(), phone.index);
    expect(keys.size).toBe(0);
    keys = withConfirmed(run, keys, firstReview.index);
    expect(keys.size).toBe(1);
    expect(keys.has(entryKey(firstReview))).toBe(true);

    const all = withAllConfirmed(run);
    expect(all.size).toBe(2);
  });
});

describe('确认状态对账：重算时仅保留完全对应的确认', () => {
  beforeEach(resetStore);

  it('原文未变重算：确认全部保留', () => {
    readyRun();
    confirmAllPending();
    expect(store.run?.reviewPendingCount).toBe(0);
    recompute();
    expect(store.run?.reviewConfirmedCount).toBe(2);
    expect(store.run?.reviewPendingCount).toBe(0);
    expect(store.reviewRevocations).toEqual([]);
  });

  it('原文变化导致区间漂移：旧确认全部失效并给出可定位的撤销提示', () => {
    readyRun();
    confirmAllPending();
    // 前面插入字符，所有姓名区间后移，稳定键中的区间不再对应。
    setSourceText(`【补充】${SOURCE}`);
    recompute();
    expect(store.run?.reviewRequiredCount).toBe(2);
    expect(store.run?.reviewConfirmedCount).toBe(0);
    expect(store.run?.reviewPendingCount).toBe(2);
    expect(store.reviewRevocations).toHaveLength(2);
    // 撤销提示可定位到规则编号与区间，且按原文顺序排列。
    expect(store.reviewRevocations[0].ruleId).toBe('RV1');
    expect(store.reviewRevocations[0].start).toBeLessThan(store.reviewRevocations[1].start);
    expect(store.reviewRevocations[0].end).toBeGreaterThan(store.reviewRevocations[0].start);
  });

  it('仅区间相同但替换内容变化（模板修改）：确认失效', () => {
    readyRun();
    confirmAllPending();
    applyRulesText(reviewRules({ template: '[联系人姓名]' }));
    recompute();
    expect(store.runErrors).toEqual([]);
    expect(store.run?.reviewPendingCount).toBe(2);
    expect(store.run?.reviewConfirmedCount).toBe(0);
    expect(store.reviewRevocations).toHaveLength(2);
    expect(store.reviewRevocations.every((r) => r.replacement === '[姓名]')).toBe(true);
  });

  it('规则启停后再开启：区间恢复一致时确认可重新对应', () => {
    readyRun();
    confirmAllPending();
    // 停用复核规则：新结果无复核项，旧确认全部撤销。
    toggleRule('RV1', false);
    expect(store.run?.reviewRequiredCount).toBe(0);
    expect(store.reviewRevocations).toHaveLength(2);
    // 重新启用：区间与替换内容与最初一致，但确认已撤销，需要重新确认。
    toggleRule('RV1', true);
    expect(store.run?.reviewRequiredCount).toBe(2);
    expect(store.run?.reviewPendingCount).toBe(2);
    expect(store.run?.reviewConfirmedCount).toBe(0);
  });

  it('部分区间变化：只保留仍完全对应的确认，其余撤销', () => {
    readyRun();
    const run = store.run as RunOk;
    const first = run.checklist.find((e) => e.ruleId === 'RV1') as (typeof run.checklist)[number];
    // 只确认第一个姓名（王建国）。
    confirmInterval(first.index);
    expect(store.run?.reviewConfirmedCount).toBe(1);

    // 在后段插入内容：李晓梅的区间后移，王建国位置与内容完全不变。
    setSourceText('甲方联系人：王建国，电话 13800001111，邮箱略；乙方联系人：李晓梅。');
    recompute();
    const after = store.run as RunOk;
    const surviving = after.checklist.find(
      (e) => e.ruleId === 'RV1' && e.sourceText === '王建国'
    ) as (typeof after.checklist)[number];
    expect(surviving.reviewStatus).toBe('confirmed');
    const moved = after.checklist.find(
      (e) => e.ruleId === 'RV1' && e.sourceText === '李晓梅'
    ) as (typeof after.checklist)[number];
    expect(moved).toBeDefined();
    // 李晓梅原本未确认，撤销提示只包含“被撤销的已确认项”，即王建国若漂移才有；此处王建国保留，故无撤销。
    expect(store.reviewRevocations).toEqual([]);
  });

  it('计算失败：上一份有效结果及其确认状态原样保留，撤销提示不新增', () => {
    readyRun();
    confirmAllPending();
    // 零长度命中规则导致整次运行失败。
    applyRulesText(
      JSON.stringify({
        rules: [
          { id: 'Z9', name: '零宽', pattern: 'x*', priority: 1, template: '[Z]', mustCheck: false }
        ]
      })
    );
    recompute();
    expect(store.runErrors.length).toBeGreaterThan(0);
    // 旧结果（含确认状态与计数）完整保留。
    expect(store.run?.reviewConfirmedCount).toBe(2);
    expect(store.run?.reviewPendingCount).toBe(0);
    expect(store.confirmedReviewKeys.size).toBe(2);
  });

  it('重新载入文件得到全新结果：不对应的确认不会授权新结果', () => {
    readyRun();
    confirmAllPending();
    // 全新原文：姓名区间与内容都不同。
    setSourceText('联系人：赵小伟，电话 13611112222。');
    recompute();
    expect(store.run?.reviewRequiredCount).toBe(1);
    expect(store.run?.reviewConfirmedCount).toBe(0);
    expect(store.run?.reviewPendingCount).toBe(1);
    // 确认集合被对账收敛为仍有效键的子集（此处为空），旧键不再残留。
    expect(store.confirmedReviewKeys.size).toBe(0);
  });
});

describe('待确认导出阻断', () => {
  beforeEach(resetStore);

  it('存在待确认项时闸门锁定；逐项确认与全部确认后开放', () => {
    readyRun();
    expect(exportBlockReason()).toContain('待人工确认');

    const run = store.run as RunOk;
    const entries = run.checklist.filter((e) => e.reviewRequired);
    confirmInterval(entries[0].index);
    expect(store.run?.reviewPendingCount).toBe(1);
    expect(exportBlockReason()).toContain('1');

    confirmInterval(entries[1].index);
    expect(store.run?.reviewPendingCount).toBe(0);
    expect(exportBlockReason()).toBeNull();
  });

  it('确认全部按钮一次清空待办并立即开放导出', () => {
    readyRun();
    expect(exportBlockReason()).not.toBeNull();
    confirmAllPending();
    expect(exportBlockReason()).toBeNull();
    const bundle = buildExport(store.run as RunOk);
    expect(bundle.selfCheckErrors).toEqual([]);
  });

  it('导出自检拦截仍为 pending 的条目（防御性）', () => {
    readyRun();
    const bundle = buildExport(store.run as RunOk);
    expect(bundle.selfCheckErrors.some((msg) => msg.includes('仍待人工确认'))).toBe(true);
  });

  it('重算撤销确认后导出重新锁定，重新确认后再次开放', () => {
    readyRun();
    confirmAllPending();
    expect(exportBlockReason()).toBeNull();
    setSourceText(`【补充】${SOURCE}`);
    recompute();
    expect(exportBlockReason()).toContain('待人工确认');
    expect(store.run?.reviewPendingCount).toBe(2);
    confirmAllPending();
    expect(exportBlockReason()).toBeNull();
  });
});

describe('导出清单 redaction-review-checklist/1：追加字段与逐项对应', () => {
  beforeEach(resetStore);

  it('清单保留原有字段并追加 reviewRequired / reviewStatus 与汇总计数', () => {
    readyRun();
    const run = store.run as RunOk;
    const bundlePending = buildExport(run);
    const parsedPending = JSON.parse(bundlePending.checklistJson) as {
      format: string;
      reviewRequiredCount: number;
      reviewConfirmedCount: number;
      reviewPendingCount: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(parsedPending.format).toBe('redaction-review-checklist/1');
    expect(parsedPending.reviewRequiredCount).toBe(2);
    expect(parsedPending.reviewPendingCount).toBe(2);
    expect(parsedPending.reviewConfirmedCount).toBe(0);

    for (const entry of parsedPending.entries) {
      // 原有字段仍在。
      expect(entry).toHaveProperty('index');
      expect(entry).toHaveProperty('ruleId');
      expect(entry).toHaveProperty('priority');
      expect(entry).toHaveProperty('mustCheck');
      expect(entry).toHaveProperty('source');
      expect(entry).toHaveProperty('output');
      expect(entry).toHaveProperty('replacement');
      expect(entry).toHaveProperty('arbitration');
      // 追加字段存在且取值合法。
      expect(typeof entry.reviewRequired).toBe('boolean');
      expect(['pending', 'confirmed']).toContain(entry.reviewStatus);
    }

    confirmAllPending();
    const parsedConfirmed = JSON.parse(buildExport(store.run as RunOk).checklistJson);
    expect(parsedConfirmed.reviewPendingCount).toBe(0);
    expect(parsedConfirmed.reviewConfirmedCount).toBe(2);
    const reviewEntries = parsedConfirmed.entries.filter((e: Record<string, unknown>) => e.reviewRequired);
    expect(reviewEntries.every((e: Record<string, unknown>) => e.reviewStatus === 'confirmed')).toBe(true);
    // 非复核规则条目：reviewRequired=false。
    const phone = parsedConfirmed.entries.find(
      (e: Record<string, unknown>) => e.ruleId === 'P1'
    ) as Record<string, unknown>;
    expect(phone.reviewRequired).toBe(false);
  });

  it('复核条目与遮蔽块逐项对应：键由规则编号/原文区间/替换内容还原', () => {
    readyRun();
    const run = store.run as RunOk;
    const reviewEntries = run.checklist.filter((e) => e.reviewRequired);
    for (const entry of reviewEntries) {
      // 原文区间切出内容等于记录片段。
      expect(run.source.slice(entry.sourceStart, entry.sourceEnd)).toBe(entry.sourceText);
      // 输出区间切出内容等于替换内容。
      expect(run.output.slice(entry.outputStart, entry.outputEnd)).toBe(entry.replacement);
      // 状态对账：键集合中的条目变为 confirmed，其余 pending。
    }
    const keys = new Set(reviewEntries.slice(0, 1).map((e) => entryKey(e)));
    const fresh = runPipeline(
      run.source,
      store.rules.filter((r) => !store.disabledRuleIds.has(r.id)),
      store.rules
    );
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const retained = reconcileReview(fresh, keys);
    expect(retained.size).toBe(1);
    expect(fresh.reviewConfirmedCount).toBe(1);
    expect(fresh.reviewPendingCount).toBe(1);
  });
});
