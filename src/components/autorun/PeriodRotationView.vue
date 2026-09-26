<script setup>
// 逐节轮换视图：每天的每一节各自是一条「周期内第 N 周 -> 科目」的序列。
// 组件不直接修改 modelValue，统一通过 update:modelValue 回传新数组（与 ActionEditor 一致）。
import { computed, ref, toRaw } from 'vue'
import { NButton, NCard, NSelect, NSpace, NTag, NText } from 'naive-ui'
import { WEEKDAY_LABELS, dayCycleWeeks } from '@/utils/rotation.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  subjectOptions: { type: Array, default: () => [] },
  // { 星期下标: [课程序号(0 起)] }，语义与 desktop 的 divider 一致：在该序号之后画分隔线
  dividerByWeekday: { type: Object, default: () => ({}) },
  // { 星期下标: 作息表名 }，仅用于展示
  timetableByWeekday: { type: Object, default: () => ({}) },
  // 「添加一天」时的节次数量，由生效域作息表决定
  maxPeriods: { type: Number, default: 12 },
  loading: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'import'])

const list = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []))

// 横条当前预览第几周；周期变短时在读取处钳制回合法范围
const previewWeeks = ref({})

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

// Vue 的响应式代理不能直接 structuredClone（会抛 DataCloneError），先 toRaw 取原始对象
function mutate(fn) {
  const next = structuredClone(toRaw(list.value))
  fn(next)
  emit('update:modelValue', next)
}

function cycleOf(day) {
  return dayCycleWeeks(day?.periods)
}

function previewWeek(day) {
  const picked = Number(previewWeeks.value[day.weekday]) || 1
  return Math.min(Math.max(picked, 1), cycleOf(day))
}

function setPreviewWeek(day, week) {
  previewWeeks.value = {...previewWeeks.value, [day.weekday]: week}
}

function subjectAt(period, week) {
  const weeks = Array.isArray(period?.weeks) ? period.weeks : []
  if (weeks.length === 0) return ''
  return String(weeks[(week - 1) % weeks.length] ?? '')
}

function dividersOf(weekday) {
  const arr = props.dividerByWeekday?.[weekday]
  return Array.isArray(arr) ? arr.map(Number) : []
}

function addWeek(dayIdx, periodIdx) {
  mutate(next => next[dayIdx].periods[periodIdx].weeks.push(''))
}

function setWeek(dayIdx, periodIdx, weekIdx, value) {
  mutate(next => { next[dayIdx].periods[periodIdx].weeks[weekIdx] = String(value ?? '') })
}

function removeWeek(dayIdx, periodIdx, weekIdx) {
  mutate(next => next[dayIdx].periods[periodIdx].weeks.splice(weekIdx, 1))
}

function addPeriod(dayIdx) {
  mutate(next => {
    const periods = next[dayIdx].periods
    const maxNo = periods.reduce((max, p) => Math.max(max, Number(p.no) || 0), 0)
    periods.push({ no: maxNo + 1, weeks: [] })
  })
}

function removePeriod(dayIdx, periodIdx) {
  mutate(next => next[dayIdx].periods.splice(periodIdx, 1))
}

function addDay() {
  const used = new Set(list.value.map(day => Number(day.weekday)))
  const weekday = WEEKDAY_ORDER.find(d => !used.has(d))
  if (weekday === undefined) return
  const count = Math.max(1, Math.floor(Number(props.maxPeriods) || 1))
  mutate(next => {
    next.push({ weekday, periods: Array.from({length: count}, (_, i) => ({ no: i + 1, weeks: [] })) })
    next.sort((a, b) => WEEKDAY_ORDER.indexOf(Number(a.weekday)) - WEEKDAY_ORDER.indexOf(Number(b.weekday)))
  })
}

function removeDay(dayIdx) {
  mutate(next => next.splice(dayIdx, 1))
}
</script>

