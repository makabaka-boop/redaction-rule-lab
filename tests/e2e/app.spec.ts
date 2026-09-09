import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const outputMasks = '[data-testid="output-pane"] button.mask';
const sourceHits = '[data-testid="source-pane"] button.hit';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // 等待内置示例自动加载并完成首次计算。
  await expect(page.locator(outputMasks).first()).toBeVisible();
});

test('示例加载后并排展示原文与脱敏结果，遮蔽块数量一致', async ({ page }) => {
  const maskedCount = await page.locator(outputMasks).count();
  const hitCount = await page.locator(sourceHits).count();
  expect(maskedCount).toBeGreaterThan(0);
  expect(maskedCount).toBe(hitCount);
  // 原文中的手机号不得出现在脱敏结果里。
  const outputText = await page.locator('[data-testid="output-pane"] .text-view').innerText();
  expect(outputText).not.toContain('13912345678');
  expect(outputText).toContain('[手机号]');
});

test('点击遮蔽块展示来源规则、原始范围与裁决原因', async ({ page }) => {
  await page.locator(outputMasks).first().click();
  const detail = page.getByTestId('detail-panel');
  await expect(detail).toContainText('来源规则');
  await expect(detail).toContainText('原始范围');
  await expect(detail).toContainText('裁决原因');
  await expect(detail).toContainText(/R\d/);
  // 两侧对应区间同步高亮。
  await expect(page.locator(`${outputMasks}.selected`)).toHaveCount(1);
  await expect(page.locator(`${sourceHits}.selected`)).toHaveCount(1);
});

test('逐条启停规则后立即重新计算', async ({ page }) => {
  const before = await page.locator(outputMasks).count();
  const ruleItem = page.locator('.rule-list li', { has: page.locator('.rule-id', { hasText: /^R4$/ }) });
  await ruleItem.locator('input[type="checkbox"]').uncheck();
  // 停用“姓名”规则后遮蔽块减少，且结果区无错误。
  await expect(page.locator(outputMasks)).toHaveCount(before - 3);
  await expect(page.locator('.error-box.run')).toHaveCount(0);
  await ruleItem.locator('input[type="checkbox"]').check();
  await expect(page.locator(outputMasks)).toHaveCount(before);
});

test('非法正则：报错含规则编号，旧结果不污染且导出锁定，恢复后重新开放', async ({ page }) => {
  const exportRedacted = page.getByTestId('export-redacted');
  const exportChecklist = page.getByTestId('export-checklist');
  await expect(exportRedacted).toBeEnabled();
  await expect(exportChecklist).toBeEnabled();

  const before = await page.locator(outputMasks).count();
  await page.locator('textarea.rules-input').fill(JSON.stringify({
    rules: [
      { id: 'BROKEN', name: '坏规则', pattern: '([a-z', priority: 1, template: '[X]', mustCheck: false }
    ]
  }));
  const errorBox = page.locator('.error-box.rule');
  await expect(errorBox).toBeVisible();
  await expect(errorBox).toContainText('BROKEN');
  await expect(errorBox).toContainText('第 1 条');
  // 上一份有效结果仍然展示、不被污染，但两个导出入口都锁定。
  await expect(page.locator(outputMasks)).toHaveCount(before);
  await expect(exportRedacted).toBeDisabled();
  await expect(exportChecklist).toBeDisabled();
  await expect(page.getByTestId('export-blocked')).toContainText('规则');

  // 恢复合法规则并重新计算后，导出重新开放。
  await page.locator('textarea.rules-input').fill(JSON.stringify({
    rules: [
      { id: 'OK1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[手机号]', mustCheck: true }
    ]
  }));
  await expect(page.locator('.error-box.rule')).toHaveCount(0);
  await expect(page.getByTestId('export-blocked')).toHaveCount(0);
  await expect(exportRedacted).toBeEnabled();
  await expect(exportChecklist).toBeEnabled();
});

test('零长度匹配：整次计算失败并给出规则编号与字符位置，导出锁定', async ({ page }) => {
  await page.locator('textarea.rules-input').fill(JSON.stringify({
    rules: [{ id: 'Z9', name: '零宽', pattern: 'x*', priority: 1, template: '[Z]', mustCheck: false }]
  }));
  const errorBox = page.locator('.error-box.run');
  await expect(errorBox).toBeVisible();
  await expect(errorBox).toContainText('Z9');
  await expect(errorBox).toContainText('位置 0');
  // 上一份有效结果保留展示，但导出被锁定。
  await expect(page.locator('.stale-banner')).toBeVisible();
  await expect(page.getByTestId('export-redacted')).toBeDisabled();
  await expect(page.getByTestId('export-blocked')).toBeVisible();
});

