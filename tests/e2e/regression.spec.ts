import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const outputMasks = '[data-testid="output-pane"] button.mask';

/**
 * 规则 JSON：pattern 可变。
 * 初始用只匹配 138 号段的窄正则，让 139 样例失败；修正为完整号段后全通过。
 */
function phoneRulesJson(pattern: string, template = '[手机号]', reviewRequired = false): string {
  return JSON.stringify({
    rules: [
      {
        id: 'P1',
        name: '手机号',
        pattern,
        priority: 90,
        template,
        mustCheck: true,
        reviewRequired
      }
    ]
  });
}

const NARROW_PATTERN = '138\\d{8}';
const FULL_PATTERN = '1[3-9]\\d{9}';

/** 含一项失败（BAD 是窄正则漏遮的 139 号码）的回归样例集。 */
function failingSamplesJson(): string {
  return JSON.stringify({
    samples: [
      {
        id: 'GOOD',
        source: '联系电话 13800001111。',
        expected: '联系电话 [手机号]。',
        expectedRules: ['P1']
      },
      {
        id: 'BAD',
        source: '备用电话 13900002222。',
        expected: '备用电话 [手机号]。'
      }
    ]
  });
}

/** 修正规则后全部通过的样例集（同样两项，期望值不变）。 */
function passingSamplesJson(): string {
  return failingSamplesJson();
}

