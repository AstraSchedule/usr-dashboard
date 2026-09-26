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
      const outPeriods = []
      for (const period of periods) {
        const no = Math.floor(Number(period?.no) || 0)
        if (no <= 0) continue
        const weeks = Array.isArray(period?.weeks) ? period.weeks : []
        const subject = weeks.length > 0 ? String(weeks[week % weeks.length] ?? '') : ''
        outPeriods.push({ no, subject })
      }
      const entry = {
        id: '',
        enabled: true,
        note: '',
        when: { kind: 'weekly', everyWeeks: cycle, weekOffset: week, weekdays: [weekday] },
        action: { schedule: { periods: outPeriods } }
      }
      if (typeof makeKey === 'function') entry._key = makeKey()
      entries.push(entry)
    }
  }
  return { entries, errors }
}

// 判断条目是否由「逐节轮换」视图产出：每周轮换 + 限定星期 + 课表内容
export function isPeriodRotationEntry(entry) {
  const when = entry?.when || {}
  const periods = entry?.action?.schedule?.periods
  return when.kind === 'weekly'
      && Array.isArray(when.weekdays) && when.weekdays.length > 0
      && Array.isArray(periods)
}

// 从已有条目还原视图数据：按天合并同一天的每周轮换条目，周期取各条 everyWeeks 的最小公倍数。
// 周期短的条目按自己的偏移周期性重复填入 —— 与后端「同一天逐条覆盖」的结果一致。
export function collapseEntriesToPerDay(entries) {
  const buckets = new Map()
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    if (!isPeriodRotationEntry(entry)) continue
    const every = Math.floor(Number(entry.when.everyWeeks) || 0)
    const offset = Math.floor(Number(entry.when.weekOffset) || 0)
    if (every < 1 || offset < 0 || offset >= every) continue
    for (const raw of entry.when.weekdays) {
      const weekday = Number(raw)
      if (!isWeekday(weekday)) continue
      if (!buckets.has(weekday)) buckets.set(weekday, [])
      buckets.get(weekday).push({ every, offset, periods: entry.action.schedule.periods })
    }
  }
  const days = []
  for (const weekday of [...buckets.keys()].sort((a, b) => a - b)) {
    const groups = buckets.get(weekday)
    const cycle = lcmAll(groups.map(group => group.every))
    const nos = new Set()
    for (const group of groups) {
      for (const period of group.periods) {
        const no = Math.floor(Number(period?.no) || 0)
        if (no > 0) nos.add(no)
      }
    }
    const snapshots = Array.from({ length: cycle }, () => new Map())
    for (const group of groups) {
      for (let week = group.offset; week < cycle; week += group.every) {
        for (const period of group.periods) {
          const no = Math.floor(Number(period?.no) || 0)
          if (no > 0) snapshots[week].set(no, String(period?.subject ?? ''))
        }
      }
    }
    const periods = [...nos].sort((a, b) => a - b).map(no => ({
      no,
      weeks: snapshots.map(snapshot => (snapshot.has(no) ? snapshot.get(no) : ''))
    }))
    days.push({ weekday, periods })
  }
  return days
}

// 把逐节轮换的展开结果并回条目列表：替换掉原有的逐节轮换条目，其余条目原样保留、顺序不变。
// 视图之间来回切换都不能碰其它视图产生的条目（例如轮换表、单日调整）。
export function mergePeriodRotationEntries(entries, days, makeKey) {
  const { entries: expanded, errors } = expandPerDayRotation(days, makeKey)
  const kept = (Array.isArray(entries) ? entries : []).filter(entry => !isPeriodRotationEntry(entry))
  return { entries: [...kept, ...expanded], errors }
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
