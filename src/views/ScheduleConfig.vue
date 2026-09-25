<script setup>
import {
  NButton,
  NCard,
  NCode,
  NFlex,
  NInput,
  NSelect,
  NStatistic,
  useMessage
} from "naive-ui";
import ConfirmPasswordModal from '@/components/ConfirmPasswordModal.vue';
import { verifyPassword, confirmAction } from '@/api/auth.js'
import {computed, h, reactive, ref} from "vue";
import axios from "axios";
import {APISRV} from "@/global.js";
import {useRequest} from "vue-request";
import {useRoute} from "vue-router";

const route = useRoute();
const weekDays = ['一', '二', '三', '四', '五', '六', '日']
const school = computed(() => route.params.school);
const grade = computed(() => route.params.grade);
const cls = computed(() => route.params.cls);
const optionsLst = ref([])
const subjectsOptionsLst = ref([])
const needs = ref({})

const dynamicForm = reactive({
  daily_class: [
    {Chinese:"一",English:"MON",classList:[[]],timetable:"常日"},
    {Chinese:"二",English:"TUE",classList:[[]],timetable:"常日"},
    {Chinese:"三",English:"WED",classList:[[]],timetable:"常日"},
    {Chinese:"四",English:"THR",classList:[[]],timetable:"常日"},
    {Chinese:"五",English:"FRI",classList:[[]],timetable:"常日"},
    {Chinese:"六",English:"SAT",classList:[[]],timetable:"常日"},
    {Chinese:"日",English:"SUN",classList:[[]],timetable:"常日"}
  ]
});

const showModal = ref(false);
const saving = ref(false);
const dataLoaded = ref(false);
const messages = useMessage();

function submit() {
  showModal.value = true;
}

async function onPwdConfirm(password) {
  saving.value = true
  try {
    // 提交时转回 API 顺序 [日,一,二,三,四,五,六]
    const [mon, tue, wed, thu, fri, sat, sun] = dynamicForm.daily_class
    const apiOrder = [sun, mon, tue, wed, thu, fri, sat]
    // classList 已经是嵌套数组格式 [["物"], ["数"]]，直接提交
    const payload = {
      daily_class: apiOrder.map(day => ({
        Chinese: day.Chinese,
        English: day.English,
        timetable: day.timetable,
        classList: (day.classList || []).map(slot => Array.isArray(slot) ? slot : [slot])
      }))
    }
    await confirmAction(password, (cfg) =>
      axios.put(`${APISRV}/web/config/${school.value}/${grade.value}/${cls.value}/schedule`, payload, cfg)
    )
    messages.success("服务端说行")
    showModal.value = false
  } catch (error) {
    if (error.status === 401) messages.error("你寻思寻思这密码它对吗？")
    else if (error.status === 400) messages.error("码姿不对，删了重写！（服务端校验不通过）")
    else if(error?.status === 403) messages.error('无权访问：有些门总是关着的')
    else messages.error(`服务端看完天塌了（状态码：${error}）`)
  } finally {
    saving.value = false
  }
}

const getSchedule = () => axios.get(`${APISRV}/web/config/${school.value}/${grade.value}/${cls.value}/schedule`);
const getOptions = () => axios.get(`${APISRV}/web/config/${school.value}/${grade.value}/timetable/options`);
const getSubjectsOptions = () => axios.get(`${APISRV}/web/config/${school.value}/${grade.value}/subjects/options`);

useRequest(getSchedule, {
  refreshDeps: [school, grade, cls],
  initialData: { daily_class: dynamicForm.daily_class },
  onSuccess: (response) => {
    // API 返回顺序是 [日,一,二,三,四,五,六]，重排为 [一,二,三,四,五,六,日]
    const raw = response.data['daily_class'] || []
    const reordered = [
      raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[0]
    ].filter(Boolean)
    // classList 保持嵌套数组格式 [["物"], ["数"]] 或 [["物", "化"], ["数"]]
    for (const day of reordered) {
      if (!Array.isArray(day.classList)) {
        day.classList = []
      }
    }
    dynamicForm.daily_class = reordered
    dataLoaded.value = true
  }
});

useRequest(getOptions, {
  refreshDeps: [school, grade, cls],
  initialData: { options: [] },
  onSuccess: (response) => {
    optionsLst.value = []
    const n = {}
    for (const datumElement of response.data['options']) {
      optionsLst.value.push({ label: datumElement['label'], value: datumElement['value'] })
      n[datumElement['label']] = datumElement['need']
    }
    needs.value = n
  }
});