<template>
  <n-space vertical style="width:100%">
    <n-space align="center" justify="space-between" style="width:100%">
      <n-text depth="3" style="font-size:12px;">
        每节可独立设置轮换周数，保存时按每天的最小公倍数展开为「每周轮换」条目
      </n-text>
      <n-space align="center">
        <n-button size="small" :loading="loading" @click="emit('import')">从班级课表导入</n-button>
        <n-button size="small" tertiary :disabled="list.length >= 7" @click="addDay">添加一天</n-button>
      </n-space>
    </n-space>

    <n-text v-if="list.length === 0" depth="3" style="font-size:12px;">
      暂无轮换配置：可「从班级课表导入」旧版多周轮换课表，或手动「添加一天」
    </n-text>

    <n-card v-for="(day, dayIdx) in list" :key="day.weekday" size="small" :bordered="true" style="width:100%">
      <template #header>
        <n-space align="center">
          <n-tag size="small" :bordered="false">{{ WEEKDAY_LABELS[day.weekday] }}</n-tag>
          <n-text depth="3" style="font-size:12px;">
            周期 {{ cycleOf(day) }} 周<span v-if="timetableByWeekday[day.weekday]"> · 作息表「{{ timetableByWeekday[day.weekday] }}」</span>
          </n-text>
        </n-space>
      </template>
      <template #header-extra>
        <n-button size="small" tertiary type="error" @click="removeDay(dayIdx)">移除当天</n-button>
      </template>

      <n-space vertical style="width:100%">
        <n-space align="center">
          <n-text depth="3" style="font-size:12px;">课表预览</n-text>
          <n-button v-for="week in cycleOf(day)" :key="week" size="tiny"
                    :type="previewWeek(day) === week ? 'primary' : 'default'"
                    @click="setPreviewWeek(day, week)">第 {{ week }} 周</n-button>
        </n-space>

        <div class="pr-bar">
          <template v-for="(period, periodIdx) in day.periods" :key="period.no">
            <div class="pr-cell">
              <span class="pr-index">{{ period.no }}</span>
              <span class="pr-subject">{{ subjectAt(period, previewWeek(day)) || '—' }}</span>
            </div>
            <div v-if="dividersOf(day.weekday).includes(periodIdx)" class="pr-divider"></div>
          </template>
        </div>

        <div v-for="(period, periodIdx) in day.periods" :key="period.no" class="pr-row">
          <div class="pr-row-label">第 {{ period.no }} 节</div>
          <div class="pr-row-slots">
            <div v-for="(week, weekIdx) in period.weeks" :key="weekIdx" class="pr-slot">
              <span class="pr-slot-label">第 {{ weekIdx + 1 }} 周</span>
              <n-select :value="week" :options="subjectOptions" size="small" placeholder="选科目" style="width:110px"
                        @update:value="v => setWeek(dayIdx, periodIdx, weekIdx, v)" />
              <n-button size="tiny" tertiary type="error" @click="removeWeek(dayIdx, periodIdx, weekIdx)">删除</n-button>
            </div>
            <n-button size="tiny" tertiary @click="addWeek(dayIdx, periodIdx)">＋周</n-button>
          </div>
          <n-button size="tiny" tertiary type="error" @click="removePeriod(dayIdx, periodIdx)">删除该节</n-button>
        </div>

        <n-button size="small" tertiary @click="addPeriod(dayIdx)">添加一节</n-button>
      </n-space>
    </n-card>
  </n-space>
</template>

<style scoped>
.pr-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--n-border-color, #e0e0e6);
  border-radius: 6px;
}

.pr-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 34px;
  padding: 2px 6px;
  background: rgba(128, 128, 128, 0.12);
  border-radius: 4px;
}

.pr-index {
  font-size: 11px;
  line-height: 1;
  opacity: 0.6;
}

.pr-subject {
  font-size: 18px;
  line-height: 1.2;
}

.pr-divider {
  width: 2px;
  height: 28px;
  background: var(--n-border-color, #c8c8cc);
  border-radius: 1px;
}

.pr-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
}

.pr-row-label {
  width: 70px;
  padding-top: 6px;
  text-align: right;
}

.pr-row-slots {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
}

.pr-slot {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pr-slot-label {
  font-size: 11px;
  color: #888;
}
</style>
