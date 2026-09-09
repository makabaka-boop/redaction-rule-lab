<script setup lang="ts">
import { computed } from 'vue';
import {
  confirmAllPending,
  confirmInterval,
  dismissReviewRevocations,
  locateRevocation,
  store
} from '../store';
import type { ChecklistEntry } from '../engine/types';

const selected = computed(() => {
  const run = store.run;
  if (!run || store.selectedInterval < 0) return null;
  return run.accepted[store.selectedInterval] ?? null;
});

/** 与当前选中遮蔽块对应的清单条目（携带复核状态）。 */
const selectedEntry = computed<ChecklistEntry | null>(() => {
  const run = store.run;
  if (!run || store.selectedInterval < 0) return null;
  return run.checklist.find((entry) => entry.index === store.selectedInterval) ?? null;
});

const pendingCount = computed(() => store.run?.reviewPendingCount ?? 0);
const confirmedCount = computed(() => store.run?.reviewConfirmedCount ?? 0);
const requiredCount = computed(() => store.run?.reviewRequiredCount ?? 0);

function confirmCurrent(): void {
  confirmInterval(store.selectedInterval);
}

/** 与当前选中区间重叠、但在裁决中落败的候选。 */
const defeatedHere = computed(() => {
  const run = store.run;
  const sel = selected.value;
  if (!run || !sel) return [];
  return run.rejected.filter(
    (rej) => rej.start < sel.end && sel.start < rej.end
  );
});

/** 与当前选中区间重叠、且已被其它区间接受的候选（用于说明裁决边界）。 */
const neighbours = computed(() => {
  const run = store.run;
  const sel = selected.value;
  if (!run || !sel) return [];
  return run.accepted.filter(
    (acc) => acc !== sel && acc.start < sel.end && sel.start < acc.end
  );
});
</script>

<template>
  <section v-if="store.run" class="panel detail" data-testid="detail-panel">
    <h2>④ 遮蔽块详情</h2>

    <div
      v-if="store.reviewRevocations.length > 0"
      class="review-revoke"
      role="alert"
      data-testid="review-revocation-banner"
    >
      <div class="review-revoke-head">
        <strong>以下人工确认因重算已被撤销（规则启停 / 原文或模板变化），请重新确认：</strong>
        <button type="button" class="ghost" data-testid="review-revocation-dismiss" @click="dismissReviewRevocations">
          知道了
        </button>
      </div>
      <ul>
        <li v-for="(rev, i) in store.reviewRevocations" :key="i">
          <button
            type="button"
            class="linklike"
            data-testid="review-revocation-item"
            @click="locateRevocation(rev)"
          >
            规则 {{ rev.ruleId }} · {{ rev.ruleName }}，原文区间 [{{ rev.start }}, {{ rev.end }})，
            原替换为 <code>{{ rev.replacement }}</code>——点击定位
          </button>
        </li>
      </ul>
    </div>

    <p v-if="requiredCount > 0" class="review-summary" data-testid="review-summary">
      高风险区间人工复核：已确认 {{ confirmedCount }} / {{ requiredCount }}，
      <template v-if="pendingCount > 0">
        <strong class="pending-text">待确认 {{ pendingCount }}</strong>
        <button type="button" data-testid="confirm-all" @click="confirmAllPending">
          按原文顺序确认全部待办
        </button>
      </template>
      <template v-else><strong class="confirmed-text">全部已确认，可以导出</strong></template>
    </p>

    <div v-if="!selected" class="empty-hint small">
      <p>在上方点击任一遮蔽块，查看其来源规则、原始范围与裁决原因。</p>
    </div>
    <div v-else class="detail-grid">
      <dl>
        <dt>来源规则</dt>
        <dd>{{ selected.ruleId }} · {{ selected.ruleName }}（优先级 {{ selected.priority }}）</dd>
        <dt>原始范围</dt>
        <dd>第 {{ selected.start }} – {{ selected.end }} 字符（[start, end)，长度 {{ selected.end - selected.start }}）</dd>
        <dt>原始内容</dt>
        <dd><code class="frag">{{ selected.matched }}</code></dd>
        <dt>替换内容</dt>
        <dd><code class="frag">{{ selected.replacement }}</code></dd>
        <dt>裁决原因</dt>
        <dd data-testid="arbitration-reason">{{ selected.reason }}</dd>
      </dl>

      <div v-if="selectedEntry?.reviewRequired" class="review-box" data-testid="review-box">
        <p class="review-state">
          人工确认状态：
          <em v-if="selectedEntry.reviewStatus === 'pending'" class="badge pending" data-testid="review-pending-badge">
            待确认
          </em>
          <em v-else class="badge confirmed" data-testid="review-confirmed-badge">已确认</em>
        </p>
        <button
          v-if="selectedEntry.reviewStatus === 'pending'"
          type="button"
          data-testid="confirm-current"
          @click="confirmCurrent"
        >
          确认遮蔽结果符合约定
        </button>
        <p class="meta">
          该规则要求人工确认：请核对上方原文范围、替换内容与裁决依据后再确认。
        </p>
      </div>

      <div v-if="defeatedHere.length > 0" class="defeated">
        <h3>同区间被否决的候选（{{ defeatedHere.length }}）</h3>
        <ul>
          <li v-for="(rej, i) in defeatedHere" :key="i">
            <code>[{{ rej.start }}, {{ rej.end }})</code>
            规则 {{ rej.ruleId }} · {{ rej.ruleName }} —— {{ rej.reason }}
          </li>
        </ul>
      </div>
      <p v-else-if="neighbours.length === 0" class="meta">该区间无重叠竞争者，直接保留。</p>
    </div>
  </section>
</template>
