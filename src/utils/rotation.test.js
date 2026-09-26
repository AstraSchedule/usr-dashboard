import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ROTATION_WEEKS,
  collapseEntriesToPerDay,
  countExpandedEntries,
  dayCycleWeeks,
  expandPerDayRotation,
  importFromClassList,
  isPeriodRotationEntry,
  mergePeriodRotationEntries,
  lcmAll
} from './rotation.js'

// ---- 后端语义复刻（usr-backend/service/schedule.go、autorun.go） ----

// ResolveClassList：(week-1) % len，长度 1 恒定，长度 0 为空
function resolveClassList(classList, weekNumber) {
  return classList.map(item => {
    if (!Array.isArray(item) || item.length === 0) return ''
    if (item.length === 1) return item[0]
    return item[(weekNumber - 1) % item.length]
  })
}

// matchWeekCycle + applyPeriodsToDay：同一任务内条目按录入顺序，后者覆盖前者
function resolveDayByEntries(entries, weekday, weekNumber) {
  let resolved = null
  for (const entry of entries) {
    const when = entry.when || {}
    if (when.kind !== 'weekly') continue
    if (!when.weekdays.includes(weekday)) continue
    if ((weekNumber - 1) % when.everyWeeks !== when.weekOffset) continue
    resolved = entry.action.schedule.periods.map(p => p.subject)
  }
  return resolved
}

function weekSlot(...weeks) {
  return weeks
}

// [日, 一, 二, 三, 四, 五, 六]：周一第 1 节 2 周一换、第 3 节 3 周一换；周二无轮换
function legacyDailyClass() {
  const monday = [
    weekSlot('语', '英'),
    weekSlot('数'),
    weekSlot('物', '化', '政'),
    weekSlot('体')
  ]
  const tuesday = [weekSlot('数'), weekSlot('语')]
  return [
    { Chinese: '日', timetable: '常日', classList: [] },
    { Chinese: '一', timetable: '常日', classList: monday },
    { Chinese: '二', timetable: '常日', classList: tuesday },
    { Chinese: '三', timetable: '常日', classList: [] },
    { Chinese: '四', timetable: '常日', classList: [] },
    { Chinese: '五', timetable: '常日', classList: [] },
    { Chinese: '六', timetable: '常日', classList: [] }
  ]
}

test('lcmAll 忽略 0/1 并对多周期求最小公倍数', () => {
  assert.equal(lcmAll([2, 3]), 6)
  assert.equal(lcmAll([4, 6]), 12)
  assert.equal(lcmAll([1, 0, 3]), 3)
  assert.equal(lcmAll([]), 1)
})

test('dayCycleWeeks 只把长度 >= 2 的节算进周期', () => {
  assert.equal(dayCycleWeeks([{ no: 1, weeks: ['语'] }]), 1)
  assert.equal(dayCycleWeeks([{ no: 1, weeks: [] }]), 1)
  assert.equal(dayCycleWeeks([{ no: 1, weeks: ['语', '英'] }, { no: 2, weeks: ['物', '化', '政'] }]), 6)
})

test('expandPerDayRotation 按最小公倍数展开并限定星期', () => {
  const days = importFromClassList(legacyDailyClass())
  const { entries, errors } = expandPerDayRotation(days)
  assert.deepEqual(errors, [])
  // 只有周一有轮换：lcm(2, 3) = 6 条
  assert.equal(entries.length, 6)
  assert.equal(countExpandedEntries(days), 6)
  for (let week = 0; week < 6; week++) {
    const entry = entries[week]
    assert.deepEqual(entry.when, { kind: 'weekly', everyWeeks: 6, weekOffset: week, weekdays: [1] })
    assert.deepEqual(entry.action.schedule.periods.map(p => p.no), [1, 2, 3, 4])
  }
  assert.deepEqual(entries[0].action.schedule.periods.map(p => p.subject), ['语', '数', '物', '体'])
  assert.deepEqual(entries[1].action.schedule.periods.map(p => p.subject), ['英', '数', '化', '体'])
  assert.deepEqual(entries[2].action.schedule.periods.map(p => p.subject), ['语', '数', '政', '体'])
  assert.deepEqual(entries[3].action.schedule.periods.map(p => p.subject), ['英', '数', '物', '体'])
  assert.deepEqual(entries[4].action.schedule.periods.map(p => p.subject), ['语', '数', '化', '体'])
  assert.deepEqual(entries[5].action.schedule.periods.map(p => p.subject), ['英', '数', '政', '体'])
  assert.equal(isPeriodRotationEntry(entries[0]), true)
  assert.equal(isPeriodRotationEntry({ when: { kind: 'weekly', everyWeeks: 2, weekOffset: 0 }, action: { schedule: { periods: [] } } }), false)
})

test('展开结果与旧课表 ResolveClassList 逐周逐格一致', () => {
  const dailyClass = legacyDailyClass()
  const { entries } = expandPerDayRotation(importFromClassList(dailyClass))
  const monday = dailyClass[1].classList
  for (let week = 1; week <= 12; week++) {
    assert.deepEqual(resolveDayByEntries(entries, 1, week), resolveClassList(monday, week), '第 ' + week + ' 周周一')
    // 周二没有轮换条目，保持原课表
    assert.equal(resolveDayByEntries(entries, 2, week), null)
  }
})