test('停用必检规则导致残留：复核失败、保留旧结果并禁止导出', async ({ page }) => {
  const ruleItem = page.locator('.rule-list li', { has: page.locator('.rule-id', { hasText: /^R2$/ }) });
  await ruleItem.locator('input[type="checkbox"]').uncheck();
  const errorBox = page.locator('.error-box.run');
  await expect(errorBox).toBeVisible();
  await expect(errorBox).toContainText('R2');
  await expect(errorBox).toContainText('残留');
  await expect(page.locator('.stale-banner')).toBeVisible();
  await expect(page.getByTestId('export-redacted')).toBeDisabled();
  await expect(page.getByTestId('export-checklist')).toBeDisabled();
  // 重新启用后恢复可导出。
  await ruleItem.locator('input[type="checkbox"]').check();
  await expect(page.getByTestId('export-redacted')).toBeEnabled();
});

test('清单行与遮蔽块联动：点击清单行选中对应区间', async ({ page }) => {
  const rows = page.locator('[data-testid="checklist-table"] tbody tr');
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveClass(/selected/);
  await expect(page.locator(`${outputMasks}.selected`)).toHaveCount(1);
  const detail = page.getByTestId('detail-panel');
  await expect(detail).toContainText('来源规则');
});

test('导出脱敏文本与审阅清单：两者逐项对应', async ({ page }) => {
  const [redactedDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-redacted').click()
  ]);
  const [checklistDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-checklist').click()
  ]);

  const redactedPath = await redactedDownload.path();
  const checklistPath = await checklistDownload.path();
  expect(redactedPath).toBeTruthy();
  expect(checklistPath).toBeTruthy();

  const redacted = readFileSync(redactedPath as string, 'utf-8');
  const checklist = JSON.parse(readFileSync(checklistPath as string, 'utf-8')) as {
    entryCount: number;
    entries: Array<{
      ruleId: string;
      source: { start: number; end: number; text: string };
      output: { start: number; end: number; text: string };
      replacement: string;
    }>;
  };

  expect(checklist.entryCount).toBe(checklist.entries.length);
  expect(checklist.entries.length).toBeGreaterThan(0);
  // 敏感原文不得出现在脱敏文本中。
  expect(redacted).not.toContain('13912345678');
  // 逐项核对：清单记录的输出区间在脱敏文本中切出的内容 === 替换内容。
  for (const entry of checklist.entries) {
    expect(redacted.slice(entry.output.start, entry.output.end)).toBe(entry.replacement);
    expect(entry.output.text).toBe(entry.replacement);
    expect(entry.source.text.length).toBe(entry.source.end - entry.source.start);
  }
  // 遮蔽块数量与界面一致。
  const maskedCount = await page.locator(outputMasks).count();
  expect(checklist.entries.length).toBe(maskedCount);
});

test('声明编码无法解码的本地文件：报错并锁定导出，成功读取后重新开放', async ({ page }) => {
  const exportRedacted = page.getByTestId('export-redacted');
  const exportChecklist = page.getByTestId('export-checklist');
  await expect(exportRedacted).toBeEnabled();
  const before = await page.locator(outputMasks).count();
  const fileInput = page.locator('.panel').first().locator('input[type="file"]');

  // 0xC3 0x28 不是合法 UTF-8 序列。
  await fileInput.setInputFiles({
    name: 'broken.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from([0x41, 0xc3, 0x28, 0x42])
  });
  const errorBox = page.locator('.error-box.io');
  await expect(errorBox).toBeVisible();
  await expect(errorBox).toContainText('broken.txt');
  await expect(errorBox).toContainText('第 1 字节');
  // 旧结果继续展示、不被污染，但两个导出入口都锁定。
  await expect(page.locator(outputMasks)).toHaveCount(before);
  await expect(exportRedacted).toBeDisabled();
  await expect(exportChecklist).toBeDisabled();
  await expect(page.getByTestId('export-blocked')).toContainText('文件');

  // 成功读取合法文件并重新计算后，错误清除、导出重新开放。
  await fileInput.setInputFiles({
    name: 'ok.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(new TextEncoder().encode('联系人电话 13911112222。'))
  });
  await expect(page.locator('.error-box.io')).toHaveCount(0);
  await expect(page.getByTestId('export-blocked')).toHaveCount(0);
  await expect(exportRedacted).toBeEnabled();
  await expect(exportChecklist).toBeEnabled();
  // 新内容已完成脱敏计算。
  const outputText = await page.locator('[data-testid="output-pane"] .text-view').innerText();
  expect(outputText).toContain('[手机号]');
  expect(outputText).not.toContain('13911112222');
});
