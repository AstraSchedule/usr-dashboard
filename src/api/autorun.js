import axios from 'axios'
import {APISRV} from '@/global.js'

// 自动任务 v2：一条记录 = 一个任务，任务内包含若干「条件 + 内容」条目
// TaskItem: { id, name, type(0..4), scope: string[], priority(number), enabled(bool),
//             status('待生效'|'生效中'|'已过期'), entries: EntryItem[] }
// EntryItem: { id, enabled(bool), note, when: Condition|null, action: object }

export const AutorunType = {
  COMPENSATION: 0,
  TIMETABLE: 1,
  SCHEDULE: 2,
  ALL: 3,
  CLIENT_CONFIG: 4
}

export const autorunTypeOptions = [
  { label: '调休', value: AutorunType.COMPENSATION },
  { label: '作息表调整', value: AutorunType.TIMETABLE },
  { label: '课程表调整', value: AutorunType.SCHEDULE },
  { label: '全部调整', value: AutorunType.ALL },
  { label: '客户端配置', value: AutorunType.CLIENT_CONFIG }
]

// 生效条件类型（与服务端 AutorunCondition.Kind 一致）
export const ConditionKind = {
  DATE: 'date',
  RANGE: 'range',
  WEEKLY: 'weekly',
  EVENT: 'event',
  CRON: 'cron'
}

export const conditionKindOptions = [
  { label: '单日', value: ConditionKind.DATE },
  { label: '日期范围', value: ConditionKind.RANGE },
  { label: '每周轮换', value: ConditionKind.WEEKLY },
  { label: '时刻事件', value: ConditionKind.EVENT },
  { label: 'cron 表达式', value: ConditionKind.CRON }
]

export const EventKind = {
  STARTUP: 'startup',
  CLASS_START: 'class_start',
  CLASS_END: 'class_end'
}

export const eventKindOptions = [
  { label: '客户端启动时', value: EventKind.STARTUP },
  { label: '第 N 节课上课时', value: EventKind.CLASS_START },
  { label: '第 N 节课下课时', value: EventKind.CLASS_END }
]

// 自动任务可以覆盖的桌面端本地配置项
export const clientConfigSettingOptions = [
  { key: 'isWindowAlwaysOnTop', label: '窗口置顶' },
  { key: 'isDuringClassHidden', label: '上课隐藏' },
  { key: 'isAlwaysMinimized', label: '始终缩小' },
  { key: 'isDuringClassCountdown', label: '课上计时' }
]

export const weekdayOptions = [
  { label: '周日', value: 0 },
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 }
]

export function getAutorunTypeLabel(typeValue) {
  const found = autorunTypeOptions.find(o => o.value === Number(typeValue))
  return found ? found.label : String(typeValue)
}

export function decodeAutorunType(t) {
  if (typeof t === 'number') return t
  const s = String(t || '').toUpperCase()
  if (s === 'COMPENSATION') return AutorunType.COMPENSATION
  if (s === 'TIMETABLE') return AutorunType.TIMETABLE
  if (s === 'SCHEDULE') return AutorunType.SCHEDULE
  if (s === 'ALL') return AutorunType.ALL
  if (s === 'CLIENT_CONFIG') return AutorunType.CLIENT_CONFIG
  return t
}

export function encodeScope(level, school, grade, cls) {
  if (level === 'school') return `${school}`
  if (level === 'grade') return `${school}/${grade}`
  if (level === 'class') return `${school}/${grade}/${cls}`
  return String(level)
}

export function parseScope(value) {
  const raw = String(value || '')
  const parts = raw.split('/').filter(s => s !== '')
  const [school, grade, cls] = parts
  let level = 'unknown'
  if (parts.length === 1) level = 'school'
  else if (parts.length === 2) level = 'grade'
  else if (parts.length >= 3) level = 'class'
  return { level, school, grade, class: cls }
}

let scopeTreeCache = null

function isLevelNode(node) {
  return node && typeof node === 'object' && 'raw' in node && !node.to
}