test.describe('本地回归样例集闭环（独立验收）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('载入含一项失败的样例集 → 定位差异 → 修正规则触发全量通过 → 继续完成原脱敏确认与下载', async ({ page }) => {
    const exportRedacted = page.getByTestId('export-redacted');
    const exportChecklist = page.getByTestId('export-checklist');

    // —— ① 载入「当前有效规则」：先用只匹配 138 号段的窄正则，让 139 样例漏遮失败 ——
    await page.locator('textarea.rules-input').fill(phoneRulesJson(NARROW_PATTERN));
    // 主原文随意给一段，证明回归独立于主原文运行。
    await page.locator('textarea.source-input').fill('与样例无关的主合同文本，无敏感片段。');
    // 没有任何命中时主管线成功（输出即原文）；不影响回归面板。

    // —— ② 选择本地样例 JSON 后自动运行：2 项中 1 项通过 1 项失败 ——
    const sampleInput = page.getByTestId('regression-panel').locator('input[type="file"]');
    await sampleInput.setInputFiles({
      name: 'regression-cases.json',
      mimeType: 'application/json',
      buffer: Buffer.from(failingSamplesJson(), 'utf-8')
    });

    const summary = page.getByTestId('regression-summary');
    await expect(summary).toBeVisible();
    await expect(page.getByTestId('regression-pass-count')).toHaveText('1');
    await expect(summary).toContainText('/ 2 项通过');
    await expect(summary).toContainText('1 项失败');

    const items = page.getByTestId('regression-item');
    await expect(items).toHaveCount(2);
    // 结果严格按文件顺序：GOOD 通过、BAD 失败。
    await expect(items.nth(0)).toHaveAttribute('data-status', 'pass');
    await expect(items.nth(1)).toHaveAttribute('data-status', 'text-mismatch');

    // 回归面板是只读旁路：主工作区没有因样例产生任何错误，导出状态不被回归影响。
    await expect(page.locator('.error-box.run')).toHaveCount(0);
    // 主原文无敏感片段、无待确认，导出本就开放；回归失败不得锁定它。
    await expect(exportRedacted).toBeEnabled();

    // —— ③ 点击失败项：查看首个文本差异位置、实际与期望片段 ——
    await items.nth(1).getByTestId('regression-item-head').click();
    const detail = page.getByTestId('regression-detail');
    await expect(detail).toBeVisible();
    const textDiff = page.getByTestId('regression-text-diff');
    await expect(textDiff).toBeVisible();
    // 「备用电话 」4 个字符 + 139 漏遮：实际为「备用电话 13900002222。」，
    // 期望为「备用电话 [手机号]。」，首个差异位于下标 5（'1' 与 '['）。
    await expect(page.getByTestId('regression-diff-index')).toHaveText('5');
    await expect(page.getByTestId('regression-actual-snippet')).toContainText('13900002222');
    await expect(page.getByTestId('regression-expected-snippet')).toContainText('[手机号]');
    // BAD 未声明期望规则序列，因此不展示序列差异。
    await expect(page.getByTestId('regression-sequence-diff')).toHaveCount(0);

    // —— ④ 修正规则（放宽为完整号段）：触发全量重跑，两项全部通过 ——
    await page.locator('textarea.rules-input').fill(phoneRulesJson(FULL_PATTERN));
    await expect(page.getByTestId('regression-pass-count')).toHaveText('2');
    await expect(summary).toContainText('/ 2 项通过');
    await expect(summary).toContainText('全部通过');
    await expect(items.nth(0)).toHaveAttribute('data-status', 'pass');
    await expect(items.nth(1)).toHaveAttribute('data-status', 'pass');
    // 失败项已不再可展开（通过项不展示详情）。
    await expect(page.getByTestId('regression-detail')).toHaveCount(0);

    // —— ⑤ 继续完成「原有」脱敏确认与下载流程（与回归模块互不干扰）——
    // 换成要求人工复核的规则与含两个号码的主原文。
    await page.locator('textarea.rules-input').fill(phoneRulesJson(FULL_PATTERN, '[手机号]', true));
    await page
      .locator('textarea.source-input')
      .fill('甲方联系人：王建国，电话 13800001111。乙方联系人：李晓梅，电话 13755556666。');
    // 回归样例仍 2 项全通过（规则改动触发了重跑）。
    await expect(page.getByTestId('regression-pass-count')).toHaveText('2');

    // 主脱敏结果出现 2 个待确认遮蔽块，导出锁定——与回归通过与否无关。
    await expect(page.locator(outputMasks).first()).toBeVisible();
    await expect(page.getByTestId('review-pending-count')).toHaveText('2');
    await expect(exportRedacted).toBeDisabled();
    await expect(exportChecklist).toBeDisabled();

    await page.getByTestId('confirm-all').click();
    await expect(page.getByTestId('export-blocked')).toHaveCount(0);
    await expect(exportRedacted).toBeEnabled();
    await expect(exportChecklist).toBeEnabled();

    const [redactedDownload] = await Promise.all([
      page.waitForEvent('download'),
      exportRedacted.click()
    ]);
    const [checklistDownload] = await Promise.all([
      page.waitForEvent('download'),
      exportChecklist.click()
    ]);
    const redacted = readFileSync((await redactedDownload.path()) as string, 'utf-8');
    const checklist = JSON.parse(readFileSync((await checklistDownload.path()) as string, 'utf-8')) as {
      reviewPendingCount: number;
      reviewRequiredCount: number;
      entryCount: number;
      entries: Array<{ source: { text: string }; replacement: string }>;
    };
    expect(redacted).not.toContain('13800001111');
    expect(redacted).not.toContain('13755556666');
    expect(redacted).toContain('[手机号]');
    expect(checklist.reviewPendingCount).toBe(0);
    expect(checklist.reviewRequiredCount).toBe(2);
    expect(checklist.entryCount).toBe(2);
    // 导出物只含主合同内容，绝不包含仅驻留内存的回归样例原文/期望。
    expect(redacted).not.toContain('备用电话');
    expect(JSON.stringify(checklist)).not.toContain('GOOD');
    expect(JSON.stringify(checklist)).not.toContain('BAD');
  });

  test('期望命中规则序列不符：展示首个差异与仅实际/仅期望编号；改规则后通过', async ({ page }) => {
    await page.locator('textarea.rules-input').fill(
      JSON.stringify({
        rules: [
          { id: 'P1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[手机号]' },
          { id: 'T1', name: '固定电话前缀', pattern: '电话', priority: 80, template: '[T]' }
        ]
      })
    );
    // 实际命中序列为 [T1, P1]，但样例期望只有 [P1]。
    const samples = JSON.stringify({
      samples: [
        {
          id: 'SEQ1',
          source: '电话 13800001111',
          expected: '[T] [手机号]',
          expectedRules: ['P1']
        }
      ]
    });
    await page
      .getByTestId('regression-panel')
      .locator('input[type="file"]')
      .setInputFiles({ name: 'seq.json', mimeType: 'application/json', buffer: Buffer.from(samples, 'utf-8') });

    const item = page.getByTestId('regression-item').first();
    await expect(item).toHaveAttribute('data-status', 'sequence-mismatch');
    await item.getByTestId('regression-item-head').click();
    const seqDiff = page.getByTestId('regression-sequence-diff');
    await expect(seqDiff).toBeVisible();
    const ops = page.getByTestId('regression-seq-op');
    // T1 仅在实际序列、P1 一致。
    await expect(ops).toHaveCount(2);
    await expect(ops.nth(0)).toContainText('仅实际');
    await expect(ops.nth(0)).toContainText('T1');
    await expect(ops.nth(1)).toContainText('一致');
    await expect(ops.nth(1)).toContainText('P1');
    // 文本一致时不展示文本差异。
    await expect(page.getByTestId('regression-text-diff')).toHaveCount(0);

    // 修正期望序列（重新载入样例文件）后该项通过。
    const fixed = JSON.stringify({
      samples: [
        {
          id: 'SEQ1',
          source: '电话 13800001111',
          expected: '[T] [手机号]',
          expectedRules: ['T1', 'P1']
        }
      ]
    });
    await page
      .getByTestId('regression-panel')
      .locator('input[type="file"]')
      .setInputFiles({ name: 'seq2.json', mimeType: 'application/json', buffer: Buffer.from(fixed, 'utf-8') });
    await expect(page.getByTestId('regression-pass-count')).toHaveText('1');
    await expect(page.getByTestId('regression-item').first()).toHaveAttribute('data-status', 'pass');
  });

  test('样例文件语法/字段错误：定位到样例编号或下标并保留上一份有效报告', async ({ page }) => {
    await page.locator('textarea.rules-input').fill(phoneRulesJson(FULL_PATTERN));
    const sampleInput = page.getByTestId('regression-panel').locator('input[type="file"]');

    // 先载入一份全通过的有效报告。
    await sampleInput.setInputFiles({
      name: 'ok.json',
      mimeType: 'application/json',
      buffer: Buffer.from(passingSamplesJson(), 'utf-8')
    });
    await expect(page.getByTestId('regression-pass-count')).toHaveText('2');

    // 再载入编号重复的坏文件：错误定位到重复编号与下标，上一份报告保留。
    const duplicate = JSON.stringify({
      samples: [
        { id: 'DUP', source: '电话 13800001111。', expected: '电话 [手机号]。' },
        { id: 'DUP', source: '电话 13900002222。', expected: '电话 [手机号]。' }
      ]
    });
    await sampleInput.setInputFiles({
      name: 'dup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(duplicate, 'utf-8')
    });
    const errors = page.getByTestId('regression-errors');
    await expect(errors).toBeVisible();
    await expect(errors).toContainText('DUP');
    await expect(errors).toContainText('下标 1');
    // 上一份有效报告仍显示 2/2 通过。
    await expect(page.getByTestId('regression-pass-count')).toHaveText('2');
    await expect(page.getByTestId('regression-item')).toHaveCount(2);

    // 语法错误同样保留报告。
    await sampleInput.setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ "samples": [ ', 'utf-8')
    });
    await expect(page.getByTestId('regression-errors')).toContainText('不是合法 JSON');
    await expect(page.getByTestId('regression-pass-count')).toHaveText('2');
  });

  test('规则启停后回归立即重跑（单项管线失败显示原有错误），不影响规则面板的启停状态', async ({ page }) => {
    await page.locator('textarea.rules-input').fill(phoneRulesJson(FULL_PATTERN));
    const sampleInput = page.getByTestId('regression-panel').locator('input[type="file"]');
    await sampleInput.setInputFiles({
      name: 'cases.json',
      mimeType: 'application/json',
      buffer: Buffer.from(passingSamplesJson(), 'utf-8')
    });
    await expect(page.getByTestId('regression-pass-count')).toHaveText('2');

    // 在规则面板停用 P1：回归立即重跑为逐项管线失败，规则复选框本身保持未勾选。
    const ruleItem = page.locator('.rule-list li', { has: page.locator('.rule-id', { hasText: /^P1$/ }) });
    await ruleItem.locator('input[type="checkbox"]').uncheck();
    await expect(page.getByTestId('regression-item').first()).toHaveAttribute('data-status', 'pipeline-error');
    await page.getByTestId('regression-item').first().getByTestId('regression-item-head').click();
    await expect(page.getByTestId('regression-pipeline-error').first()).toContainText('没有已启用的规则');
    await expect(ruleItem.locator('input[type="checkbox"]')).not.toBeChecked();

    // 重新启用：自动恢复全通过。
    await ruleItem.locator('input[type="checkbox"]').check();
    await expect(page.getByTestId('regression-pass-count')).toHaveText('2');
  });
});
