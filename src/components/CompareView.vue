<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { selectInterval, store } from '../store';
import type { Segment } from '../engine/types';

interface SourcePiece {
  kind: 'plain' | 'masked';
  text: string;
  intervalIndex: number;
}

/** 依据胜出区间把原文切成「普通片段 / 命中片段」，供左侧高亮展示。 */
const sourcePieces = computed<SourcePiece[]>(() => {
  const run = store.run;
  if (!run) return [];
  const pieces: SourcePiece[] = [];
  let cursor = 0;
  run.accepted.forEach((interval, index) => {
    if (interval.start > cursor) {
      pieces.push({ kind: 'plain', text: run.source.slice(cursor, interval.start), intervalIndex: -1 });
    }
    pieces.push({ kind: 'masked', text: run.source.slice(interval.start, interval.end), intervalIndex: index });
    cursor = interval.end;
  });
  if (cursor < run.source.length) {
    pieces.push({ kind: 'plain', text: run.source.slice(cursor), intervalIndex: -1 });
  }
  return pieces;
});

const outputSegments = computed<Segment[]>(() => store.run?.segments ?? []);

function onSelect(index: number): void {
  selectInterval(index);
}

const leftPane = ref<HTMLElement | null>(null);
const rightPane = ref<HTMLElement | null>(null);

watch(
  () => store.selectedInterval,
  async (index) => {
    if (index < 0) return;
    await nextTick();
    for (const pane of [leftPane.value, rightPane.value]) {
      pane?.querySelector('.selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
);
</script>

<template>
  <section v-if="store.run" class="panel compare">
    <h2>
      ③ 原文 ↔ 脱敏结果
      <span class="hint">点击任意遮蔽块查看来源规则、原始范围与裁决原因</span>
    </h2>
    <div class="panes">
      <div ref="leftPane" class="pane" data-testid="source-pane">
        <h3>原文（命中区间高亮）</h3>
        <div class="text-view">
          <template v-for="(piece, i) in sourcePieces" :key="i">
            <button
              v-if="piece.kind === 'masked'"
              type="button"
              class="hit"
              :class="{ selected: piece.intervalIndex === store.selectedInterval }"
              :data-interval="piece.intervalIndex"
              @click="onSelect(piece.intervalIndex)"
            >{{ piece.text }}</button>
            <span v-else>{{ piece.text }}</span>
          </template>
        </div>
      </div>
      <div ref="rightPane" class="pane" data-testid="output-pane">
        <h3>脱敏结果（遮蔽块可点击）</h3>
        <div class="text-view">
          <template v-for="(seg, i) in outputSegments" :key="i">
            <button
              v-if="seg.kind === 'masked'"
              type="button"
              class="mask"
              :class="{ selected: seg.intervalIndex === store.selectedInterval }"
              :data-interval="seg.intervalIndex"
              @click="onSelect(seg.intervalIndex)"
            >{{ seg.text }}</button>
            <span v-else>{{ seg.text }}</span>
          </template>
        </div>
      </div>
    </div>
    <p class="meta">
      共 {{ store.run.accepted.length }} 处遮蔽；{{ store.run.rejected.length }} 个候选在裁决中被否决。
      两侧展示的均为纯文本，不含任何脚本或外部资源。
    </p>
  </section>
</template>
