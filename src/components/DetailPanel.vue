<script setup lang="ts">
import { computed } from 'vue';
import { store } from '../store';

const selected = computed(() => {
  const run = store.run;
  if (!run || store.selectedInterval < 0) return null;
  return run.accepted[store.selectedInterval] ?? null;
});

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
