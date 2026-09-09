import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRulesText,
  clearIoErrors,
  exportBlockReason,
  recompute,
  setSourceText,
  store
} from '../../src/store';

const VALID_RULES = JSON.stringify({
  rules: [
    {
      id: 'P1',
      name: '手机号',
      pattern: '1[3-9]\\d{9}',
      priority: 90,
      template: '[手机号]',
      mustCheck: true
    }
  ]
});

const BROKEN_RULES = JSON.stringify({
  rules: [{ id: 'BROKEN', name: '坏正则', pattern: '([a-z', priority: 1, template: '[X]' }]
});

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
}

function readyRun(): void {
  applyRulesText(VALID_RULES);
  setSourceText('联系电话 13800001111。');
  recompute();
}

describe('导出闸门：输入存在错误时锁定两个导出入口', () => {
  beforeEach(resetStore);

  it('输入一致且计算通过时导出开放', () => {
    readyRun();
    expect(store.run).not.toBeNull();
    expect(exportBlockReason()).toBeNull();
  });

  it('规则解析错误：旧结果保留展示但导出锁定，恢复合法规则并重算后重新开放', () => {
    readyRun();
    const validOutput = store.run?.output;
    expect(validOutput).toBeDefined();

    applyRulesText(BROKEN_RULES);
    expect(store.ruleErrors.length).toBeGreaterThan(0);
    expect(store.ruleErrors[0].ruleId).toBe('BROKEN');
    // 旧结果不被污染，但导出锁定。
    expect(store.run?.output).toBe(validOutput);
    expect(exportBlockReason()).toContain('规则');

    applyRulesText(VALID_RULES);
    recompute();
    expect(store.ruleErrors).toEqual([]);
    expect(store.run?.output).toBe(validOutput);
    expect(exportBlockReason()).toBeNull();
  });

  it('文件解码错误：导出锁定；粘贴新原文或成功读取文件后错误清除并重新开放', () => {
    readyRun();
    expect(exportBlockReason()).toBeNull();

    store.ioErrors = [
      {
        code: 'DECODE_FAILED',
        message: '文件 bad.txt：按声明编码 "utf-8" 解码失败，首个无法解码的字节位于第 1 字节',
        file: 'bad.txt',
        position: 1,
        scope: 'source'
      }
    ];
    expect(exportBlockReason()).toContain('文件');

    // 用户改为直接粘贴文本：原文来源的解码错误随之失效。
    setSourceText('新文本 13911112222。');
    recompute();
    expect(store.ioErrors).toEqual([]);
    expect(exportBlockReason()).toBeNull();
  });

  it('规则文件的解码错误不会被原文输入清除，反之亦然', () => {
    readyRun();
    store.ioErrors = [
      { code: 'DECODE_FAILED', message: '规则文件解码失败', file: 'rules.json', scope: 'rules' }
    ];
    setSourceText('另一段文本 13700001111。');
    recompute();
    expect(store.ioErrors).toHaveLength(1);
    expect(exportBlockReason()).toContain('文件');

    clearIoErrors('rules');
    expect(exportBlockReason()).toBeNull();

    store.ioErrors = [
      { code: 'DECODE_FAILED', message: '原文文件解码失败', file: 'a.txt', scope: 'source' }
    ];
    applyRulesText(VALID_RULES);
    recompute();
    expect(store.ioErrors).toHaveLength(1);
    expect(exportBlockReason()).toContain('文件');
  });

  it('计算错误（零长度匹配）期间导出锁定，修复规则后重新开放', () => {
    readyRun();
    expect(exportBlockReason()).toBeNull();

    applyRulesText(
      JSON.stringify({
        rules: [{ id: 'Z1', name: '零宽', pattern: 'x*', priority: 1, template: '[Z]' }]
      })
    );
    recompute();
    expect(store.runErrors.length).toBeGreaterThan(0);
    expect(store.runErrors[0].code).toBe('ZERO_LENGTH_MATCH');
    expect(exportBlockReason()).toContain('校验');

    applyRulesText(VALID_RULES);
    recompute();
    expect(store.runErrors).toEqual([]);
    expect(exportBlockReason()).toBeNull();
  });

  it('必检残留期间导出锁定（保留既有行为）', () => {
    applyRulesText(
      JSON.stringify({
        rules: [
          { id: 'P1', name: '手机号', pattern: '1[3-9]\\d{9}', priority: 90, template: '[P]', mustCheck: true },
          { id: 'F1', name: '称谓', pattern: '电话', priority: 10, template: '[T]', mustCheck: false }
        ]
      })
    );
    setSourceText('联系电话 13800001111。');
    recompute();
    expect(exportBlockReason()).toBeNull();

    // 停用必检规则 P1：手机号残留于输出，复核失败。
    store.disabledRuleIds = new Set(['P1']);
    recompute();
    expect(store.runErrors.length).toBeGreaterThan(0);
    expect(store.runErrors[0].code).toBe('MUST_CHECK_RESIDUAL');
    expect(exportBlockReason()).not.toBeNull();

    store.disabledRuleIds = new Set();
    recompute();
    expect(exportBlockReason()).toBeNull();
  });
});
