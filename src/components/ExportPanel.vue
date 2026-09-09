<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store';
import { buildExport, downloadTextFile } from '../engine/exporter';

const exportError = ref('');

/** 导出前重新自检：清单与脱敏文本逐项对应，任何不一致都阻止导出。 */
const exportState = computed(() => {
  if (!store.run) return { ready: false as const, reason: '暂无有效结果' };
  if (store.runErrors.length > 0) {
    return { ready: false as const, reason: '当前输入未通过校验，已锁定导出' };
  }
  const bundle = buildExport(store.run);
  if (bundle.selfCheckErrors.length > 0) {
    return { ready: false as const, reason: `一致性自检失败：${bundle.selfCheckErrors[0]}` };
  }
  return { ready: true as const, bundle };
});

function exportRedacted(): void {
  const state = exportState.value;
  if (!state.ready) {
    exportError.value = state.reason;
    return;
  }
  exportError.value = '';
  downloadTextFile('redacted.txt', state.bundle.redactedText, 'text/plain');
}

function exportChecklist(): void {
  const state = exportState.value;
  if (!state.ready) {
    exportError.value = state.reason;
    return;
  }
  exportError.value = '';
  downloadTextFile('review-checklist.json', state.bundle.checklistJson, 'application/json');
}
</script>

<template>
  <section v-if="store.run" class="panel export" data-testid="export-panel">
    <h2>⑤ 审阅清单与导出</h2>

    <div class="export-actions">
      <button type="button" data-testid="export-redacted" :disabled="!exportState.ready" @click="exportRedacted">
        导出脱敏文本 redacted.txt
      </button>
      <button type="button" data-testid="export-checklist" :disabled="!exportState.ready" @click="exportChecklist">
        导出审阅清单 review-checklist.json
      </button>
      <span v-if="!exportState.ready" class="blocked" data-testid="export-blocked">
        导出已锁定：{{ exportState.reason }}
      </span>
      <span v-else class="ok-note">清单与脱敏文本逐项对应，自检通过</span>
    </div>
    <p v-if="exportError" class="error-line">{{ exportError }}</p>

    <table class="checklist" data-testid="checklist-table">
      <thead>
        <tr>
          <th>#</th>
          <th>规则</th>
          <th>优先级</th>
          <th>原文区间</th>
          <th>原文片段</th>
          <th>替换为</th>
          <th>输出区间</th>
          <th>必检</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entry in store.run.checklist"
          :key="entry.index"
          :class="{ selected: entry.index === store.selectedInterval }"
          @click="store.selectedInterval = entry.index"
        >
          <td>{{ entry.index + 1 }}</td>
          <td>{{ entry.ruleId }} · {{ entry.ruleName }}</td>
          <td>{{ entry.priority }}</td>
          <td>[{{ entry.sourceStart }}, {{ entry.sourceEnd }})</td>
          <td><code>{{ entry.sourceText }}</code></td>
          <td><code>{{ entry.replacement }}</code></td>
          <td>[{{ entry.outputStart }}, {{ entry.outputEnd }})</td>
          <td>{{ entry.mustCheck ? '是' : '否' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
