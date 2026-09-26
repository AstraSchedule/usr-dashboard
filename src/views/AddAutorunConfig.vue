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
  buildSwapCondition,
  createAction,
  createEntry,
  describeCondition,
  describeEntry,
  fetchClassScheduleRaw,
  fetchClassScheduleTemplateByWeekday,
  fetchCompByHoliday,
  fetchCompByWorkday,
  fetchScopeTree,
  fetchSubjectsOptions,
  fetchTimetableDivider,
  fetchTimetableOptions,
  flattenScope,
  formatSwapDateRange,
  getTask,
  normalizeEntry,
  normalizeSwap,
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
import PeriodRotationView from '@/components/autorun/PeriodRotationView.vue'
import ConfirmPasswordModal from '@/components/ConfirmPasswordModal.vue'
import {
  MAX_ROTATION_WEEKS,
  WEEKDAY_LABELS,
  collapseEntriesToPerDay,
  countExpandedEntries,
  expandPerDayRotation,
  importFromClassList,
  isPeriodRotationEntry,
  mergePeriodRotationEntries
} from '@/utils/rotation.js'

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

// 条目在界面上需要一个与数组下标无关的稳定标识：异步请求返回时数组可能已被增删，
// 用下标定位会把结果写到错误的条目上。_key 只存在于前端，confirmSave 不会把它发给服务端。
let entryKeySeq = 0

function nextEntryKey() {
  entryKeySeq += 1
  return 'k' + entryKeySeq
}

function makeEntry(type) {
  return {...createEntry(type), _key: nextEntryKey()}
}

function ensureEntryKeys(list) {
  for (const entry of list) {
    if (!entry._key) entry._key = nextEntryKey()
  }
  return list
}

const form = reactive({
  id: '',
  name: '',
  type: AutorunType.COMPENSATION,
  scope: [],
  priority: 0,
  enabled: true,
  entries: [makeEntry(AutorunType.COMPENSATION)]
})

// ============================================================
// 轮换表视图（UI 层聚合：N 条「每周轮换」条目 ↔ 一张 N 行轮换表）
// ============================================================
const viewMode = ref('list')
const rotationWeeks = ref(2)
const rotationRows = ref([])
// 轮换表的课程模板取自「单日」的课程表，这里指定用哪一天取模板
const rotationTemplateDate = ref(null)
// 轮换表把条目聚合成「每 N 周的第 X 周」，只对可周期化的类型有意义
const rotationAvailable = computed(() =>
  form.type !== AutorunType.COMPENSATION && form.type !== AutorunType.LESSON_SWAP)

// 逐节轮换只服务「课程表调整」：其它类型需要作息表 ID 或客户端设置，
// 展开出的条目缺少必需字段，服务端会直接拒绝
const periodRotationAvailable = computed(() => form.type === AutorunType.SCHEDULE)

// 逐节轮换视图：每节可独立周期，保存时按天展开为「每周轮换」条目
const periodDays = ref([])
const periodImporting = ref(false)
const periodDivider = ref({})
const periodTimetableLabels = ref({})

function emptyAction() {
  const action = createAction(form.type)
  // ALL 类型需要作息表：新行直接带上当前作用域下的第一个选项，避免保存时才报错
  if (form.type === AutorunType.ALL && timetableOpts.value.length > 0) {
    action.timetableId = timetableOpts.value[0].value
  }
  return action
}

// Vue 的 reactive 对象是 Proxy，structuredClone 会直接抛 DataCloneError；
// 条目内容本身都是纯 JSON 数据（日期是字符串、节次是数字），用 JSON 往返克隆即可
function clonePlain(value) {
  return JSON.parse(JSON.stringify(value))
}

function resetRotationRows(weeks) {
  const n = Math.max(1, Number(weeks) || 1)
  const next = []
  for (let i = 0; i < n; i++) next.push(rotationRows.value[i] || emptyAction())
  rotationRows.value = next
}

