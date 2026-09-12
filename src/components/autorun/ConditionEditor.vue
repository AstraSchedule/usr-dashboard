<script setup>
// 生效条件编辑器：单日 / 日期范围 / 每周轮换 / 时刻事件 / cron
import { computed } from 'vue'
import { NDatePicker, NInput, NInputNumber, NSelect, NSpace } from 'naive-ui'
import {
  AutorunType,
  ConditionKind,
  EventKind,
  conditionKindOptions,
  createCondition,
  eventKindOptions,
  weekdayOptions
} from '@/api/autorun.js'

const props = defineProps({
  modelValue: { type: Object, default: null },
  type: { type: Number, required: true }
})
const emit = defineEmits(['update:modelValue'])

// 时刻事件只对客户端配置有意义：服务端在课表解析里把它当作「当天生效」，容易误解
const kindOptions = computed(() => props.type === AutorunType.CLIENT_CONFIG
  ? conditionKindOptions
  : conditionKindOptions.filter(o => o.value !== ConditionKind.EVENT))

const when = computed(() => props.modelValue)
const kind = computed(() => when.value?.kind || ConditionKind.DATE)
const isEventKind = computed(() => kind.value === ConditionKind.EVENT)
const needsPeriod = computed(() => isEventKind.value && when.value?.event !== EventKind.STARTUP)

function onKindChange(next) {
  emit('update:modelValue', createCondition(next))
}

function onWeekdaysChange(list) {
  if (!when.value) return
  const arr = Array.isArray(list) ? [...list] : []
  if (arr.length === 0) {
    delete when.value.weekdays
  } else {
    when.value.weekdays = arr
  }
}
</script>

<template>
  <n-space vertical style="width:100%">
    <n-space align="center">
      <n-select :value="kind" :options="kindOptions" style="width:180px" @update:value="onKindChange" />
      <template v-if="kind === ConditionKind.DATE">
        <n-date-picker v-model:formatted-value="when.date" type="date" value-format="yyyy-MM-dd" clearable />
      </template>
      <template v-else-if="kind === ConditionKind.RANGE">
        <n-date-picker v-model:formatted-value="when.startDate" type="date" value-format="yyyy-MM-dd" placeholder="开始日期" clearable />
        <span>至</span>
        <n-date-picker v-model:formatted-value="when.endDate" type="date" value-format="yyyy-MM-dd" placeholder="结束日期" clearable />
      </template>
      <template v-else-if="kind === ConditionKind.WEEKLY">
        <span>每</span>
        <n-input-number v-model:value="when.everyWeeks" :min="1" :max="52" :show-button="false" style="width:80px" />
        <span>周的第</span>
        <n-input-number v-model:value="when.weekOffset" :min="0" :max="Math.max(0, (Number(when.everyWeeks) || 1) - 1)" :show-button="false" style="width:80px" />
        <span>周生效</span>
      </template>
      <template v-else-if="kind === ConditionKind.EVENT">
        <n-select v-model:value="when.event" :options="eventKindOptions" style="width:180px" />
        <template v-if="needsPeriod">
          <span>第</span>
          <n-input-number v-model:value="when.period" :min="1" :max="20" :show-button="false" style="width:80px" />
          <span>节</span>
        </template>
      </template>
      <template v-else-if="kind === ConditionKind.CRON">
        <n-input v-model:value="when.cron" placeholder="分 时 日 月 周，例如 0 8 * * 1" style="width:220px" />
        <span>持续</span>
        <n-input-number v-model:value="when.duration" :min="0" :max="1440" :show-button="false" style="width:100px" />
        <span>分钟（0 表示到下次命中）</span>
      </template>
    </n-space>

    <n-space v-if="kind === ConditionKind.WEEKLY || kind === ConditionKind.RANGE" align="center">
      <span style="font-size:12px;color:#888;">限定星期（留空为每天）</span>
      <n-select
          :value="Array.isArray(when.weekdays) ? when.weekdays : []"
          :options="weekdayOptions"
          multiple
          clearable
          style="min-width:260px"
          placeholder="不限"
          @update:value="onWeekdaysChange"
      />
    </n-space>

    <n-space v-if="kind === ConditionKind.WEEKLY" align="center">
      <span style="font-size:12px;color:#888;">周期范围（留空表示开学起 / 长期）</span>
      <n-date-picker v-model:formatted-value="when.startDate" type="date" value-format="yyyy-MM-dd" placeholder="起始（默认开学）" clearable />
      <span>至</span>
      <n-date-picker v-model:formatted-value="when.endDate" type="date" value-format="yyyy-MM-dd" placeholder="结束（默认长期）" clearable />
    </n-space>
  </n-space>
</template>

<style scoped>
/* 生效条件编辑器 */
</style>
