<script setup lang="ts">
import { ref } from 'vue';
import { setSourceText, store } from '../store';
import { decodeBytes, ENCODING_OPTIONS } from '../engine/decode';

const encoding = ref('utf-8');
const fileInput = ref<HTMLInputElement | null>(null);
const fileName = ref('');

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = decodeBytes(bytes, encoding.value, file.name);
  if (decoded.ok) {
    // 成功读取：setSourceText 会清除原文来源的读取/解码错误并触发重算。
    setSourceText(decoded.text);
  } else {
    // 失败：保留旧原文与旧结果，记录带来源标记的错误，导出闸门随之锁定。
    store.ioErrors = [
      ...store.ioErrors.filter((e) => e.scope !== 'source'),
      { ...decoded.error, scope: 'source' as const }
    ];
  }
  input.value = '';
}

async function reloadWithEncoding(): Promise<void> {
  // 编码变更后提示用户重新选择文件（浏览器不允许程序读取已选文件之外的路径）。
  fileInput.value?.click();
}

async function loadSample(): Promise<void> {
  try {
    const res = await fetch('samples/contract.txt');
    if (!res.ok) throw new Error(String(res.status));
    setSourceText(await res.text());
    fileName.value = '内置示例 contract.txt';
  } catch {
    store.ioErrors = [
      ...store.ioErrors.filter((e) => e.scope !== 'source'),
      {
        code: 'DECODE_FAILED' as const,
        message: '内置示例文本加载失败，请改用粘贴或本地文件',
        scope: 'source' as const
      }
    ];
  }
}
</script>

<template>
  <section class="panel">
    <h2>① 原文输入 <span class="hint">仅粘贴文本或本地 TXT，不连接任何服务</span></h2>
    <textarea
      class="source-input"
      :value="store.sourceText"
      placeholder="在此粘贴合同附件文本……"
      rows="10"
      @input="setSourceText(($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <div class="row">
      <label class="field">
        文件编码
        <select v-model="encoding">
          <option v-for="opt in ENCODING_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <button type="button" @click="reloadWithEncoding">选择本地 TXT…</button>
      <button type="button" class="ghost" @click="loadSample">载入示例文本</button>
      <input ref="fileInput" type="file" accept=".txt,text/plain" hidden @change="onFileChange" />
    </div>
    <p v-if="fileName" class="meta">当前来源：{{ fileName }}（按声明编码 {{ encoding }} 解码）</p>
    <p class="meta">字符数：{{ store.sourceText.length }}</p>
  </section>
</template>