function switchView(mode) {
  if (mode === viewMode.value) return
  if (mode === 'period') {
    if (!periodRotationAvailable.value) return
    // 只接管「逐节轮换」形状的条目，其余条目留在条目列表里互不干扰
    periodDays.value = collapseEntriesToPerDay(form.entries)
    if (periodDays.value.length === 0 && form.entries.length > 0) {
      message.info('当前条目不是逐节轮换，视图为空；其余条目不受影响')
    }
    viewMode.value = mode
    return
  }
  // 离开逐节轮换视图：把当前编辑结果写回条目列表。
  // 有超限的天时不能写回：merge 会跳过那一天，写回等于静默丢掉它的轮换配置
  if (viewMode.value === 'period') {
    const merged = mergePeriodRotationEntries(form.entries, periodDays.value, nextEntryKey)
    if (merged.errors.length > 0) {
      message.warning(merged.errors.map(e => WEEKDAY_LABELS[e.weekday] + ' 的轮换周期 ' + e.cycle + ' 周超过上限 ' + MAX_ROTATION_WEEKS + ' 周').join('；'))
      return
    }
    form.entries = ensureEntryKeys(merged.entries)
  }
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
      if (seed) rotationRows.value[0] = clonePlain(seed)
      message.info('当前条目不是单一的每周轮换，轮换表保存时会展开为 ' + rotationRows.value.length + ' 条每周轮换条目')
    }
  } else if (viewMode.value === 'rotation') {
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
      // 与列表视图一致：条目必须有稳定 key，异步请求返回才能按 key 重新定位
      _key: nextEntryKey(),
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
  form.entries = [makeEntry(type)]
  // 类型变了，轮换表里的内容结构也变了，必须丢弃旧行
  rotationRows.value = []
  periodDays.value = []
  // 逐节轮换只在课程表调整下可用，切到别的类型必须离开该视图
  if (viewMode.value === 'period' && !periodRotationAvailable.value) viewMode.value = 'list'
  if (rotationAvailable.value) {
    resetRotationRows(rotationWeeks.value)
  } else {
    // 不支持轮换表的类型：强制回到列表视图，不留任何轮换数据
    viewMode.value = 'list'
  }
  detectedNeedRaw.value = null
  detectedTimetableId.value = ''
  loadGradeOptions()
})

// ============================================================
// 条目操作
// ============================================================
function addEntry() {
  form.entries.push(makeEntry(form.type))
}