function makeClassNode(schoolRaw, gradeRaw, c) {
  const classLabel = c.text || c.label || String(c.raw)
  const classVal = encodeScope('class', String(schoolRaw), String(gradeRaw), String(c.raw))
  return {label: classLabel, value: classVal, raw: String(c.raw)}
}

function makeGradeNode(schoolRaw, g) {
  const gradeLabel = g.text || g.label || String(g.raw)
  const gradeVal = encodeScope('grade', String(schoolRaw), String(g.raw))
  const grade = {label: gradeLabel, value: gradeVal, raw: String(g.raw), children: []}
  const classes = Array.isArray(g.children) ? g.children : []
  for (const c of classes) {
    if (isLevelNode(c)) grade.children.push(makeClassNode(schoolRaw, g.raw, c))
  }
  return grade
}

function makeSchoolNode(n) {
  const schoolLabel = n.text || n.label || String(n.raw)
  const schoolVal = encodeScope('school', String(n.raw))
  const school = {label: schoolLabel, value: schoolVal, raw: String(n.raw), children: []}
  const children = Array.isArray(n.children) ? n.children : []
  for (const g of children) {
    if (isLevelNode(g)) school.children.push(makeGradeNode(n.raw, g))
  }
  return school
}

function buildScopeTreeFromMenu(menu) {
  if (!Array.isArray(menu)) return []
  const result = []
  for (const node of menu) {
    if (isLevelNode(node)) result.push(makeSchoolNode(node))
  }
  return result
}

export async function fetchScopeTree() {
  if (scopeTreeCache) return { data: scopeTreeCache }
  const resp = await axios.get(`${APISRV}/web/menu`)
  const payload = resp?.data?.data || []
  scopeTreeCache = buildScopeTreeFromMenu(payload)
  return { data: scopeTreeCache }
}

export function flattenScope(nodes, prefix = '') {
  const out = []
  for (const n of nodes || []) {
    const label = prefix ? `${prefix} / ${n.label}` : n.label
    out.push({ label, value: n.value })
    if (n?.children?.length) out.push(...flattenScope(n.children, label))
  }
  return out
}

// ============================================================
// 条目工厂与解析
// ============================================================

export function createCondition(kind = ConditionKind.DATE) {
  const base = { kind }
  if (kind === ConditionKind.DATE) base.date = null
  if (kind === ConditionKind.RANGE) { base.startDate = null; base.endDate = null }
  if (kind === ConditionKind.WEEKLY) { base.everyWeeks = 2; base.weekOffset = 0 }
  if (kind === ConditionKind.EVENT) { base.event = EventKind.CLASS_START; base.period = 1 }
  if (kind === ConditionKind.CRON) { base.cron = '0 8 * * 1'; base.duration = 0 }
  return base
}

export function createAction(type) {
  if (type === AutorunType.COMPENSATION) return { useDate: null }
  if (type === AutorunType.TIMETABLE) return { timetableId: '' }
  if (type === AutorunType.SCHEDULE) return { schedule: { periods: [] } }
  if (type === AutorunType.ALL) return { timetableId: '', schedule: { periods: [] } }
  if (type === AutorunType.CLIENT_CONFIG) {
    // 空对象表示「不覆盖任何配置」；只有显式开关的键才会下发
    return { settings: {} }
  }
  return {}
}

export function createEntry(type) {
  return { id: '', enabled: true, note: '', when: createCondition(ConditionKind.DATE), action: createAction(type) }
}

