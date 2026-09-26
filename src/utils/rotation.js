// 逐节轮换（per-period rotation）纯函数：视图数据 <-> 自动任务条目。
//
// 视图数据 days: [{ weekday: 0..6, periods: [{ no: 1, weeks: ['语文', '英语'] }] }]
//   weekday 与 JS Date.getDay() 一致（0 = 周日）；weeks 的第 i 项表示「周期内第 i+1 周」的科目，
//   长度即该节的轮换周期，因此不同节可以有不同周期（旧课表 classList 的逐格数组就是这个形状）。
// 自动任务条目: { when: {kind:'weekly', everyWeeks:N, weekOffset:i, weekdays:[d]},
//                action: {schedule: {periods: [{no, subject}]}} }
//
// 等价性依据（usr-backend）：
//   - 旧轮换课表 ResolveClassList 取 (week-1) % len（service/schedule.go）
//   - 每周轮换条目 matchWeekCycle 命中 (week-1) % everyWeeks == weekOffset（service/autorun.go）
//   两边锚点同为学期起始日，故「按 N = lcm(各节序列长度) 展开成 N 条」与旧课表逐周解析逐格一致。

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 周期周数上限：2×3×5×7 这类组合会瞬间膨胀出上百条条目，超过一学年直接拒绝
export const MAX_ROTATION_WEEKS = 52

// 逐节轮换条目的来源标记：随 action 一起落库，是「这条由本视图生成」的权威依据。
// 只看字段形状会把用户手工构造的同形状条目也吃掉，并重写它的 note / 停用状态 / 周期范围。
export const PERIOD_ROTATION_SOURCE = 'period-rotation'

function gcd(a, b) {
  let x = a
  let y = b
  while (y !== 0) {
    const rest = x % y
    x = y
    y = rest
  }
  return x
}

export function lcm(a, b) {
  const x = Math.abs(Math.floor(Number(a) || 0))
  const y = Math.abs(Math.floor(Number(b) || 0))
  if (x === 0 || y === 0) return 0
  return x / gcd(x, y) * y
}

export function lcmAll(values) {
  const list = Array.isArray(values) ? values : []
  let out = 1
  for (const value of list) {
    const n = Math.floor(Number(value) || 0)
    if (n > 1) out = lcm(out, n)
  }
  return out
}

// 某一天的轮换周期：只有长度 >= 2 的节才算轮换，全为单周时周期为 1
export function dayCycleWeeks(periods) {
  const lengths = (Array.isArray(periods) ? periods : [])
      .map(p => (Array.isArray(p?.weeks) ? p.weeks.length : 0))
      .filter(len => len >= 2)
  return lengths.length === 0 ? 1 : lcmAll(lengths)
}

// 展开后会产生多少条条目（不含超限被拒绝的天）
export function countExpandedEntries(days) {
  let total = 0
  for (const day of (Array.isArray(days) ? days : [])) {
    const cycle = dayCycleWeeks(day?.periods)
    if (cycle > 1 && cycle <= MAX_ROTATION_WEEKS) total += cycle
  }
  return total
}

function isWeekday(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n <= 6
}

// 某一天在周期内第 week 周（0 起）的整张课表：每节按自己的序列取模，空序列保持为空
function periodsOfWeek(periods, week) {
  const out = []
  for (const period of periods) {
    const no = Math.floor(Number(period?.no) || 0)
    if (no <= 0) continue
    const weeks = Array.isArray(period?.weeks) ? period.weeks : []
    const subject = weeks.length > 0 ? String(weeks[week % weeks.length] ?? '') : ''
    out.push({ no, subject })
  }
  return out
}

function buildRotationEntry(weekday, cycle, week, periods, makeKey) {
  const entry = {
    id: '',
    enabled: true,
    note: '',
    when: { kind: 'weekly', everyWeeks: cycle, weekOffset: week, weekdays: [weekday] },
    action: { schedule: { periods: periodsOfWeek(periods, week) }, source: PERIOD_ROTATION_SOURCE }
  }
  if (typeof makeKey === 'function') entry._key = makeKey()
  return entry
}

// 展开为自动任务条目；makeKey 可选，用于给条目补上前端稳定标识（_key 不会发给服务端）
export function expandPerDayRotation(days, makeKey) {
  const entries = []
  const errors = []
  for (const day of (Array.isArray(days) ? days : [])) {
    const weekday = Number(day?.weekday)
    if (!isWeekday(weekday)) continue
    const periods = Array.isArray(day?.periods) ? day.periods : []
    const cycle = dayCycleWeeks(periods)
    if (cycle <= 1) continue
    if (cycle > MAX_ROTATION_WEEKS) {
      errors.push({ weekday, cycle })
      continue
    }
    for (let week = 0; week < cycle; week++) {
      entries.push(buildRotationEntry(weekday, cycle, week, periods, makeKey))
    }
  }
  return { entries, errors }
}

// 条目形状：每周轮换 + 恰好限定一天 + 课表内容。
// 旧数据（本视图写下 source 标记之前保存的条目）也是这个形状，所以形状是向前兼容的基础。
function matchesPeriodShape(entry) {
  const when = entry?.when || {}
  const action = entry?.action || {}
  return when.kind === 'weekly'
      && Array.isArray(when.weekdays) && when.weekdays.length === 1
      && isWeekday(when.weekdays[0])
      && Array.isArray(action?.schedule?.periods)
}

