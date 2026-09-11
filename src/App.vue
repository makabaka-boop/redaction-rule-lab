<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { store, initStoreWatchers, applyRulesText, setSourceText } from './store';
import SourcePanel from './components/SourcePanel.vue';
import RulesPanel from './components/RulesPanel.vue';
import RegressionPanel from './components/RegressionPanel.vue';
import CompareView from './components/CompareView.vue';
import DetailPanel from './components/DetailPanel.vue';
import ExportPanel from './components/ExportPanel.vue';
import ErrorList from './components/ErrorList.vue';

initStoreWatchers();

const hasInput = computed(() => store.sourceText.length > 0 && store.rules.length > 0);
const resultStale = computed(() => store.runErrors.length > 0 && store.run !== null);

onMounted(async () => {
  // 仅加载同源静态示例文件，不访问任何外部服务。
  try {
    const [rulesRes, textRes] = await Promise.all([
      fetch('samples/rules.json'),
      fetch('samples/contract.txt')
    ]);
    if (rulesRes.ok) applyRulesText(await rulesRes.text());
    if (textRes.ok) setSourceText(await textRes.text());
  } catch {
    // 示例缺失不视为错误：用户仍可粘贴文本或选择本地文件。
  }
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>合同附件脱敏实验台</h1>
      <p class="tagline">纯前端运行 · 不创建后端 · 不发起任何网络外发 · 匹配只发生在原文上</p>
    </header>

    <main class="app-main">
      <aside class="side">
        <SourcePanel />
        <RulesPanel />
        <RegressionPanel />
      </aside>

      <section class="workspace">
        <ErrorList
          v-if="store.ioErrors.length > 0"
          title="文件读取失败"
          :errors="store.ioErrors"
          tone="io"
        />
        <ErrorList
          v-if="store.ruleErrors.length > 0"
          title="规则解析失败（沿用上一份有效规则）"
          :errors="store.ruleErrors"
          tone="rule"
        />
        <ErrorList
          v-if="store.runErrors.length > 0"
          title="本次计算失败，已保留上一份有效结果，导出已锁定"
          :errors="store.runErrors"
          tone="run"
        />

        <div v-if="!hasInput" class="empty-hint">
          <p>请在左侧粘贴合同文本并载入规则 JSON，或直接使用内置示例。</p>
        </div>

        <template v-else-if="store.run">
          <p v-if="resultStale" class="stale-banner">
            下方展示的是上一份通过全部校验的结果；当前输入存在问题，修复后将自动重新计算。
          </p>
          <CompareView />
          <DetailPanel />
          <ExportPanel />
        </template>
        <div v-else class="empty-hint">
          <p>暂无可展示的有效结果。</p>
        </div>
      </section>
    </main>

    <footer class="app-footer">
      纯前端实验台：所有计算均在浏览器内完成，不创建业务后端、不连接在线服务、不写入任何远程存储。
    </footer>
  </div>
</template>