// 服务端返回的条目 -> 编辑器条目（补齐缺省字段）
export function normalizeEntry(raw, type) {
  const entry = createEntry(type)
  if (!raw || typeof raw !== 'object') return entry
  entry.id = String(raw.id || '')
  entry.enabled = raw.enabled !== false
  entry.note = String(raw.note || '')
  if (raw.when && typeof raw.when === 'object') {
    entry.when = {...createCondition(raw.when.kind || ConditionKind.DATE), ...raw.when}
    if (!Array.isArray(entry.when.weekdays)) delete entry.when.weekdays
  }
  const action = raw.action || raw.content || {}
  entry.action = {...createAction(type), ...action}
  if (type === AutorunType.SCHEDULE || type === AutorunType.ALL) {
    const periods = action?.schedule?.periods
    entry.action.schedule = {
      periods: Array.isArray(periods)
          ? periods.map(p => ({no: Number(p?.no) || 0, subject: String(p?.subject || '')}))
          : []
    }
  }
  if (type === AutorunType.CLIENT_CONFIG) {
    const settings = {}
    for (const opt of clientConfigSettingOptions) {
      const value = action?.settings?.[opt.key]
      if (typeof value === 'boolean') settings[opt.key] = value
    }
    entry.action.settings = settings
  }
  return entry
}

export function describeCondition(when) {
  if (!when) return '始终生效'
  switch (when.kind) {
    case ConditionKind.DATE:
      return `单日 ${when.date || '?'}`
    case ConditionKind.RANGE:
      return `${when.startDate || '?'} 至 ${when.endDate || '?'}`
    case ConditionKind.WEEKLY: {
      const every = Number(when.everyWeeks) || 1
      const offset = Number(when.weekOffset) || 0
      const parts = [`每 ${every} 周的第 ${offset + 1} 周`]
      if (when.startDate || when.endDate) parts.push(`${when.startDate || '开学'} ~ ${when.endDate || '不限'}`)
      if (Array.isArray(when.weekdays) && when.weekdays.length > 0) {
        parts.push(when.weekdays.map(d => weekdayOptions.find(o => o.value === d)?.label || d).join('/'))
      }
      return parts.join('，')
    }
    case ConditionKind.EVENT: {
      const label = eventKindOptions.find(o => o.value === when.event)?.label || when.event || '?'
      if (when.event === EventKind.STARTUP) return label
      return label.replace('N', String(Number(when.period) || 1))
    }
    case ConditionKind.CRON:
      return when.duration > 0 ? `cron ${when.cron}（持续 ${when.duration} 分钟）` : `cron ${when.cron}`
    default:
      return String(when.kind || '未知条件')
  }
}

export function describeEntry(task, entry) {
  const type = decodeAutorunType(task?.type)
  const action = entry?.action || {}
  if (type === AutorunType.COMPENSATION) return `上 ${action.useDate || '?'} 的课`
  if (type === AutorunType.TIMETABLE) return `作息表：${action.timetableId || '?'}`
  if (type === AutorunType.SCHEDULE) return `课程表（${(action.schedule?.periods || []).length} 节）`
  if (type === AutorunType.ALL) return `作息表：${action.timetableId || '?'} + 课程表（${(action.schedule?.periods || []).length} 节）`
  if (type === AutorunType.CLIENT_CONFIG) {
    const on = clientConfigSettingOptions.filter(o => action.settings?.[o.key] === true).map(o => o.label)
    const off = clientConfigSettingOptions.filter(o => action.settings?.[o.key] === false).map(o => `关闭${o.label}`)
    return [...on, ...off].join('、') || '未配置'
  }
  return ''
}

export function summarizeEntries(task) {
  const entries = Array.isArray(task?.entries) ? task.entries : []
  if (entries.length === 0) return '（无条目）'
  const first = entries[0]
  const head = `${describeCondition(first.when)} · ${describeEntry(task, first)}`
  return entries.length > 1 ? `${head} 等 ${entries.length} 条` : head
}

// ============================================================
// 接口调用
// ============================================================

function mapTask(t) {
  let scope = []
  if (Array.isArray(t.scope)) scope = t.scope
  else if (t.scope) scope = [t.scope]
  return {
    id: t.id,
    name: t.name || '',
    type: decodeAutorunType(t.type),
    scope,
    priority: Number(t.priority) || 0,
    enabled: t.enabled !== false,
    status: t.status || '待生效',
    entries: Array.isArray(t.entries) ? t.entries : []
  }
}

