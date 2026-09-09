import { describe, expect, it } from 'vitest';
import { decodeBytes } from '../../src/engine/decode';

describe('decodeBytes 声明编码解码', () => {
  it('UTF-8 文本正常解码', () => {
    const bytes = new TextEncoder().encode('合同附件：金额 100 元');
    const result = decodeBytes(bytes, 'utf-8', 'a.txt');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('合同附件：金额 100 元');
  });

  it('GBK 字节按声明编码解码', () => {
    // “中” 的 GBK 编码为 0xD6 0xD0。
    const result = decodeBytes(new Uint8Array([0xd6, 0xd0]), 'gbk', 'b.txt');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('中');
  });

  it('不支持的编码标签：报错并列出常见可选编码', () => {
    const result = decodeBytes(new Uint8Array([0x41]), 'utf-99', 'c.txt');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ENCODING_UNSUPPORTED');
    expect(result.error.file).toBe('c.txt');
    expect(result.error.message).toContain('utf-99');
    expect(result.error.message).toContain('utf-8');
  });

  it('声明 UTF-8 但字节非法：报错并给出首个失败字节位置', () => {
    // 0xC3 期待后续字节，0x28 不是合法续字节 → 位置 0 失败。
    const result = decodeBytes(new Uint8Array([0x41, 0xc3, 0x28, 0x42]), 'utf-8', 'd.txt');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DECODE_FAILED');
    expect(result.error.file).toBe('d.txt');
    expect(result.error.position).toBe(1);
    expect(result.error.message).toContain('第 1 字节');
  });

  it('多字节字符被截断时报告截断点位置', () => {
    // “中” UTF-8 为 E4 B8 AD，只给前两个字节。
    const result = decodeBytes(new Uint8Array([0xe4, 0xb8]), 'utf-8', 'e.txt');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DECODE_FAILED');
    expect(result.error.position).toBe(0);
  });

  it('编码标签大小写与空白不敏感', () => {
    const bytes = new TextEncoder().encode('ok');
    const result = decodeBytes(bytes, '  UTF-8 ', 'f.txt');
    expect(result.ok).toBe(true);
  });

  it('空文件按声明编码解码为空串', () => {
    const result = decodeBytes(new Uint8Array(0), 'utf-8', 'g.txt');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('');
  });
});
