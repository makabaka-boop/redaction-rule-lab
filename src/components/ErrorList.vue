<script setup lang="ts">
import type { EngineError } from '../engine/types';

defineProps<{
  title: string;
  errors: EngineError[];
  tone: 'io' | 'rule' | 'run';
}>();

function describe(error: EngineError): string {
  const parts: string[] = [];
  if (error.ruleId !== undefined) {
    parts.push(`规则 ${error.ruleId}（第 ${(error.ruleIndex ?? 0) + 1} 条）`);
  }
  if (error.position !== undefined) {
    parts.push(`位置 ${error.position}`);
  }
  return parts.length > 0 ? `${parts.join('，')}：` : '';
}
</script>

<template>
  <div class="error-box" :class="tone" role="alert">
    <strong>{{ title }}</strong>
    <ul>
      <li v-for="(error, i) in errors" :key="i">
        <span class="loc">{{ describe(error) }}</span>{{ error.message }}
      </li>
    </ul>
  </div>
</template>