export async function listTasks() {
  const resp = await axios.get(`${APISRV}/web/autorun`)
  const payload = resp?.data
  const arr = Array.isArray(payload?.data) ? payload.data : []
  return { data: arr.map(mapTask) }
}

export async function getTask(id) {
  const resp = await axios.get(`${APISRV}/web/autorun/hash/${id}`)
  const d = resp?.data?.data
  if (!d || Array.isArray(d)) throw new Error('Not Found')
  return { data: mapTask(d) }
}

// saveTask 统一任务写入：一个任务携带若干条目
export async function saveTask(payload, password) {
  const resp = await axios.put(`${APISRV}/web/autorun/task`, payload, {
    headers: { 'X-Verify-Password': password }
  })
  return resp?.data
}

export async function fetchClassScheduleTemplateByWeekday({ school, grade, cls, weekday }) {
  try {
    const resp = await axios.get(`${APISRV}/web/config/${school}/${grade}/${cls}/schedule`)
    const data = resp?.data || {}
    const days = Array.isArray(data.daily_class) ? data.daily_class : []
    const day = days[weekday] || {classList: [], timetable: ''}
    const classList = Array.isArray(day.classList) ? day.classList : []
    const timetableLabel = String(day.timetable || '')
    const periods = classList.map((arr, idx) => {
      const subject = Array.isArray(arr) && arr.length > 0 ? String(arr[0] ?? '') : ''
      return { no: idx + 1, subject }
    })
    return {data: {periods, timetableLabel}}
  } catch (e) {
    console.warn('[autorun] fetchClassScheduleTemplateByWeekday fallback', e)
    // failed 标记用于让调用方区分「请求失败」与「当天确实没有课」，避免用空模板覆盖已填内容
    return {data: {periods: [], timetableLabel: '', failed: true}}
  }
}

export async function fetchTimetableOptions(school, grade) {
  const resp = await axios.get(`${APISRV}/web/config/${school}/${grade}/timetable/options`)
  const list = Array.isArray(resp?.data?.options) ? resp.data.options : []
  const options = list.map(it => ({ label: it.label, value: it.value, need: it.need }))
  const needMap = new Map(options.map(o => [o.label, Number(o.need) || 0]))
  return { options, needMap }
}

export async function fetchSubjectsOptions(school, grade) {
  const resp = await axios.get(`${APISRV}/web/config/${school}/${grade}/subjects/options`)
  const list = Array.isArray(resp?.data?.options) ? resp.data.options : []
  const options = list.map(it => ({ label: it.label, value: it.value }))
  return { options }
}

export async function fetchCompByHoliday(yyyyMmDd) {
  try {
    const [y,m,d] = String(yyyyMmDd).split('-')
    const resp = await axios.get(`${APISRV}/web/autorun/compensation/holiday/${y}/${m}/${d}`)
    return { data: resp?.data }
  } catch (e) {
    console.warn('[autorun] fetchCompByHoliday error', e)
    return { data: null }
  }
}

export async function fetchCompByWorkday(yyyyMmDd) {
  try {
    const [y,m,d] = String(yyyyMmDd).split('-')
    const resp = await axios.get(`${APISRV}/web/autorun/compensation/workday/${y}/${m}/${d}`)
    return { data: resp?.data }
  } catch (e) {
    console.warn('[autorun] fetchCompByWorkday error', e)
    return { data: null }
  }
}

export async function fetchCompYearPairs(year) {
  try {
    const resp = await axios.get(`${APISRV}/web/autorun/compensation/year/${year}`)
    const pairs = Array.isArray(resp?.data?.pairs) ? resp.data.pairs : []
    return { data: { year: resp?.data?.year ?? year, pairs } }
  } catch (e) {
    console.warn('[autorun] fetchCompYearPairs error', e)
    return { data: { year, pairs: [] } }
  }
}