test('保留空槽与单周节，节次数不变', () => {
  const dailyClass = legacyDailyClass()
  dailyClass[1].classList = [weekSlot('语', '英'), [], weekSlot('')]
  const { entries } = expandPerDayRotation(importFromClassList(dailyClass))
  assert.equal(entries.length, 2)
  assert.deepEqual(entries[0].action.schedule.periods.map(p => p.subject), ['语', '', ''])
  assert.deepEqual(entries[1].action.schedule.periods.map(p => p.subject), ['英', '', ''])
  assert.deepEqual(entries[0].action.schedule.periods.map(p => p.no), [1, 2, 3])
})

test('周期超过上限时拒绝该天并报错', () => {
  const days = [{ weekday: 1, periods: [
    { no: 1, weeks: ['a', 'b'] },
    { no: 2, weeks: ['a', 'b', 'c'] },
    { no: 3, weeks: ['a', 'b', 'c', 'd', 'e'] },
    { no: 4, weeks: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }
  ] }]
  const { entries, errors } = expandPerDayRotation(days)
  assert.equal(lcmAll([2, 3, 5, 7]), 210)
  assert.ok(lcmAll([2, 3, 5, 7]) > MAX_ROTATION_WEEKS)
  assert.deepEqual(entries, [])
  assert.deepEqual(errors, [{ weekday: 1, cycle: 210 }])
  assert.equal(countExpandedEntries(days), 0)
})

test('collapseEntriesToPerDay 往返后每周解析结果不变', () => {
  const first = expandPerDayRotation(importFromClassList(legacyDailyClass())).entries
  const collapsed = collapseEntriesToPerDay(first)
  assert.equal(collapsed.length, 1)
  assert.equal(collapsed[0].weekday, 1)
  assert.deepEqual(collapsed[0].periods.map(p => p.no), [1, 2, 3, 4])
  assert.equal(collapsed[0].periods[0].weeks.length, 6)
  const second = expandPerDayRotation(collapsed).entries
  for (let week = 1; week <= 12; week++) {
    assert.deepEqual(resolveDayByEntries(second, 1, week), resolveDayByEntries(first, 1, week), '第 ' + week + ' 周')
  }
})

test('collapseEntriesToPerDay 忽略非逐节轮换条目', () => {
  const days = [
    { weekday: 1, periods: [{ no: 1, weeks: ['语', '英'] }] },
    { weekday: 2, periods: [{ no: 1, weeks: ['数', '语'] }] }
  ]
  const entries = expandPerDayRotation(days).entries.concat([
    { when: { kind: 'weekly', everyWeeks: 2, weekOffset: 0 }, action: { schedule: { periods: [{ no: 1, subject: '物' }] } } },
    { when: { kind: 'date', date: '2026-09-01' }, action: { schedule: { periods: [{ no: 1, subject: '化' }] } } }
  ])
  const collapsed = collapseEntriesToPerDay(entries)
  assert.deepEqual(collapsed.map(day => day.weekday), [1, 2])
})

test('mergePeriodRotationEntries 替换旧的逐节轮换条目且不碰其它条目', () => {
  const plain = { when: { kind: 'weekly', everyWeeks: 2, weekOffset: 0 }, action: { schedule: { periods: [{ no: 1, subject: '物' }] } } }
  const dated = { when: { kind: 'date', date: '2026-09-01' }, action: { schedule: { periods: [{ no: 1, subject: '化' }] } } }
  const stale = expandPerDayRotation([{ weekday: 3, periods: [{ no: 1, weeks: ['语', '英', '数'] }] }]).entries
  const days = [{ weekday: 1, periods: [{ no: 1, weeks: ['语', '英'] }] }]
  const merged = mergePeriodRotationEntries([plain, ...stale, dated], days)
  assert.equal(merged.entries.length, 4)
  assert.deepEqual(merged.entries.slice(0, 2), [plain, dated])
  assert.deepEqual(merged.entries.slice(2).map(e => e.when.weekdays), [[1], [1]])
  assert.ok(merged.entries.every(e => isPeriodRotationEntry(e) || e === plain || e === dated))
})

test('带备注 / 停用 / 周期范围的条目不被逐节轮换视图接管', () => {
  const base = expandPerDayRotation([{ weekday: 1, periods: [{ no: 1, weeks: ['语', '英'] }] }]).entries[0]
  const clone = () => JSON.parse(JSON.stringify(base))
  const withNote = {...clone(), note: '手工备注'}
  const disabled = {...clone(), enabled: false}
  const dated = {...clone(), when: {...clone().when, startDate: '2026-09-01', endDate: '2026-10-01'}}
  assert.equal(isPeriodRotationEntry(base), true)
  assert.equal(isPeriodRotationEntry(withNote), false)
  assert.equal(isPeriodRotationEntry(disabled), false)
  assert.equal(isPeriodRotationEntry(dated), false)
  assert.deepEqual(collapseEntriesToPerDay([withNote, disabled, dated]), [])
  assert.deepEqual(mergePeriodRotationEntries([withNote, disabled, dated], []).entries, [withNote, disabled, dated])
})

test('importFromClassList 跳过没有轮换的天', () => {
  const days = importFromClassList(legacyDailyClass())
  assert.deepEqual(days.map(day => day.weekday), [1])
  assert.deepEqual(days[0].periods.map(p => p.no), [1, 2, 3, 4])
  assert.deepEqual(importFromClassList([]).length, 0)
  assert.deepEqual(importFromClassList([{ classList: [['语']] }]), [])
})
