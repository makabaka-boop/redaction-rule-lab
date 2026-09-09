import type { DecodeResult } from './types';

/**
 * 按用户声明的编码解码本地文件字节。
 *  - 编码标签不识别 → ENCODING_UNSUPPORTED（列出常见可选编码）；
 *  - 字节流不符合声明编码 → DECODE_FAILED，并用二分定位首个失败字节的位置。
 * 全程使用 fatal 模式，绝不允许静默替换字符把坏字节带进文本。
 */
export function decodeBytes(bytes: Uint8Array, encodingLabel: string, fileName: string): DecodeResult {
  const label = encodingLabel.trim().toLowerCase();
  if (label === '') {
    return {
      ok: false,
      error: {
        code: 'ENCODING_UNSUPPORTED',
        file: fileName,
        message: `文件 ${fileName}：未声明编码，请先选择文件编码（如 utf-8、gbk）`
      }
    };
  }

  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label, { fatal: true });
  } catch {
    return {
      ok: false,
      error: {
        code: 'ENCODING_UNSUPPORTED',
        file: fileName,
        message:
          `文件 ${fileName}：编码 "${encodingLabel}" 无法识别，` +
          `浏览器支持的常见编码包括 utf-8、utf-16le、utf-16be、gbk、gb18030、big5、iso-8859-1、shift_jis、euc-kr`
      }
    };
  }

  try {
    return { ok: true, text: decoder.decode(bytes) };
  } catch {
    const position = locateFirstBadByte(bytes, label);
    return {
      ok: false,
      error: {
        code: 'DECODE_FAILED',
        file: fileName,
        position,
        message:
          `文件 ${fileName}：按声明编码 "${label}" 解码失败，` +
          `首个无法解码的字节位于第 ${position} 字节（共 ${bytes.length} 字节）。` +
          `请确认文件真实编码后重新选择`
      }
    };
  }
}

/**
 * 定位首个无法解码的字节位置，分两步：
 *  1. 流式解码二分：找到让解码器首次抛错的最短前缀，失败点落在其末尾字节；
 *  2. 非流式（flush）解码二分：找到首个“非法或不完整序列”的起点。
 * 对“合法起始字节 + 非法续字节”的情形，第 2 步能把位置回退到序列起点，
 * 使用户看到的是真正损坏的字节，而不是恰好触发失败的那个正常字符。
 * 若流式解码全程不抛错（如多字节字符被整体截断），直接以第 2 步定位截断点。
 */
function locateFirstBadByte(bytes: Uint8Array, label: string): number {
  const throws = (length: number, stream: boolean): boolean => {
    try {
      new TextDecoder(label, { fatal: true }).decode(bytes.subarray(0, length), { stream });
      return false;
    } catch {
      return true;
    }
  };
  const firstFailingPrefix = (stream: boolean): number | null => {
    if (!throws(bytes.length, stream)) return null;
    let lo = 0;
    let hi = bytes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (throws(mid + 1, stream)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  const streamFailure = firstFailingPrefix(true);
  if (streamFailure !== null) {
    // 失败点之前的流式前缀合法；在其内部用 flush 语义找非法序列的起点。
    const head = bytes.subarray(0, streamFailure + 1);
    const start = firstFailingPrefixWithin(head, label);
    return start ?? streamFailure;
  }
  const flushed = firstFailingPrefix(false);
  return flushed ?? 0;
}

/** 在已知包含非法序列的片段内，二分首个 flush 解码失败的前缀，返回序列起点下标。 */
function firstFailingPrefixWithin(head: Uint8Array, label: string): number | null {
  const throws = (length: number): boolean => {
    try {
      new TextDecoder(label, { fatal: true }).decode(head.subarray(0, length));
      return false;
    } catch {
      return true;
    }
  };
  if (!throws(head.length)) return null;
  let lo = 0;
  let hi = head.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (throws(mid + 1)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** 浏览器 Encoding 标准常见标签，供界面下拉选择。 */
export const ENCODING_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'UTF-8（默认）', value: 'utf-8' },
  { label: 'GBK / GB2312（简体中文 Windows）', value: 'gbk' },
  { label: 'GB18030（简体中文国标）', value: 'gb18030' },
  { label: 'Big5（繁体中文）', value: 'big5' },
  { label: 'UTF-16 LE', value: 'utf-16le' },
  { label: 'UTF-16 BE', value: 'utf-16be' },
  { label: 'ISO-8859-1（拉丁）', value: 'iso-8859-1' },
  { label: 'Shift_JIS（日文）', value: 'shift_jis' },
  { label: 'EUC-KR（韩文）', value: 'euc-kr' }
];