useRequest(getSubjectsOptions, {
  refreshDeps: [school, grade, cls],
  initialData: { options: [] },
  onSuccess: (response) => {
    subjectsOptionsLst.value = []
    for (const datumElement of response.data['options']) {
      subjectsOptionsLst.value.push({ label: datumElement['label'], value: datumElement['value'] })
    }
  }
});

// 最大节数
const maxPeriods = computed(() => {
  let max = 0
  for (const day of dynamicForm.daily_class) {
    const n = needs.value[day.timetable] || 0
    if (n > max) max = n
  }
  return max
})

// 构建行数据：每行是一个节次
const tableData = computed(() => {
  const rows = []
  for (let p = 0; p < maxPeriods.value; p++) {
    rows.push({ period: p + 1 })
  }
  return rows
})

// 构建列：节次 + 周日~周六
function getColumns() {
  const cols = [
    { title: '节次', key: 'period', width: 70, fixed: 'left', align: 'center' }
  ]

  for (let d = 0; d < 7; d++) {
    const dayIdx = d
    cols.push({
      title: `周${weekDays[d]}`,
      key: `day_${d}`,
      width: 140,
      render(row) {
        const day = dynamicForm.daily_class[dayIdx]
        const need = needs.value[day.timetable] || 0
        const periodIdx = row.period - 1
        if (periodIdx >= need) return h('span', {style: 'opacity: 0.3;'}, '-')
        // classList 是嵌套数组 [[], []]，取对应节次的数组
        const slot = (day.classList || [])[periodIdx] || []
        const options = Array.isArray(slot) ? slot : [slot]
        if (options.length === 0) {
          return h(NSelect, {
            value: null,
            options: subjectsOptionsLst.value,
            size: 'small',
            placeholder: '选科目',
            onUpdateValue(val) {
              day.classList[periodIdx] = [val]
            }
          })
        }
        if (options.length === 1) {
          return h(NSelect, {
            value: options[0],
            options: subjectsOptionsLst.value,
            size: 'small',
            placeholder: '选科目',
            onUpdateValue(val) {
              day.classList[periodIdx] = [val]
            }
          })
        }
        // 多周轮换：显示为文本，格式 "物/化/地/数"
        return h(NInput, {
          value: options.join('/'),
          size: 'small',
          placeholder: '物/化/地/数',
          title: '多周轮换：用 / 分隔各周课程',
          onUpdateValue(v) {
            day.classList[periodIdx] = v.split('/').map(s => s.trim()).filter(Boolean)
          }
        })
      }
    })
  }

  return cols
}

// 作息表行（嵌在表头上方或用额外行展示）
function getTimetableRow() {
  return h('tr', {}, [
    h('td', {style: 'font-weight: 600; text-align: center;'}, '作息表'),
    ...weekDays.map((_, d) => {
      return h('td', {}, [
        h(NSelect, {
          value: dynamicForm.daily_class[d].timetable,
          options: optionsLst.value,
          size: 'small',
          placeholder: '作息表',
          style: 'width: 100%;',
          onUpdateValue(val) {
            const day = dynamicForm.daily_class[d]
            day.timetable = val
            const need = needs.value[val] || 0
            const old = day.classList || []
            day.classList = Array.from({length: need}, (_, i) => old[i] || '')
          }
        })
      ])
    })
  ])
}

const previewCode = computed(() => JSON.stringify(dynamicForm, null, 2));

// 切换单周/多周轮换
function toggleMultiWeek(dayIdx, periodIdx) {
  const day = dynamicForm.daily_class[dayIdx]
  const slot = (day.classList || [])[periodIdx] || []
  // 用特殊标记区分模式：单周=[单元素数组]，多周=[多元素数组或带标记]
  // 这里用数组长度判断：length===1 且最后一个元素不以 "__multi__" 开头 = 单周
  // 简单方案：用一个额外的 reactive 对象记录每个格子的模式
  const key = `${dayIdx}_${periodIdx}`
  if (multiWeekMode.value[key]) {
    // 切回单周：保留第一个有效选项
    const first = slot.find(s => s && s !== '') || ''
    day.classList[periodIdx] = [first]
    delete multiWeekMode.value[key]
  } else {
    // 切换为多周：保持当前选项不变
    multiWeekMode.value[key] = true
  }
}

// 多周模式标记
const multiWeekMode = ref({})
// 是否显示单周/多周切换按钮
const showMultiWeekToggle = ref(false)

// 判断是否多周
function isMultiWeek(dayIdx, periodIdx) {
  const key = `${dayIdx}_${periodIdx}`
  return !!multiWeekMode.value[key]
}

