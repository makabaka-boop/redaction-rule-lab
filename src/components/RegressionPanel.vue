<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  applySamplesText,
  dismissRegressionErrors,
  isRegressionStale,
  runRegressionNow,
  selectRegressionItem,
  store
} from '../store';
import type { EngineError } from '../engine/types';
import type { RegressionItemResult, SequenceOp } from '../engine/regression';

const inputEl = ref<HTMLInputElement | null>(null);

/** 样例文件固定按 UTF-8 解码（与规则/原文不同，样例集是受控 JSON）；失败定位到文件。 */
async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    // fatal 模式：坏字节不静默替换，避免把损坏的样例当作有效输入。
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    applySamplesText(text, file.name);
  } catch {
    store.regErrors = [
      {
        code: 'DECODE_FAILED',
        file: file.name,
        message: `回归样例文件 ${file.name}：不是合法的 UTF-8 文本，请确认文件编码后重新选择`
      }
    ];
  }
  input.value = '';
}

function pickFile(): void {
  inputEl.value?.click();
}

const stale = computed(() => isRegressionStale());

const hasSamples = computed(() => store.regSamples.length > 0);
const report = computed(() => store.regReport);

/** 失败项优先排在详情列表前，但结果数组本身严格保持文件顺序（列表渲染按顺序）。 */
function statusLabel(item: RegressionItemResult): string {
  switch (item.status) {
    case 'pass':
      return '通过';
    case 'text-mismatch':
      return '文本不符';
    case 'sequence-mismatch':
      return '规则序列不符';
    case 'pipeline-error':
      return '管线失败';
  }
}

function describeError(error: EngineError): string {
  // 样例文件错误的 message 本身已带「回归样例编号 / 第 N 项 / 数组下标」，
  // 其 ruleId 字段复用为样例编号，不能再按“规则 x”前缀展示。
  if (error.code === 'SAMPLE_FIELD_INVALID' || error.code === 'SAMPLES_JSON_INVALID') {
    return '';
  }
  const parts: string[] = [];
  if (error.ruleId !== undefined) parts.push(`规则 ${error.ruleId}`);
  if (error.position !== undefined) {
    parts.push(`位置 ${error.position}`);
  }
  return parts.length > 0 ? `${parts.join('，')}：` : '';
}

/** 序列对齐结果中实际/期望两侧的编号，用连接线直观展示差异。 */
function sequenceLines(item: RegressionItemResult): SequenceOp[] {
  return item.sequenceDiff?.ops ?? [];
}
</script>