// 元数据干净：没有任何会被视图重写掉的用户设置（停用 / 备注 / 周期范围）
function isCleanPeriodMeta(entry) {
  const when = entry?.when || {}
  return !when.startDate && !when.endDate && !entry?.note && entry?.enabled !== false
}

// 是否由本视图生成（action.source 标记）。只用于「允许留空科目」这类仅本视图产出的条目才有的放宽，
// 不参与接管判定 —— 接管判定必须兼容没有标记的旧数据。
export function isGeneratedPeriodRotationEntry(entry) {
  return entry?.action?.source === PERIOD_ROTATION_SOURCE
}

// 按天收集「可由逐节轮换视图接管」的条目。一天要同时满足：
//   1) 每条都是每周轮换 + 限定单天 + 课表内容（matchesPeriodShape）
//   2) 元数据干净（isCleanPeriodMeta）—— 接管会重建条目，不能顺手改掉用户的设置
//   3) 周期完整铺满：everyWeeks 相同，weekOffset 恰好覆盖 0..N-1 各一次
// 条件 3 让「用户手写的、只有部分周次的每周轮换条目」不会被误判成本视图的数据。
// 单条条目能否成为候选：形状与元数据都要合格，且周期、偏移合法
function asManagedCandidate(entry) {
  if (!matchesPeriodShape(entry) || !isCleanPeriodMeta(entry)) return null
  const every = Math.floor(Number(entry.when.everyWeeks) || 0)
  const offset = Math.floor(Number(entry.when.weekOffset) || 0)
  if (every < 2 || offset < 0 || offset >= every) return null
  return { entry, every, offset, weekday: Number(entry.when.weekdays[0]) }
}

// 周期完整铺满：同周期，且偏移恰好覆盖 0..N-1 各一次
function isFullCycleGroup(group) {
  const cycle = group[0].every
  if (group.some(item => item.every !== cycle)) return false
  const offsets = new Set(group.map(item => item.offset))
  return offsets.size === group.length && offsets.size === cycle
}

function collectPeriodNumbers(group) {
  const nos = new Set()
  for (const item of group) {
    for (const period of item.entry.action.schedule.periods) {
      const no = Math.floor(Number(period?.no) || 0)
      if (no > 0) nos.add(no)
    }
  }
  return [...nos].sort((a, b) => a - b)
}

// 第 week 周第 no 节的科目：在该周那条条目的课表里查
function subjectOfWeek(group, week, no) {
  const owner = group.find(item => item.offset === week)
  const source = owner?.entry.action.schedule.periods.find(p => Number(p?.no) === no)
  return source ? String(source.subject ?? '') : ''
}

function buildManagedDay(weekday, group) {
  if (!isFullCycleGroup(group)) return null
  const cycle = group[0].every
  return {
    weekday,
    periods: collectPeriodNumbers(group).map(no => ({
      no,
      weeks: Array.from({ length: cycle }, (_, week) => subjectOfWeek(group, week, no))
    }))
  }
}

function collectManagedPeriodEntries(entries) {
  const candidates = new Map()
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const item = asManagedCandidate(entry)
    if (!item) continue
    if (!candidates.has(item.weekday)) candidates.set(item.weekday, [])
    candidates.get(item.weekday).push(item)
  }
  const days = []
  const managed = new Set()
  for (const weekday of [...candidates.keys()].sort((a, b) => a - b)) {
    const group = candidates.get(weekday)
    const day = buildManagedDay(weekday, group)
    if (!day) continue
    days.push(day)
    for (const item of group) managed.add(item.entry)
  }
  return { days, managed }
}

// 从已有条目还原视图数据（只取能被接管的那些天）
export function collapseEntriesToPerDay(entries) {
  return collectManagedPeriodEntries(entries).days
}

// 把逐节轮换的展开结果并回条目列表：替换掉被接管的条目，其余条目原样保留、顺序不变。
// 视图之间来回切换都不能碰其它视图产生的条目（例如轮换表、单日调整）。
export function mergePeriodRotationEntries(entries, days, makeKey) {
  const list = Array.isArray(entries) ? entries : []
  const { managed } = collectManagedPeriodEntries(list)
  const { entries: expanded, errors } = expandPerDayRotation(days, makeKey)
  return { entries: [...list.filter(entry => !managed.has(entry)), ...expanded], errors }
}

// 空槽（[] 或 ['']）视为未配置；其余保留原样，空字符串也保留（表示该周没有课）
function normalizeWeekSlot(slot) {
  const arr = Array.isArray(slot) ? slot : [slot]
  const weeks = arr.map(value => String(value ?? '').trim())
  return weeks.some(value => value !== '') ? weeks : []
}

// 旧版轮换课表（课表配置的 daily_class）-> 逐节轮换视图数据。
// 顺序与 JS Date.getDay() 一致：[日, 一, 二, 三, 四, 五, 六]（与 desktop scheduleConfig 相同）。
// 只保留「至少有一节多周轮换」的天：没有轮换的天无需转换，保持原课表配置即可。
export function importFromClassList(dailyClass) {
  const list = Array.isArray(dailyClass) ? dailyClass : []
  const days = []
  for (let weekday = 0; weekday < list.length && weekday < 7; weekday++) {
    const classList = list[weekday]?.classList
    if (!Array.isArray(classList) || classList.length === 0) continue
    const periods = classList.map((slot, idx) => ({ no: idx + 1, weeks: normalizeWeekSlot(slot) }))
    if (!periods.some(period => period.weeks.length >= 2)) continue
    days.push({ weekday, periods })
  }
  return days
}