// 获取选择器的值
function getSlotValue(dayIdx, periodIdx) {
  const slot = (dynamicForm.daily_class[dayIdx].classList || [])[periodIdx] || []
  if (isMultiWeek(dayIdx, periodIdx)) {
    return slot // 多周返回数组
  }
  return slot[0] || null // 单周返回字符串
}

// 设置选择器的值
function setSlotValue(dayIdx, periodIdx, val) {
  const day = dynamicForm.daily_class[dayIdx]
  if (isMultiWeek(dayIdx, periodIdx)) {
    // 多周模式：val 是数组
    day.classList[periodIdx] = (Array.isArray(val) ? val : [val]).filter(Boolean)
  } else {
    // 单周模式：val 是字符串
    day.classList[periodIdx] = [val].filter(Boolean)
  }
}
</script>

<template>
  <NFlex vertical>
    <NCard title="所选信息">
      <NFlex justify="center">
        <NCard class="stat">
          <NStatistic label="所选学校" :value="school.toString()"/>
        </NCard>
        <NCard class="stat">
          <NStatistic label="所选年级" :value="grade.toString()"/>
        </NCard>
        <NCard class="stat">
          <NStatistic label="所选班级" :value="cls.toString()"/>
        </NCard>
      </NFlex>
    </NCard>

    <NCard title="课表配置">
      <template #header-extra>
        <NButton size="small" text @click="showMultiWeekToggle = !showMultiWeekToggle">
          {{ showMultiWeekToggle ? '隐藏轮换按钮' : '显示轮换按钮' }}
        </NButton>
      </template>
      <div v-if="dataLoaded" class="schedule-table-wrap">
        <table class="schedule-table">
          <thead>
            <tr>
              <th style="width: 70px;"></th>
              <th v-for="(day, d) in weekDays" :key="d">周{{ day }}</th>
            </tr>
            <tr class="timetable-row">
              <td class="row-label">作息表</td>
              <td v-for="(day, d) in weekDays" :key="d">
                <NSelect
                  :value="dynamicForm.daily_class[d].timetable"
                  :options="optionsLst"
                  size="small"
                  placeholder="选择"
                  @update:value="(val) => {
                    const dc = dynamicForm.daily_class[d]
                    dc.timetable = val
                    const need = needs[val] || 0
                    const old = dc.classList || []
                    dc.classList = Array.from({length: need}, (_, i) => old[i] || [''])
                  }"
                />
              </td>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in maxPeriods" :key="p">
              <td class="row-label">第{{ p }}节</td>
              <td v-for="(day, d) in weekDays" :key="d">
                <template v-if="(needs[dynamicForm.daily_class[d].timetable] || 0) >= p">
                  <div class="period-cell">
                    <NSelect
                      :value="getSlotValue(d, p - 1)"
                      :options="subjectsOptionsLst"
                      :multiple="isMultiWeek(d, p - 1)"
                      size="small"
                      :placeholder="isMultiWeek(d, p - 1) ? '多周轮换' : '选科目'"
                      :max-tag-count="1"
                      @update:value="(val) => setSlotValue(d, p - 1, val)"
                    />
                    <NButton
                      v-if="showMultiWeekToggle"
                      size="tiny"
                      text
                      :type="isMultiWeek(d, p - 1) ? 'primary' : 'default'"
                      @click.stop="toggleMultiWeek(d, p - 1)"
                      :title="isMultiWeek(d, p - 1) ? '切换为单周' : '切换为多周轮换'"
                    >
                      {{ isMultiWeek(d, p - 1) ? '多周' : '单周' }}
                    </NButton>
                  </div>
                </template>
                <span v-else class="empty-cell">-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else style="text-align: center; padding: 40px; opacity: 0.5;">加载中...</div>

      <div class="submit-area">
        <n-button type="primary" @click="submit">提交</n-button>
      </div>
    </NCard>

    <NCard title="提交前预览">
      <n-code :code="previewCode" language="json" show-line-numbers/>
    </NCard>

    <ConfirmPasswordModal
      v-model:show="showModal"
      :loading="saving"
      confirm-text="确认提交"
      @confirm="onPwdConfirm"
    />
  </NFlex>
</template>

<style scoped>
.schedule-table-wrap {
  overflow-x: auto;
}

.schedule-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.schedule-table th,
.schedule-table td {
  border: 1px solid var(--n-border-color, #e0e0e6);
  padding: 8px;
  text-align: center;
  white-space: nowrap;
}

.schedule-table th,
.timetable-row td {
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.row-label {
  font-weight: 500;
  width: 70px;
}

.empty-cell {
  opacity: 0.3;
}

.period-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.period-cell :deep(.n-select) {
  flex: 1;
}

.submit-area {
  display: flex;
  justify-content: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--n-border-color, #e0e0e6);
}
</style>
