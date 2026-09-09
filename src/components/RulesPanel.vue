<script setup lang="ts">
import { ref } from 'vue';
import { applyRulesText, store, toggleRule } from '../store';
import { decodeBytes, ENCODING_OPTIONS } from '../engine/decode';

const encoding = ref('utf-8');
const fileInput = ref<HTMLInputElement | null>(null);

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = decodeBytes(bytes, encoding.value, file.name);
  if (decoded.ok) {
    // 成功读取：applyRulesText 会清除规则来源的读取/解码错误并触发重算。
    applyRulesText(decoded.text);
  } else {
    // 失败：沿用上一份有效规则，记录带来源标记的错误，导出闸门随之锁定。
    store.ioErrors = [
      ...store.ioErrors.filter((e) => e.scope !== 'rules'),
      { ...decoded.error, scope: 'rules' as const }
    ];
  }
  input.value = '';
}

async function loadSample(): Promise<void> {
  try {
    const res = await fetch('samples/rules.json');
    if (!res.ok) throw new Error(String(res.status));
    applyRulesText(await res.text());
  } catch {
    store.ioErrors = [
      ...store.ioErrors.filter((e) => e.scope !== 'rules'),
      {
        code: 'RULES_JSON_INVALID' as const,
        message: '内置示例规则加载失败，请改用粘贴或本地文件',
        scope: 'rules' as const
      }
    ];
  }
}
</script>

<template>
  <section class="panel">
    <h2>② 脱敏规则 <span class="hint">本地 JSON，字段含名称 / 正则 / 优先级 / 模板 / 必检 / 人工复核</span></h2>
    <textarea
      class="rules-input mono"
      :value="store.rulesText"
      placeholder='{"rules":[{"id":"R1","name":"手机号","pattern":"\\b1[3-9]\\d{9}\\b","priority":90,"template":"[手机号]","mustCheck":true}]}'
      rows="8"
      spellcheck="false"
      @input="applyRulesText(($event.target as HTMLTextAreaElement).value)"
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
      <button type="button" @click="fileInput?.click()">选择本地 JSON…</button>
      <button type="button" class="ghost" @click="loadSample">载入示例规则</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFileChange" />
    </div>

    <ul v-if="store.rules.length > 0" class="rule-list">
      <li v-for="rule in store.rules" :key="rule.id" :class="{ disabled: store.disabledRuleIds.has(rule.id) }">
        <label class="rule-toggle">
          <input
            type="checkbox"
            :checked="!store.disabledRuleIds.has(rule.id)"
            @change="toggleRule(rule.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="rule-id">{{ rule.id }}</span>
          <span class="rule-name">{{ rule.name }}</span>
        </label>
        <span class="rule-meta">
          优先级 {{ rule.priority }}
          <em v-if="rule.mustCheck" class="badge must">导出前必检</em>
          <em v-if="rule.reviewRequired" class="badge review">人工复核</em>
          <em v-if="store.disabledRuleIds.has(rule.id)" class="badge off">已停用</em>
        </span>
        <code class="rule-pattern">/{{ rule.pattern }}/{{ rule.flags }}</code>
      </li>
    </ul>
    <p v-if="store.rules.length > 0" class="meta">
      启停任意规则后立即重新计算；停用必检规则通常会导致复核失败并锁定导出。
    </p>
  </section>
</template>