<template>
  <section class="panel regression" data-testid="regression-panel">
    <h2>
      回归样例集（本地验收）
      <span class="hint">本地 JSON · 仅驻留浏览器内存 · 不参与正式导出</span>
    </h2>
    <div class="row">
      <button type="button" data-testid="regression-pick" @click="pickFile">选择样例 JSON…</button>
      <button
        type="button"
        class="ghost"
        data-testid="regression-rerun"
        :disabled="!hasSamples"
        @click="runRegressionNow()"
      >
        按当前规则重跑
      </button>
      <input ref="inputEl" type="file" accept=".json,application/json" hidden @change="onFileChange" />
    </div>
    <p v-if="store.regFileName" class="meta">当前样例集：{{ store.regFileName }}（{{ store.regSamples.length }} 项，选择后自动运行）</p>
    <p v-else class="meta">选择文件后自动按当前有效规则与完整管线运行；样例不写入磁盘、不进入导出。</p>

    <!-- 文件语法 / 字段错误：定位到样例编号或数组下标，并保留上一份有效报告。 -->
    <div v-if="store.regErrors.length > 0" class="error-box rule" role="alert" data-testid="regression-errors">
      <div class="reg-error-head">
        <strong>样例文件有误，已保留上一份有效报告</strong>
        <button type="button" class="ghost" data-testid="regression-errors-dismiss" @click="dismissRegressionErrors">
          知道了
        </button>
      </div>
      <ul>
        <li v-for="(error, i) in store.regErrors" :key="i">
          <span class="loc">{{ describeError(error) }}</span>{{ error.message }}
        </li>
      </ul>
    </div>

    <template v-if="report">
      <p
        class="reg-summary"
        :class="{ done: report.allPassed && !stale }"
        data-testid="regression-summary"
      >
        <strong data-testid="regression-pass-count">{{ report.passCount }}</strong>
        / {{ report.totalCount }} 项通过
        <span v-if="report.failCount > 0" class="reg-fail">（{{ report.failCount }} 项失败）</span>
        <span v-if="stale" class="reg-stale" data-testid="regression-stale">
          · 规则已变化，结果待重跑（重算后自动刷新）
        </span>
        <span v-else-if="report.allPassed" class="reg-ok"> · 全部通过</span>
      </p>

      <ul class="reg-list" data-testid="regression-list">
        <li
          v-for="item in report.results"
          :key="item.sampleId"
          class="reg-item"
          :class="item.status"
          data-testid="regression-item"
          :data-status="item.status"
        >
          <button
            type="button"
            class="reg-item-head"
            :disabled="item.status === 'pass'"
            data-testid="regression-item-head"
            @click="selectRegressionItem(item.index)"
          >
            <span class="reg-status-badge" :class="item.status">{{ statusLabel(item) }}</span>
            <span class="reg-item-id">{{ item.sampleId }}</span>
            <span v-if="item.status !== 'pass'" class="reg-item-hint">点击查看首个差异</span>
          </button>

          <div
            v-if="store.regSelectedIndex === item.index && item.status !== 'pass'"
            class="reg-detail"
            data-testid="regression-detail"
          >
            <!-- 管线失败：显示原有错误位置，不覆盖其它项。 -->
            <template v-if="item.status === 'pipeline-error'">
              <p class="reg-detail-title">该项管线未通过，沿用引擎原有错误：</p>
              <ul class="reg-errors">
                <li v-for="(error, i) in item.errors" :key="i" data-testid="regression-pipeline-error">
                  <span class="loc">{{ describeError(error) }}</span>{{ error.message }}
                </li>
              </ul>
            </template>

            <template v-else>
              <!-- 首个文本差异位置与实际/期望片段。 -->
              <div v-if="item.textDiff" class="reg-diff" data-testid="regression-text-diff">
                <p class="reg-detail-title">
                  首个文本差异位置：第
                  <strong data-testid="regression-diff-index">{{ item.textDiff.index }}</strong>
                  个字符
                </p>
                <dl>
                  <dt>实际片段</dt>
                  <dd><code class="frag" data-testid="regression-actual-snippet">{{ item.textDiff.actualSnippet }}</code></dd>
                  <dt>期望片段</dt>
                  <dd><code class="frag" data-testid="regression-expected-snippet">{{ item.textDiff.expectedSnippet }}</code></dd>
                </dl>
              </div>
              <p v-else class="reg-detail-ok">脱敏文本与期望逐字一致。</p>

              <!-- 规则编号序列差异。 -->
              <div v-if="item.sequenceDiff && !item.sequenceDiff.matched" class="reg-seq" data-testid="regression-sequence-diff">
                <p class="reg-detail-title">
                  期望命中规则编号序列不符
                  <template v-if="item.sequenceDiff.firstMismatchIndex !== null">
                    （首个差异在对齐后第 {{ item.sequenceDiff.firstMismatchIndex + 1 }} 行）
                  </template>
                </p>
                <ul class="reg-seq-lines">
                  <li
                    v-for="(op, i) in sequenceLines(item)"
                    :key="i"
                    class="seq-line"
                    :class="op.kind"
                    data-testid="regression-seq-op"
                  >
                    <template v-if="op.kind === 'same'">
                      <span class="seq-tag seq-same">一致</span>
                      <code>{{ op.ruleId }}</code>
                    </template>
                    <template v-else-if="op.kind === 'actual-only'">
                      <span class="seq-tag seq-actual">仅实际</span>
                      <code>{{ op.ruleId }}</code>
                      <span class="seq-side">实际第 {{ op.actualIndex + 1 }} 个命中，期望中缺失</span>
                    </template>
                    <template v-else>
                      <span class="seq-tag seq-expected">仅期望</span>
                      <code>{{ op.ruleId }}</code>
                      <span class="seq-side">期望第 {{ op.expectedIndex + 1 }} 个命中，实际中缺失</span>
                    </template>
                  </li>
                </ul>
              </div>
            </template>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
