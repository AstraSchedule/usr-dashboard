<template>
  <div class="icp-filing" :style="{ '--icp-filing-color': themeVars.textColor3, '--icp-filing-hover-color': themeVars.textColor1 }">
    <a class="icp-filing-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026069409号-1</a>
  </div>
</template>

<script setup>
import { useThemeVars } from 'naive-ui'

const themeVars = useThemeVars()
</script>

<style scoped>
.icp-filing {
  padding: 8px 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
}

.icp-filing-link {
  color: var(--icp-filing-color, #7a7a7a);
  text-decoration: none;
  transition: color 0.2s;
}

.icp-filing-link:hover {
  color: var(--icp-filing-hover-color, #333);
  text-decoration: underline;
}
</style>