function duplicateEntry(index) {
  const copy = clonePlain(form.entries[index])
  copy.id = ''
  copy._key = nextEntryKey()
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

// 调课条目卡片里的只读提示：生效条件由两端日期自动生成
function swapDateHint(entry) {
  return formatSwapDateRange(entry?.action?.swap) || '待填写两端日期'
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

// /web/config/:school/:grade/timetable/options 返回的 need 已经是「节次数」（max(下标)+1，见
// router/web/config_handlers.go 的 GetTimetableOptions），这里不能再 +1，否则界面上显示的
// 节次数会比实际多一节、自动填充后多出的一行取不到科目（#62）。
function toCount(rawNeed) {
  const n = Number(rawNeed)
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n
}

// 调课节次下拉的范围：优先用该作用域作息表的节次数（options.need 即所需课节行数），
// 拿不到时回退 12。不发新请求，只复用 loadGradeOptions 已取到的数据
const swapPeriodCount = computed(() => {
  const detected = Number(detectedNeedRaw.value)
  if (Number.isFinite(detected) && detected >= 1) return Math.floor(detected)
  const counts = timetableOpts.value
      .map(o => Number(needByLabelMap.value.get(o.label) ?? o.need))
      .filter(n => Number.isFinite(n) && n >= 1)
  return counts.length > 0 ? Math.max(...counts) : 12
})

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

function clearGradeOptions() {
  timetableOpts.value = []
  subjectsOpts.value = []
  needByLabelMap.value = new Map()
}

// 拉取该年级的作息表选项、need 映射与科目选项；失败抛出由调用方处理
async function fetchGradeOptions(pair) {
  const [timetableResult, subjectResult] = await Promise.all([
    fetchTimetableOptions(pair.school, pair.grade),
    fetchSubjectsOptions(pair.school, pair.grade)
  ])
  return {
    options: Array.isArray(timetableResult?.options) ? timetableResult.options : [],
    needMap: timetableResult?.needMap instanceof Map && timetableResult.needMap.size > 0 ? timetableResult.needMap : null,
    subjects: Array.isArray(subjectResult?.options) ? subjectResult.options : []
  }
}

// 多年级（TIMETABLE）取作息表交集，避免选出对部分生效域不可用的作息表；交集计算失败回退单年级选项。
// type/scope 由调用方在发起加载时捕获传入，避免 await 期间读到已经变化的表单状态。
async function resolveTimetableOptions(type, scope, options) {
  if (type !== AutorunType.TIMETABLE) return options
  const pairs = parseGradePairsFromScopes(scope)
  if (pairs.length <= 1) return options
  try {
    return intersectTimetableOptions(await Promise.all(pairs.map(p => fetchTimetableOptions(p.school, p.grade))))
  } catch (e) {
    console.warn('[autorun] 作息表交集计算失败', e)
    return options
  }
}

// ALL 类型的新条目补一个默认作息表
function applyDefaultTimetableToEntries(type) {
  if (type !== AutorunType.ALL || timetableOpts.value.length === 0) return
  for (const entry of form.entries) {
    if (!entry.action.timetableId) entry.action.timetableId = timetableOpts.value[0].value
  }
}

// 类型监听、作用域监听与 applyTask 都可能触发加载：用序号丢弃被取代的旧加载，
// 否则旧请求返回后会覆盖新作用域的选项、写入旧作用域的默认作息表，甚至弹出过期警告。
let gradeOptionsSeq = 0

async function loadGradeOptions() {
  // 先递增序号再分支：切到调休时同样要让在途的旧请求失效，
  // 否则旧请求仍可能写入选项、弹出过期警告或给调休条目塞作息表。
  const seq = ++gradeOptionsSeq
  const type = form.type
  const scope = form.scope.slice()
  if (type === AutorunType.COMPENSATION) {
    clearGradeOptions()
    return
  }
  const pair = pickSchoolGrade(scope)
  if (!pair) {
    if (seq === gradeOptionsSeq) clearGradeOptions()
    return
  }
  let fetched
  try {
    fetched = await fetchGradeOptions(pair)
  } catch (e) {
    if (seq !== gradeOptionsSeq) return
    // 选项拉取失败不应该让编辑器崩掉：清空选项并提示，用户改生效域后可重试
    console.warn('[autorun] 作息表/科目选项获取失败', e)
    message.warning('作息表与科目选项获取失败，请检查网络或稍后重试')
    clearGradeOptions()
    return
  }
  if (seq !== gradeOptionsSeq) return
  // needMap 正常由接口返回；缺失时按选项的 need 现场兜底，保持与旧行为一致
  needByLabelMap.value = fetched.needMap || new Map(fetched.options.map(o => [o.label, Number(o.need) || 0]))
  subjectsOpts.value = fetched.subjects
  const options = await resolveTimetableOptions(type, scope, fetched.options)
  if (seq !== gradeOptionsSeq) return
  timetableOpts.value = options
  applyDefaultTimetableToEntries(type)
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

// 按稳定 key 定位条目：请求期间用户可能删除或复制条目，下标会指向别的条目
function locateEntry(key) {
  const index = form.entries.findIndex(e => e._key === key)
  return index >= 0 ? {index, entry: form.entries[index]} : null
}

async function fillCounterpart(key, from) {
  if (form.type !== AutorunType.COMPENSATION) return
  const located = locateEntry(key)
  if (!located || compFilling.value[key]) return
  const { entry } = located
  const date = compDateOf(entry)
  const useDate = entry.action.useDate
  compFilling.value[key] = true
  try {
    let filled = null
    if (from === 'holiday') {
      if (useDate && !date) filled = (await fetchCompByHoliday(useDate))?.data?.compensation
    } else if (date && !useDate) {
      filled = (await fetchCompByWorkday(date))?.data?.compensation
    }
    if (!filled) return
    // 请求返回后重新定位：条目已被删除/复制时直接丢弃结果
    const target = locateEntry(key)
    if (!target) return
    if (from === 'holiday') {
      target.entry.when = {...target.entry.when, date: filled}
    } else {
      target.entry.action = {...target.entry.action, useDate: filled}
    }
  } finally {
    compFilling.value[key] = false
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
    // 请求失败（或当天没有节次）的空模板不能作为填充来源，否则会把已填课程清空
    if (data.failed || !Array.isArray(data.periods) || data.periods.length === 0) return
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
    message.error('未获取到可用的课程模板（可能是休息日、班级未配置课表或接口请求失败）')
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
      const located = locateEntry(target._key)
      if (located) located.entry.action = action
    }
    message.success('已按班级 ' + chosen.cls.value + ' 自动填充')
  } finally {
    scheduleAutoFilling.value = false
  }
}

// ============================================================
// 逐节轮换：从班级课表导入
// ============================================================
// 条目是任务级配置、作用于整个生效域：只有生效域恰好落在一个班级上时，
// 用这个班的课表导入才不会把它的课表套到别的班
function pickSingleClass(scopes) {
  const list = Array.isArray(scopes) ? scopes : []
  const classes = []
  for (const value of list) {
    const parts = String(value || '').split('/').filter(Boolean)
    if (parts.length < 3) return null
    classes.push(parts)
  }
  if (classes.length !== 1) return null
  return {school: classes[0][0], grade: classes[0][1], cls: classes[0][2]}
}

async function loadPeriodDivider(school, grade) {
  try {
    const { divider } = await fetchTimetableDivider(school, grade)
    const byWeekday = {}
    for (const [weekday, label] of Object.entries(periodTimetableLabels.value)) {
      const arr = label ? divider[label] : null
      if (Array.isArray(arr)) byWeekday[weekday] = arr.map(Number)
    }
    periodDivider.value = byWeekday
  } catch (e) {
    // 横条的分隔线只是辅助信息，拿不到就不画
    console.warn('[autorun] 分隔线读取失败', e)
    periodDivider.value = {}
  }
}

async function importFromClassSchedule() {
  const target = pickSingleClass(form.scope)
  if (!target) {
    message.warning('请把生效域收到恰好一个班级（学校/年级/班级）再导入')
    return
  }
  periodImporting.value = true
  try {
    const { dailyClass } = await fetchClassScheduleRaw(target.school, target.grade, target.cls)
    const days = importFromClassList(dailyClass)
    if (days.length === 0) {
      message.info('该班级课表没有多周轮换，无需转换')
      return
    }
    periodDays.value = days
    const labels = {}
    dailyClass.forEach((day, idx) => { labels[idx] = String(day?.timetable || '') })
    periodTimetableLabels.value = labels
    await loadPeriodDivider(target.school, target.grade)
    message.success('已导入 ' + days.length + ' 天，保存将展开为 ' + countExpandedEntries(days) + ' 条每周轮换条目')
  } catch (e) {
    console.warn('[autorun] 课表导入失败', e)
    message.error('课表读取失败，请检查网络或稍后重试')
  } finally {
    periodImporting.value = false
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
      ? ensureEntryKeys(entries.map(e => normalizeEntry(e, form.type)))
      : [makeEntry(form.type)]
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
  if (viewMode.value === 'rotation') return rotationToEntries()
  if (viewMode.value === 'period') {
    return mergePeriodRotationEntries(form.entries, periodDays.value, nextEntryKey).entries
  }
  return form.entries
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
  if (form.type === AutorunType.LESSON_SWAP) {
    const {from, to} = normalizeSwap(action?.swap)
    return {swap: {from, to}}
  }
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

function validateSwapAction(action) {
  const {from, to} = normalizeSwap(action?.swap)
  if (!from.date || !to.date) return '请选择交换的两端日期'
  if (from.period < 1 || to.period < 1) return '节次必须从 1 开始'
  if (from.date === to.date && from.period === to.period) return '同一天内交换的两节课不能是同一节'
  return ''
}

const actionValidators = {
  [AutorunType.COMPENSATION]: (action) => (action.useDate ? '' : '请选择借用的上课日期'),
  [AutorunType.TIMETABLE]: validateTimetableAction,
  [AutorunType.ALL]: validateAllAction,
  [AutorunType.SCHEDULE]: validatePeriods,
  [AutorunType.LESSON_SWAP]: validateSwapAction,
  [AutorunType.CLIENT_CONFIG]: validateClientSettings
}

function validateAction(action) {
  const validator = actionValidators[form.type]
  return validator ? validator(action) : ''
}

function validate() {
  if (!Array.isArray(form.scope) || form.scope.length === 0) { message.warning('请选择生效域'); return false }
  if (viewMode.value === 'period') {
    const { errors } = expandPerDayRotation(periodDays.value)
    if (errors.length > 0) {
      message.warning(errors.map(e => WEEKDAY_LABELS[e.weekday] + ' 的轮换周期 ' + e.cycle + ' 周超过上限 ' + MAX_ROTATION_WEEKS + ' 周').join('；'))
      return false
    }
  }
  const entries = currentEntries()
  if (entries.length === 0) { message.warning('请至少添加一条条目'); return false }
  // 调课的条件由两端日期自动生成，没有需要用户填写的条件
  const needCondition = form.type !== AutorunType.LESSON_SWAP
  for (let i = 0; i < entries.length; i++) {
    // 逐节轮换条目允许留空科目：旧课表本来就允许空槽（ResolveClassList 返回空串），
    // 强制补全会让「旧轮换课表 -> 自动任务」不再等价
    if (viewMode.value === 'period' && isPeriodRotationEntry(entries[i])) continue
    const detail = (needCondition ? validateCondition(entries[i].when) : '') || validateAction(entries[i].action)
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
      // 调课：条件随两端日期自动生成，覆盖 from/to 所在的两天
      when: form.type === AutorunType.LESSON_SWAP
          ? cleanCondition(buildSwapCondition(e.action?.swap))
          : cleanCondition(e.when),
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
          <n-button v-if="periodRotationAvailable" size="small" :type="viewMode === 'period' ? 'primary' : 'default'" @click="switchView('period')">逐节轮换</n-button>
          <n-text depth="3" style="font-size:12px;">
            轮换表按「每 N 周的第 X 周」聚合整周；逐节轮换允许每节周期不同
          </n-text>
        </n-space>
      </n-form-item>

      <template v-if="viewMode === 'period'">
        <n-form-item label="逐节轮换" :show-feedback="false">
          <period-rotation-view
              v-model="periodDays"
              :subject-options="subjectsOpts"
              :divider-by-weekday="periodDivider"
              :timetable-by-weekday="periodTimetableLabels"
              :max-periods="swapPeriodCount"
              :loading="periodImporting"
              @import="importFromClassSchedule"
          />
        </n-form-item>
      </template>

      <template v-else-if="viewMode === 'rotation'">
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
                :period-count="swapPeriodCount"
                @update:model-value="v => rotationRows[idx] = v"
                @auto-fill="autoFillSchedule({ when: { kind: ConditionKind.DATE, date: rotationTemplateDate }, action: row }, idx)"
            />
          </n-card>
        </n-form-item>
      </template>

      <template v-else>
        <n-card v-for="(entry, idx) in form.entries" :key="entry._key" size="small" style="margin-bottom:12px" :bordered="true">
          <template #header>
            <n-space align="center">
              <n-tag size="small" :bordered="false">第 {{ idx + 1 }} 条</n-tag>
              <n-text v-if="form.type === AutorunType.LESSON_SWAP" depth="3" style="font-size:12px;">{{ describeEntry(form, entry) }}</n-text>
              <n-text v-else depth="3" style="font-size:12px;">{{ describeCondition(entry.when) }} · {{ describeEntry(form, entry) }}</n-text>
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
            <n-form-item v-if="form.type === AutorunType.LESSON_SWAP" label="生效条件" :show-feedback="false">
              <n-text depth="3" style="font-size:12px;">生效日期：{{ swapDateHint(entry) }}（自动）</n-text>
            </n-form-item>
            <n-form-item v-else label="生效条件" :show-feedback="false">
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
                  :period-count="swapPeriodCount"
                  @update:model-value="v => form.entries[idx].action = v"
                  @auto-fill="autoFillSchedule(entry)"
              />
            </n-form-item>

            <n-space v-if="form.type === AutorunType.COMPENSATION" align="center">
              <n-button size="small" :loading="!!compFilling[entry._key]" @click="fillCounterpart(entry._key, 'holiday')" :disabled="!entry.action.useDate">由节假日反推工作日</n-button>
              <n-button size="small" :loading="!!compFilling[entry._key]" @click="fillCounterpart(entry._key, 'workday')" :disabled="!compDateOf(entry)">由工作日反推节假日</n-button>
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
