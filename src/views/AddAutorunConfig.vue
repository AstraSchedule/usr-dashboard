<script setup>
import {computed, nextTick, reactive, ref, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {useRequest} from 'vue-request'
import {
  NAlert,
  NButton,
  NCard,
  NDatePicker,
  NDivider,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  NText,
  useMessage
} from 'naive-ui'
import {
  AutorunType,
  ConditionKind,
  autorunTypeOptions,
  createAction,
  createEntry,
  describeCondition,
  describeEntry,
  fetchClassScheduleTemplateByWeekday,
  fetchCompByHoliday,
  fetchCompByWorkday,
  fetchScopeTree,
  fetchSubjectsOptions,
  fetchTimetableOptions,
  flattenScope,
  getTask,
  normalizeEntry,
  saveTask
} from '@/api/autorun.js'
import {
  applyDisabledToScopeOptions,
  findNodeByValue,
  normalizeScopes,
  parseGradePairsFromScopes
} from '@/utils/scope.js'
import ConditionEditor from '@/components/autorun/ConditionEditor.vue'
import ActionEditor from '@/components/autorun/ActionEditor.vue'
import ConfirmPasswordModal from '@/components/ConfirmPasswordModal.vue'

// ============================================================
// 作用域树
// ============================================================
const scopeSelectOptions = ref([])
const scopeTreeRef = ref([])
useRequest(fetchScopeTree, {
  manual: false,
  onSuccess: (res) => { scopeSelectOptions.value = flattenScope(res?.data || []); scopeTreeRef.value = res?.data || [] },
  onError: (e) => { console.warn('[scope] 获取失败', e); scopeSelectOptions.value = []; scopeTreeRef.value = [] }
})

const route = useRoute()
const router = useRouter()
const message = useMessage()

const isEdit = computed(() => !!route.params.id)
const title = computed(() => isEdit.value ? '编辑自动任务' : '新增自动任务')

const form = reactive({
  id: '',
  name: '',
  type: AutorunType.COMPENSATION,
  scope: [],
  priority: 0,
  enabled: true,
  entries: [createEntry(AutorunType.COMPENSATION)]
})

// ============================================================
// 轮换表视图（UI 层聚合：N 条「每周轮换」条目 ↔ 一张 N 行轮换表）
// ============================================================
const viewMode = ref('list')
const rotationWeeks = ref(2)
const rotationRows = ref([])
// 轮换表的课程模板取自「单日」的课程表，这里指定用哪一天取模板
const rotationTemplateDate = ref(null)
const rotationAvailable = computed(() => form.type !== AutorunType.COMPENSATION)

function emptyAction() {
  const action = createAction(form.type)
  // ALL 类型需要作息表：新行直接带上当前作用域下的第一个选项，避免保存时才报错
  if (form.type === AutorunType.ALL && timetableOpts.value.length > 0) {
    action.timetableId = timetableOpts.value[0].value
  }
  return action
}

function resetRotationRows(weeks) {
  const n = Math.max(1, Number(weeks) || 1)
  const next = []
  for (let i = 0; i < n; i++) next.push(rotationRows.value[i] || emptyAction())
  rotationRows.value = next
}

function switchView(mode) {
  if (mode === viewMode.value) return
  if (mode === 'rotation') {
    const grouped = groupWeeklyEntries(form.entries)
    if (grouped) {
      rotationWeeks.value = grouped.everyWeeks
      rotationRows.value = grouped.rows
    } else {
      // 当前条目不是「同周期铺满的每周轮换」，无法还原成表格：
      // 用首条条目的内容预填第一行，并明确提示保存时会按轮换表展开
      const seed = form.entries[0]?.action
      rotationRows.value = []
      resetRotationRows(rotationWeeks.value)
      if (seed) rotationRows.value[0] = structuredClone(seed)
      message.info('当前条目不是单一的每周轮换，轮换表保存时会展开为 ' + rotationRows.value.length + ' 条每周轮换条目')
    }
  } else {
    const generated = rotationToEntries()
    if (generated.length > 0) form.entries = generated
  }
  viewMode.value = mode
}

// 全部条目都是同周期的每周轮换、且槽位恰好铺满 0..N-1 时，可还原成轮换表
function groupWeeklyEntries(entries) {
  const list = Array.isArray(entries) ? entries : []
  if (list.length < 2) return null
  const every = Number(list[0]?.when?.everyWeeks) || 0
  if (!every || every !== list.length) return null
  const rows = new Array(every).fill(null)
  for (const entry of list) {
    const when = entry.when || {}
    if (when.kind !== ConditionKind.WEEKLY || Number(when.everyWeeks) !== every) return null
    if (when.startDate || when.endDate || (Array.isArray(when.weekdays) && when.weekdays.length > 0)) return null
    const offset = Number(when.weekOffset) || 0
    if (offset < 0 || offset >= every || rows[offset]) return null
    rows[offset] = entry.action
  }
  return rows.every(Boolean) ? {everyWeeks: every, rows} : null
}

function rotationToEntries() {
  const out = []
  for (let i = 0; i < rotationRows.value.length; i++) {
    out.push({
      id: '',
      enabled: true,
      note: '',
      when: {kind: ConditionKind.WEEKLY, everyWeeks: rotationRows.value.length, weekOffset: i},
      action: rotationRows.value[i]
    })
  }
  return out
}

// ============================================================
// 类型切换
// ============================================================
// 读取已有任务时会先改 form.type 再灌 entry，需抑制这一次的类型联动重置
const suppressTypeWatch = ref(false)

watch(() => form.type, (type, oldType) => {
  if (suppressTypeWatch.value || type === oldType) return
  form.entries = [createEntry(type)]
  // 类型变了，轮换表里的内容结构也变了，必须丢弃旧行
  rotationRows.value = []
  resetRotationRows(rotationWeeks.value)
  if (viewMode.value === 'rotation' && type === AutorunType.COMPENSATION) viewMode.value = 'list'
  detectedNeedRaw.value = null
  detectedTimetableId.value = ''
  loadGradeOptions()
})

// ============================================================
// 条目操作
// ============================================================
function addEntry() {
  form.entries.push(createEntry(form.type))
}

function duplicateEntry(index) {
  const copy = structuredClone(form.entries[index])
  copy.id = ''
  form.entries.splice(index + 1, 0, copy)
}

function removeEntry(index) {
  if (form.entries.length <= 1) {
    message.warning('至少保留一条条目')
    return
  }
  form.entries.splice(index, 1)
}

function onConditionChange(index, value) {
  form.entries[index].when = value
}

// ============================================================
// 作用域 → 作息表 / 科目选项
// ============================================================
const timetableOpts = ref([])
const subjectsOpts = ref([])
const needByLabelMap = ref(new Map())
const detectedNeedRaw = ref(null)
const detectedTimetableId = ref('')
const detectedTimetableLabel = computed(() => {
  const opt = timetableOpts.value.find(o => o.value === detectedTimetableId.value)
  return opt ? opt.label : ''
})
const isRestDay = computed(() => detectedNeedRaw.value !== null && toCount(detectedNeedRaw.value) === 0)

function toCount(rawNeed) {
  const n = Number(rawNeed)
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n + 1
}

function pickSchoolGrade(selected) {
  const arr = Array.isArray(selected) ? selected : []
  const clsVal = arr.find(v => v && v.split('/').length >= 3)
  if (clsVal) {
    const [school, grade, cls] = clsVal.split('/')
    return {school, grade, cls}
  }
  const gradeVal = arr.find(v => v && v.split('/').length === 2)
  if (gradeVal) {
    const [school, grade] = gradeVal.split('/')
    return {school, grade}
  }
  const schoolVal = arr.find(v => v && v.split('/').length === 1)
  if (schoolVal) {
    const node = findNodeByValue(scopeTreeRef.value, schoolVal)
    const firstGrade = (node?.children || []).find(n => n.value && n.value.split('/').length === 2)
    if (firstGrade) {
      const [school, grade] = firstGrade.value.split('/')
      return {school, grade}
    }
  }
  return null
}

function collectClassesFromScopes(scopes) {
  const result = []
  const seen = new Set()
  const push = (school, grade, cls) => {
    if (!school || !grade || !cls) return
    const value = [school, grade, cls].join('/')
    if (seen.has(value)) return
    result.push({school, grade, cls, value})
    seen.add(value)
  }
  for (const v of (Array.isArray(scopes) ? scopes : [])) {
    if (!v) continue
    const parts = String(v).split('/').filter(Boolean)
    if (parts.length >= 3) {
      push(parts[0], parts[1], parts[2])
      continue
    }
    const node = findNodeByValue(scopeTreeRef.value, v)
    const level1 = Array.isArray(node?.children) ? node.children : []
    for (const mid of level1) {
      if (parts.length === 2) {
        push(...String(mid.value || '').split('/').filter(Boolean))
      } else {
        for (const c of (Array.isArray(mid?.children) ? mid.children : [])) {
          push(...String(c.value || '').split('/').filter(Boolean))
        }
      }
    }
  }
  return result
}

function intersectTimetableOptions(results) {
  let intersect = null
  const labelMap = new Map()
  for (const r of results) {
    const values = new Set((r.options || []).map(o => o.value))
    for (const o of (r.options || [])) {
      if (!labelMap.has(o.value)) labelMap.set(o.value, o.label)
    }
    intersect = intersect === null ? values : new Set([...intersect].filter(v => values.has(v)))
  }
  return [...(intersect || new Set())].map(v => ({label: labelMap.get(v) || String(v), value: v}))
}

async function loadGradeOptions() {
  if (form.type === AutorunType.COMPENSATION) return
  const pair = pickSchoolGrade(form.scope)
  if (!pair) {
    timetableOpts.value = []
    subjectsOpts.value = []
    needByLabelMap.value = new Map()
    return
  }
  const [{options, needMap: labelNeedMap}, {options: subs}] = await Promise.all([
    fetchTimetableOptions(pair.school, pair.grade),
    fetchSubjectsOptions(pair.school, pair.grade)
  ])
  needByLabelMap.value = labelNeedMap instanceof Map ? labelNeedMap : new Map(options.map(o => [o.label, Number(o.need) || 0]))
  subjectsOpts.value = subs

  if (form.type === AutorunType.TIMETABLE) {
    // 多年级时取交集，避免选出对部分生效域不可用的作息表
    const pairs = parseGradePairsFromScopes(form.scope)
    timetableOpts.value = pairs.length > 1
        ? intersectTimetableOptions(await Promise.all(pairs.map(p => fetchTimetableOptions(p.school, p.grade))))
        : options
  } else {
    timetableOpts.value = options
  }
  if (form.type === AutorunType.ALL) {
    for (const entry of form.entries) {
      if (!entry.action.timetableId && timetableOpts.value.length > 0) entry.action.timetableId = timetableOpts.value[0].value
    }
  }
}

watch(() => [form.type, JSON.stringify(form.scope)], () => {
  detectedNeedRaw.value = null
  detectedTimetableId.value = ''
  loadGradeOptions()
})

function onScopeChange(v) {
  form.scope = normalizeScopes(v)
}

const computedScopeOptions = computed(() => applyDisabledToScopeOptions(scopeSelectOptions.value, form.scope))

// ============================================================
// 调休：按日期反推
// ============================================================
// 反推按钮按条目隔离 loading，避免一个条目请求时其它条目按钮一起转圈
const compFilling = ref({})
const scheduleAutoFilling = ref(false)
const showConflict = ref(false)
const conflictMsg = ref('')

function compDateOf(entry) {
  return entry?.when?.kind === ConditionKind.DATE ? entry.when.date : null
}

async function fillCounterpart(entry, index, from) {
  if (form.type !== AutorunType.COMPENSATION) return
  const date = compDateOf(entry)
  const useDate = entry.action.useDate
  if (compFilling.value[index]) return
  compFilling.value[index] = true
  try {
    if (from === 'holiday' && useDate && !date) {
      const { data } = await fetchCompByHoliday(useDate)
      const filled = data?.compensation
      if (filled) form.entries[index] = {...entry, when: {...entry.when, date: filled}}
    } else if (from === 'workday' && date && !useDate) {
      const { data } = await fetchCompByWorkday(date)
      const filled = data?.compensation
      if (filled) {
        form.entries[index] = {...entry, action: {...entry.action, useDate: filled}}
      }
    }
  } finally {
    compFilling.value[index] = false
  }
}

// ============================================================
// 课程表自动填充
// ============================================================
// 收集作用域内各班在该日的课程模板；节次数不一致时返回 null 并弹冲突提示
async function collectScheduleCandidates(date) {
  const classList = collectClassesFromScopes(form.scope)
  if (classList.length === 0) {
    message.warning('请选择包含班级的生效域')
    return null
  }
  const weekday = new Date(date).getDay()
  const results = await Promise.allSettled(classList.map(c => fetchClassScheduleTemplateByWeekday({
    school: c.school, grade: c.grade, cls: c.cls, weekday
  })))
  const ok = []
  results.forEach((r, idx) => {
    if (r.status !== 'fulfilled') return
    const data = r.value?.data || {}
    const timetableLabel = String(data.timetableLabel || '')
    const needRaw = timetableLabel ? Number(needByLabelMap.value.get(timetableLabel)) : -1
    ok.push({
      cls: classList[idx],
      periods: Array.isArray(data.periods) ? data.periods : [],
      timetableLabel,
      needRaw,
      option: timetableLabel ? timetableOpts.value.find(o => o.label === timetableLabel) : null
    })
  })
  if (ok.length === 0) {
    message.error('未能获取到任何班级的课程模板')
    return null
  }
  if (new Set(ok.map(x => toCount(x.needRaw))).size > 1) {
    conflictMsg.value = '所选作用域内不同班级在该日的作息表节次数不一致，无法自动填充：\n' +
        ok.map(x => x.cls.value + '：作息表"' + (x.timetableLabel || '未知') + '" -> ' + toCount(x.needRaw) + ' 节').join('\n')
    showConflict.value = true
    return null
  }
  return ok
}

// 取出现次数最多的模板（并列取先出现的），避免随机选取导致同一操作结果不可复现
function pickMostCommonTemplate(candidates) {
  const groups = new Map()
  for (const item of candidates) {
    const key = item.timetableLabel + '|' + item.periods.map(p => String(p.subject || '')).join(',')
    const found = groups.get(key)
    if (found) found.count++
    else groups.set(key, { count: 1, item })
  }
  let best = null
  for (const group of groups.values()) {
    if (!best || group.count > best.count) best = group
  }
  return best.item
}

// 自动填充：rotationIndex 传数字表示作用于轮换表的某一行
async function autoFillSchedule(target, rotationIndex) {
  const condition = target.when || {}
  const date = condition.kind === ConditionKind.DATE ? condition.date : null
  if (!date) {
    message.warning('自动填充需要「单日」条件，请先选择日期')
    return
  }
  scheduleAutoFilling.value = true
  try {
    const ok = await collectScheduleCandidates(date)
    if (!ok) return
    const chosen = pickMostCommonTemplate(ok)
    const action = {
      ...target.action,
      schedule: { periods: chosen.periods.map((p, idx) => ({no: Number(p.no) || idx + 1, subject: String(p.subject || '')})) }
    }
    detectedNeedRaw.value = Number.isFinite(chosen.needRaw) ? chosen.needRaw : -1
    detectedTimetableId.value = chosen.option?.value || ''
    if (form.type === AutorunType.ALL) {
      if (chosen.option) action.timetableId = chosen.option.value
      else message.warning('未能从班级配置中识别出当日作息表，请手动选择作息表')
    }
    if (typeof rotationIndex === 'number') {
      rotationRows.value[rotationIndex] = action
    } else {
      const idx = form.entries.indexOf(target)
      if (idx >= 0) form.entries[idx] = {...target, action}
    }
    message.success('已按班级 ' + chosen.cls.value + ' 自动填充')
  } finally {
    scheduleAutoFilling.value = false
  }
}

// ============================================================
// 读取已有任务
// ============================================================
function applyTask(d) {
  suppressTypeWatch.value = true
  form.id = d.id || ''
  form.name = d.name || ''
  form.type = Number(d.type)
  form.scope = Array.isArray(d.scope) ? d.scope.slice() : []
  form.priority = Number(d.priority) || 0
  form.enabled = d.enabled !== false
  const entries = Array.isArray(d.entries) ? d.entries : []
  form.entries = entries.length > 0
      ? entries.map(e => normalizeEntry(e, form.type))
      : [createEntry(form.type)]
  // 必须在赋值之后再注册：nextTick 回调一定排在本次 watcher 队列之后
  nextTick(() => { suppressTypeWatch.value = false })
  loadGradeOptions()
}

const { run: runGet, loading: loadingGet } = useRequest(() => getTask(route.params.id), {
  manual: true,
  onSuccess: (resp) => { if (resp?.data) applyTask(resp.data) },
  onError: (e) => { message.error('读取失败'); console.error(e) }
})
if (isEdit.value) runGet()

// ============================================================
// 校验与保存
// ============================================================
function currentEntries() {
  return viewMode.value === 'rotation' ? rotationToEntries() : form.entries
}

function cleanCondition(when) {
  if (!when) return null
  const out = {kind: when.kind}
  const assignIf = (key) => { if (when[key] !== null && when[key] !== undefined && when[key] !== '') out[key] = when[key] }
  if (when.kind === ConditionKind.DATE) assignIf('date')
  if (when.kind === ConditionKind.RANGE) { assignIf('startDate'); assignIf('endDate') }
  if (when.kind === ConditionKind.WEEKLY) {
    out.everyWeeks = Number(when.everyWeeks) || 1
    out.weekOffset = Math.min(Math.max(Number(when.weekOffset) || 0, 0), out.everyWeeks - 1)
    assignIf('startDate'); assignIf('endDate')
  }
  if (when.kind === ConditionKind.EVENT) {
    out.event = when.event
    if (when.event === 'class_start' || when.event === 'class_end') out.period = Number(when.period) || 1
  }
  if (when.kind === ConditionKind.CRON) {
    out.cron = String(when.cron || '').trim()
    out.duration = Number(when.duration) || 0
  }
  if (Array.isArray(when.weekdays) && when.weekdays.length > 0) out.weekdays = when.weekdays.map(Number)
  return out
}

function cleanAction(action) {
  if (form.type === AutorunType.COMPENSATION) return {useDate: action.useDate}
  if (form.type === AutorunType.TIMETABLE) return {timetableId: action.timetableId}
  if (form.type === AutorunType.SCHEDULE) return {schedule: {periods: action.schedule?.periods || []}}
  if (form.type === AutorunType.ALL) return {timetableId: action.timetableId, schedule: {periods: action.schedule?.periods || []}}
  if (form.type === AutorunType.CLIENT_CONFIG) return {settings: {...action.settings}}
  return {}
}

function validateCondition(when) {
  if (!when) return '缺少生效条件'
  if (when.kind === ConditionKind.DATE && !when.date) return '请选择单日日期'
  if (when.kind === ConditionKind.RANGE && (!when.startDate || !when.endDate)) return '请选择日期范围的起止日期'
  if (when.kind === ConditionKind.WEEKLY && (Number(when.everyWeeks) || 0) < 1) return '每 N 周的 N 必须大于 0'
  if (when.kind === ConditionKind.EVENT && !when.event) return '请选择时刻事件'
  if (when.kind === ConditionKind.CRON && !String(when.cron || '').trim()) return '请填写 cron 表达式'
  return ''
}

function validatePeriods(action) {
  const periods = action.schedule?.periods || []
  if (periods.length === 0) return '请至少填写一节课，或点击「按当前课表自动填充」'
  const empty = periods.some(p => !p.subject || String(p.subject).trim() === '')
  return empty ? '请为每一节选择科目' : ''
}

function validateClientSettings(action) {
  return Object.keys(action.settings || {}).length === 0 ? '请至少选择一项客户端配置' : ''
}

function validateTimetableAction(action) {
  return action.timetableId ? '' : '请选择作息表'
}

function validateAllAction(action) {
  return action.timetableId ? validatePeriods(action) : '请选择作息表'
}

const actionValidators = {
  [AutorunType.COMPENSATION]: (action) => (action.useDate ? '' : '请选择借用的上课日期'),
  [AutorunType.TIMETABLE]: validateTimetableAction,
  [AutorunType.ALL]: validateAllAction,
  [AutorunType.SCHEDULE]: validatePeriods,
  [AutorunType.CLIENT_CONFIG]: validateClientSettings
}

function validateAction(action) {
  const validator = actionValidators[form.type]
  return validator ? validator(action) : ''
}

function validate() {
  if (!Array.isArray(form.scope) || form.scope.length === 0) { message.warning('请选择生效域'); return false }
  const entries = currentEntries()
  if (entries.length === 0) { message.warning('请至少添加一条条目'); return false }
  for (let i = 0; i < entries.length; i++) {
    const detail = validateCondition(entries[i].when) || validateAction(entries[i].action)
    if (detail) { message.warning('第 ' + (i + 1) + ' 条：' + detail); return false }
  }
  return true
}

const saving = ref(false)
const showPwd = ref(false)

function openSave() {
  if (!validate()) return
  showPwd.value = true
}

async function confirmSave(pwd) {
  saving.value = true
  try {
    const entries = currentEntries().map((e, idx) => ({
      id: e.id || undefined,
      enabled: e.enabled !== false,
      note: e.note || undefined,
      when: cleanCondition(e.when),
      action: cleanAction(e.action)
    }))
    const payload = {
      id: form.id || undefined,
      name: form.name || undefined,
      type: form.type,
      scope: form.scope,
      priority: Number(form.priority) || 0,
      enabled: form.enabled !== false,
      entries
    }
    await saveTask(payload, pwd)
    message.success('已保存')
    showPwd.value = false
    await router.push('/autorun')
  } catch (e) {
    const status = e?.status || e?.response?.status
    const detail = e?.response?.data?.detail
    if (status === 401) message.error('你寻思寻思这密码它对吗？')
    else if (status === 400) message.error(detail || '服务端校验不通过')
    else if (status === 403) message.error('无权访问：有些门总是关着的')
    else message.error('服务端看完天塌了（状态码：' + (status ?? '未知') + '）')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <n-card :title="title" :bordered="false">
    <n-form :model="form" label-placement="left" label-width="120">
      <n-form-item v-if="isEdit" label="唯一ID">
        <n-input v-model:value="form.id" disabled />
      </n-form-item>

      <n-form-item label="任务名称">
        <n-input v-model:value="form.name" placeholder="例如：期中考试周作息（留空则按内容自动生成）" />
      </n-form-item>

      <n-form-item label="类型">
        <n-select v-model:value="form.type" :options="autorunTypeOptions" />
      </n-form-item>

      <n-form-item label="生效域">
        <n-select v-model:value="form.scope" multiple tag :options="computedScopeOptions" placeholder="选择生效范围，可多选" @update:value="onScopeChange" />
      </n-form-item>

      <n-form-item label="优先级">
        <n-input-number v-model:value="form.priority" :show-button="false" placeholder="执行顺序（数字）" />
      </n-form-item>

      <n-form-item label="启用">
        <n-space align="center">
          <n-switch v-model:value="form.enabled" />
          <n-text depth="3" style="font-size:12px;">停用后该任务不参与课表解析</n-text>
        </n-space>
      </n-form-item>

      <n-divider>生效条件与内容</n-divider>

      <n-form-item v-if="form.type === AutorunType.COMPENSATION">
        <n-space>
          <n-button size="small" @click="router.push('/tools/compensation-import')">导入全年调休</n-button>
        </n-space>
      </n-form-item>

      <n-form-item v-if="rotationAvailable" label="编辑视图">
        <n-space align="center">
          <n-button size="small" :type="viewMode === 'list' ? 'primary' : 'default'" @click="switchView('list')">条目列表</n-button>
          <n-button size="small" :type="viewMode === 'rotation' ? 'primary' : 'default'" @click="switchView('rotation')">轮换表</n-button>
          <n-text depth="3" style="font-size:12px;">
            轮换表把「每 N 周的第 X 周」聚合为一张表，保存时展开为 N 条条目
          </n-text>
        </n-space>
      </n-form-item>

      <template v-if="viewMode === 'rotation'">
        <n-form-item label="轮换周期">
          <n-space align="center">
            <span>每</span>
            <n-input-number :value="rotationWeeks" :min="1" :max="26" :show-button="false" style="width:90px"
                            @update:value="v => { rotationWeeks = v; resetRotationRows(v) }" />
            <span>周轮换一次</span>
          </n-space>
        </n-form-item>

        <n-form-item v-if="form.type === AutorunType.SCHEDULE || form.type === AutorunType.ALL" label="课程模板日期">
          <n-space align="center">
            <n-date-picker v-model:formatted-value="rotationTemplateDate" type="date" value-format="yyyy-MM-dd" clearable />
            <n-text depth="3" style="font-size:12px;">「按当前课表自动填充」按该日期所在星期的课表取模板</n-text>
          </n-space>
        </n-form-item>

        <n-form-item v-for="(row, idx) in rotationRows" :key="idx" :label="'第 ' + (idx + 1) + ' 周'">
          <n-card size="small" style="width:100%" :bordered="true">
            <action-editor
                :type="form.type"
                :model-value="row"
                :timetable-options="timetableOpts"
                :timetable-loading="false"
                :timetable-hint="''"
                :subject-options="subjectsOpts"
                :auto-filling="scheduleAutoFilling"
                @update:model-value="v => rotationRows[idx] = v"
                @auto-fill="autoFillSchedule({ when: { kind: ConditionKind.DATE, date: rotationTemplateDate }, action: row }, idx)"
            />
          </n-card>
        </n-form-item>
      </template>

      <template v-else>
        <n-card v-for="(entry, idx) in form.entries" :key="idx" size="small" style="margin-bottom:12px" :bordered="true">
          <template #header>
            <n-space align="center">
              <n-tag size="small" :bordered="false">第 {{ idx + 1 }} 条</n-tag>
              <n-text depth="3" style="font-size:12px;">{{ describeCondition(entry.when) }} · {{ describeEntry(form, entry) }}</n-text>
            </n-space>
          </template>
          <template #header-extra>
            <n-space align="center">
              <n-switch v-model:value="entry.enabled" size="small" />
              <n-button size="small" tertiary @click="duplicateEntry(idx)">复制</n-button>
              <n-button size="small" tertiary type="error" @click="removeEntry(idx)">删除</n-button>
            </n-space>
          </template>

          <n-space vertical style="width:100%">
            <n-form-item label="生效条件" :show-feedback="false">
              <condition-editor :model-value="entry.when" :type="form.type" @update:model-value="v => onConditionChange(idx, v)" />
            </n-form-item>

            <n-form-item label="内容" :show-feedback="false">
              <action-editor
                  :type="form.type"
                  :model-value="entry.action"
                  :timetable-options="timetableOpts"
                  :timetable-loading="false"
                  :timetable-hint="''"
                  :subject-options="subjectsOpts"
                  :auto-filling="scheduleAutoFilling"
                  @update:model-value="v => form.entries[idx].action = v"
                  @auto-fill="autoFillSchedule(entry)"
              />
            </n-form-item>

            <n-space v-if="form.type === AutorunType.COMPENSATION" align="center">
              <n-button size="small" :loading="!!compFilling[idx]" @click="fillCounterpart(entry, idx, 'holiday')" :disabled="!entry.action.useDate">由节假日反推工作日</n-button>
              <n-button size="small" :loading="!!compFilling[idx]" @click="fillCounterpart(entry, idx, 'workday')" :disabled="!compDateOf(entry)">由工作日反推节假日</n-button>
            </n-space>
          </n-space>
        </n-card>

        <n-form-item>
          <n-button size="small" tertiary @click="addEntry">添加条目</n-button>
        </n-form-item>
      </template>

      <n-alert v-if="detectedNeedRaw !== null && viewMode === 'list'" type="info" :show-icon="false" style="margin-bottom:12px">
        <template v-if="detectedTimetableLabel">已检测到当日作息表：{{ detectedTimetableLabel }}（共 {{ toCount(detectedNeedRaw) }} 节）</template>
        <template v-else-if="isRestDay">检测到休息日，无需填写课程</template>
        <template v-else>已检测到节次数：{{ toCount(detectedNeedRaw) }}</template>
      </n-alert>

      <n-form-item>
        <n-space>
          <n-button type="primary" :loading="saving || loadingGet" @click="openSave">保存</n-button>
          <n-button tertiary @click="router.back()">取消</n-button>
        </n-space>
      </n-form-item>
    </n-form>
  </n-card>

  <n-modal v-model:show="showConflict" preset="dialog" title="节次数冲突">
    <n-space vertical>
      <div style="white-space: pre-line;">{{ conflictMsg }}</div>
      <div style="font-size:12px;color:#888">请调整生效域使其落到节次数一致的班级集合，或单选一个具体班级。</div>
    </n-space>
  </n-modal>

  <confirm-password-modal
      :loading="saving"
      :show="showPwd"
      confirm-text="确认保存"
      title="保存"
      @confirm="confirmSave"
      @update:show="val => showPwd = val"
  />
</template>

<style scoped>
/* autorun form */
</style>
