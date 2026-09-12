<script setup>
// 条目内容编辑器：按任务类型渲染对应的内容表单
import { computed } from 'vue'
import { NButton, NCard, NFormItem, NSelect, NSpace, NText } from 'naive-ui'
import { AutorunType, clientConfigSettingOptions } from '@/api/autorun.js'

const props = defineProps({
  type: { type: Number, required: true },
  modelValue: { type: Object, required: true },
  timetableOptions: { type: Array, default: () => [] },
  timetableLoading: { type: Boolean, default: false },
  timetableHint: { type: String, default: '' },
  subjectOptions: { type: Array, default: () => [] },
  autoFilling: { type: Boolean, default: false }
})
const emit = defineEmits(['auto-fill'])

const timetableSelectOptions = computed(() => props.timetableOptions.map(o => ({ label: o.label, value: o.value })))

const periods = computed(() => {
  const list = props.modelValue?.schedule?.periods
  return Array.isArray(list) ? list : []
})

function addPeriod() {
  if (!props.modelValue.schedule) props.modelValue.schedule = { periods: [] }
  const list = props.modelValue.schedule.periods
  list.push({ no: list.length + 1, subject: '' })
}

function removePeriod(index) {
  const list = props.modelValue.schedule?.periods
  if (!Array.isArray(list)) return
  list.splice(index, 1)
  list.forEach((p, idx) => { p.no = idx + 1 })
}

// 三态：'unset' 不覆盖（跟随客户端本地设置）/ 'on' 开启 / 'off' 关闭
const settingStateOptions = [
  { label: '不变', value: 'unset' },
  { label: '开启', value: 'on' },
  { label: '关闭', value: 'off' }
]

function settingState(key) {
  const value = props.modelValue.settings?.[key]
  if (value === true) return 'on'
  if (value === false) return 'off'
  return 'unset'
}

function onSettingChange(key, state) {
  if (!props.modelValue.settings) props.modelValue.settings = {}
  if (state === 'unset') delete props.modelValue.settings[key]
  else props.modelValue.settings[key] = state === 'on'
}
</script>

<template>
  <n-space vertical style="width:100%">
    <template v-if="type === AutorunType.COMPENSATION">
      <n-form-item label="借用哪一天的课 (useDate)" :show-feedback="false">
        <n-date-picker v-model:formatted-value="modelValue.useDate" type="date" value-format="yyyy-MM-dd" clearable />
      </n-form-item>
    </template>

    <template v-else-if="type === AutorunType.TIMETABLE">
      <n-form-item label="作息表" :show-feedback="false">
        <n-select v-model:value="modelValue.timetableId" :loading="timetableLoading" :options="timetableOptions" placeholder="先选择包含年级/班级的生效域后再选择作息表" />
      </n-form-item>
      <div v-if="timetableHint" style="font-size:12px;color:#888;">{{ timetableHint }}</div>
    </template>

    <template v-else-if="type === AutorunType.CLIENT_CONFIG">
      <n-space vertical>
        <n-space v-for="opt in clientConfigSettingOptions" :key="opt.key" align="center">
          <span style="width:90px;text-align:right;">{{ opt.label }}</span>
          <n-select :value="settingState(opt.key)" :options="settingStateOptions" style="width:120px"
                    @update:value="v => onSettingChange(opt.key, v)" />
        </n-space>
      </n-space>
      <n-text depth="3" style="font-size:12px;">
        仅覆盖这里列出的开关；没有规则生效时，客户端恢复用户本地的设置。
      </n-text>
    </template>

    <template v-else>
      <n-form-item v-if="type === AutorunType.ALL" label="作息表" :show-feedback="false">
        <n-select v-model:value="modelValue.timetableId" :options="timetableSelectOptions" placeholder="请选择作息表" />
      </n-form-item>
      <n-space vertical style="width:100%">
        <n-space align="center">
          <n-button size="small" :loading="autoFilling" @click="emit('auto-fill')">按当前课表自动填充</n-button>
          <n-text depth="3" style="font-size:12px;">共 {{ periods.length }} 节</n-text>
        </n-space>
        <n-card size="small" :bordered="true" style="width:100%">
          <n-space vertical style="width:100%">
            <n-text v-if="periods.length === 0" depth="3">暂无节次，请点击「自动填充」或下方按钮手动添加</n-text>
            <div v-for="(p, idx) in periods" :key="idx" style="display:flex; align-items:center; gap:12px; width:100%">
              <div style="width:60px; text-align:right;">第 {{ idx + 1 }} 节</div>
              <n-select v-model:value="p.subject" :options="subjectOptions" placeholder="选择科目" style="flex:1;" />
              <n-button size="small" tertiary type="error" @click="removePeriod(idx)">删除</n-button>
            </div>
            <n-button size="small" tertiary @click="addPeriod">添加一节</n-button>
          </n-space>
        </n-card>
      </n-space>
    </template>
  </n-space>
</template>

<style scoped>
/* 条目内容编辑器 */
</style>
