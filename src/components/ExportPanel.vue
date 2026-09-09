<script setup lang="ts">
import { computed, ref } from 'vue';
import { exportBlockReason, store } from '../store';
import { buildExport, downloadTextFile } from '../engine/exporter';

const exportError = ref('');

/** 仅当结果中存在复核规则命中时才显示「人工复核」列，旧用法表格外观不变。 */
const hasReviewEntries = computed(() => (store.run?.reviewRequiredCount ?? 0) > 0);

/**
 * 导出前重新自检：清单与脱敏文本逐项对应，任何不一致都阻止导出。
 * 闸门同时覆盖规则解析错误与文件读取/解码错误：
 * 旧结果可以展示，但与当前输入不一致时不得外发。
 */
const exportState = computed(() => {
  const blocked = exportBlockReason();
  const run = store.run;
  if (blocked !== null || run === null) {
    return { ready: false as const, reason: blocked ?? '暂无有效结果' };
  }
  const bundle = buildExport(run);
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
    <p
      v-if="store.run.reviewRequiredCount > 0"
      class="review-progress"
      :class="{ done: store.run.reviewPendingCount === 0 }"
      data-testid="review-progress"
    >
      <template v-if="store.run.reviewPendingCount > 0">
        高风险遮蔽块尚有
        <strong data-testid="review-pending-count">{{ store.run.reviewPendingCount }}</strong>
        项待人工确认（已确认 {{ store.run.reviewConfirmedCount }} / {{ store.run.reviewRequiredCount }}），
        请在「遮蔽块详情」中逐项确认或按原文顺序确认全部；确认完成前两个导出入口保持锁定。
      </template>
      <template v-else>
        全部 {{ store.run.reviewRequiredCount }} 项高风险遮蔽块均已人工确认，导出入口已开放。
      </template>
    </p>
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
          <th v-if="hasReviewEntries">人工复核</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entry in store.run.checklist"
          :key="entry.index"
          :class="{ selected: entry.index === store.selectedInterval, pending: entry.reviewRequired && entry.reviewStatus === 'pending' }"
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
          <td v-if="hasReviewEntries">
            <em
              v-if="entry.reviewRequired"
              class="badge"
              :class="entry.reviewStatus === 'pending' ? 'pending' : 'confirmed'"
              data-testid="review-cell"
            >{{ entry.reviewStatus === 'pending' ? '待确认' : '已确认' }}</em>
            <span v-else class="meta">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
