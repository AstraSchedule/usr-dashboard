<script setup>
import {
  NButton,
  NCard,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NCode,
  NDataTable,
  NDatePicker,
  NFlex,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NStatistic,
  NTooltip,
  useMessage
} from 'naive-ui'
import {computed, h, reactive, ref} from 'vue'
import axios from 'axios'
import {APISRV} from '@/global.js'
import {useRequest} from 'vue-request'
import {useRoute} from 'vue-router'
import ConfirmPasswordModal from '@/components/ConfirmPasswordModal.vue'
import { confirmAction } from '@/api/auth.js'

const route = useRoute()
const school = computed(() => route.params.school)
const grade = computed(() => route.params.grade)
const formRef = ref(null)

// 编辑内部结构：
// timetables: [ { name: '常日', segments: [ { start:'00:00', end:'07:09', valueType:'text', text:'早自习', index:null }, { start:'07:10', end:'07:49', valueType:'index', index:0 } ], dividerInput: '0,4,7' } ]
// start: 时间戳 (NDatePicker 需要 number) —— 后端需要 YYYY-MM-DD 字符串
const dynamicForm = reactive({
  timetables: [
    {
      name: '常日',
      segments: [
        // 默认空，真实数据加载后替换
      ],
      dividerInput: ''
    }
  ],
  start: Date.now()
})

// ---------- 工具函数 ----------
function pad(n) { return n.toString().padStart(2, '0') }
function parseTime(str){
  if(!str) return null
  const m = str.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if(!m) return null
  return Number.parseInt(m[1])*60 + Number.parseInt(m[2])
}
function toHHMM(mins){
  if(mins<0) mins=0
  if(mins>1439) mins=1439
  const h = Math.floor(mins/60)
  const m = mins%60
  return pad(h)+":"+pad(m)
}

function dateToYMD(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function ymdToTs(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function buildPayload() {
  const timetableObj = {}
  const dividerObj = {}
  for (const t of dynamicForm.timetables) {
    if (!t.name) continue
    const segMap = {}
    for (const s of t.segments) {
      if (!s.start || !s.end) continue
      const range = `${s.start}-${s.end}`
      let val = null
      if (s.valueType === 'index') {
        if (s.index === '' || s.index === null || Number.isNaN(s.index)) continue
        val = Number(s.index)
      } else {
        if (!s.text) continue
        val = s.text
      }
      segMap[range] = val
    }
    timetableObj[t.name] = segMap
    // divider 解析
    dividerObj[t.name] = t.dividerInput.trim() === '' ? [] : t.dividerInput.split(',').map(x => Number(x.trim())).filter(x => !Number.isNaN(x))
  }
  return {
    timetable: timetableObj,
    divider: dividerObj,
    start: dateToYMD(dynamicForm.start)
  }
}

// ---------- 动态增删 ----------
const showCopyFromModal = ref(false)
const copyFromIndex = ref(0)

function openAddTimetable() {
  if (dynamicForm.timetables.length === 0) {
    // 没有模板，直接创建空的
    addTimetableDirect(0)
  } else {
    // 默认选第一个
    copyFromIndex.value = 0
    showCopyFromModal.value = true
  }
}

function confirmAddTimetable() {
  addTimetableDirect(copyFromIndex.value)
  showCopyFromModal.value = false
}

function addTimetableDirect(fromIdx) {
  const base = dynamicForm.timetables[fromIdx] || dynamicForm.timetables[0]
  const clonedSegments = base ? base.segments.map(s => ({
    start: s.start,
    end: s.end,
    valueType: s.valueType,
    text: s.text,
    index: s.index
  })) : []
  const clonedDivider = base ? base.dividerInput : ''
  dynamicForm.timetables.push({
    name: `新作息${dynamicForm.timetables.length + 1}`,
    segments: clonedSegments,
    dividerInput: clonedDivider
  })
  expandedTimetables.value.push(dynamicForm.timetables.length - 1)
  normalizeTimetable(dynamicForm.timetables[dynamicForm.timetables.length - 1], true)
}
function removeTimetable(idx) {
  dynamicForm.timetables.splice(idx, 1)
  expandedTimetables.value = expandedTimetables.value
    .filter(i => i !== idx)
    .map(i => i > idx ? i-1 : i)
}

function addSegment(timetable) {
  timetable.segments.push({
    start: '',
    end: '',
    valueType: 'text',
    text: '',
    index: null
  })
  normalizeTimetable(timetable, true)
}
function removeSegment(timetable, sIdx) {
  timetable.segments.splice(sIdx, 1)
  normalizeTimetable(timetable, true)
}

function createEmptySegment(){
  return { start:'', end:'', valueType:'text', text:'', index:null }
}
function insertSegmentAbove(timetable, idx){
  timetable.segments.splice(idx,0, createEmptySegment())
  normalizeTimetable(timetable, true)
}
function insertSegmentBelow(timetable, idx){
  timetable.segments.splice(idx+1,0, createEmptySegment())
  normalizeTimetable(timetable, true)
}

// ---------- 交互 ----------
const showModal = ref(false)
const saving = ref(false)
function submit() {
  if(!validateAll()) return;
  showModal.value = true
}

const messages = useMessage()

// ---------- 请求 ----------
async function okay(password) {
  saving.value = true
  try {
    const payload = buildPayload()
    await confirmAction(password, (cfg) =>
      axios.put(`${APISRV}/web/config/${school.value}/${grade.value}/timetable`, payload, cfg)
    )
    messages.success('服务端说行')
    showModal.value = false
  } catch (error) {
    if (error.status === 401) messages.error('你寻思寻思这密码它对吗？')
    else if (error.status === 400) messages.error('码姿不对，删了重写！（服务端校验不通过）')
    else if(error?.status === 403) messages.error('无权访问：有些门总是关着的')
    else messages.error(`服务端看完天塌了（状态码：${error}）`)
  } finally {
    saving.value = false
  }
}

const getTimetable = () => {
  return Promise.resolve(
    axios.get(`${APISRV}/web/config/${school.value}/${grade.value}/timetable`)
  )
}

useRequest(
  getTimetable,
  {
    refreshDeps: [school, grade],
    initialData: {
      timetable: {},
      divider: {},
      start: dateToYMD(Date.now())
    },
    onSuccess: (response) => {
      console.log(response.data)
      const data = response.data
      // start
      if (data.start) dynamicForm.start = ymdToTs(data.start)
      // timetables
      dynamicForm.timetables = []
      for (const name of Object.keys(data.timetable || {})) {
        const segs = data.timetable[name]
        const segments = []
        for (const range of Object.keys(segs)) {
          const [s, e] = range.split('-')
          const val = segs[range]
          if (typeof val === 'number') {
            segments.push({ start: s, end: e, valueType: 'index', index: val, text: '' })
          } else {
            segments.push({ start: s, end: e, valueType: 'text', text: val, index: null })
          }
        }
        // 排序：按开始时间
        segments.sort((a, b) => a.start.localeCompare(b.start))
        const dividerInput = (data.divider && data.divider[name]) ? data.divider[name].join(',') : ''
        dynamicForm.timetables.push({ name, segments, dividerInput })
      }
      // 常日排到最前面
      dynamicForm.timetables.sort((a, b) => {
        if (a.name === '常日') return -1
        if (b.name === '常日') return 1
        return 0
      })
      // 默认全部收起（expandedTimetables 为空即全部收起）
      expandedTimetables.value = []
      if (dynamicForm.timetables.length === 0) {
        dynamicForm.timetables.push({ name: '常日', segments: [], dividerInput: '' })
      }
    }
  }
)

// 预览
const preview = computed(() => JSON.stringify(buildPayload(), null, 2))

// ---------- 收起/展开 ----------
const expandedTimetables = ref([])

// ---------- 自动填充与校验 ----------
function normalizeTimetable(timetable, silent=false){
  const segs = timetable.segments
  // 只处理有合法 start 的段
  const valid = []
  for(const s of segs){
    const sm = parseTime(s.start)
    if(sm!==null){ valid.push({ seg:s, startM:sm }) }
  }
  valid.sort((a,b)=>a.startM-b.startM)
  if(valid.length===0) return { valid:true }
  if(valid[0].startM !== 0){
    valid[0].startM = 0
    valid[0].seg.start = '00:00'
    if(!silent) messages.info(`作息 ${timetable.name} 已将首段开始时间自动纠正为 00:00`)
  }
  let ok = true
  let errMsg = ''
  for(let i=0;i<valid.length;i++){
    const cur = valid[i]
    const next = valid[i+1]
    if(next){
      if(next.startM <= cur.startM){
        ok = false
        errMsg = `作息 ${timetable.name} 存在开始时间不递增 ( ${toHHMM(next.startM)} <= ${toHHMM(cur.startM)} )`
        break
      }
      cur.seg.end = toHHMM(next.startM - 1)
    } else {
      cur.seg.end = '23:59'
    }
  }
  if(!ok && !silent) messages.error(errMsg)
  // ---- 课程序号规范化 ----
  if(ok){
    const lessonSegs = valid.filter(v=>v.seg.valueType==='index')
    let changed = false
    for(let i=0;i<lessonSegs.length;i++){
      if(lessonSegs[i].seg.index !== i){
        lessonSegs[i].seg.index = i
        changed = true
      }
    }
    if(changed && !silent){
      messages.info(`作息 ${timetable.name} 课程序号已自动调整为 0~${lessonSegs.length-1}`)
    }
  }
  return { valid: ok, message: errMsg }
}
function onStartChange(timetable, seg, val){
  seg.start = val
  normalizeTimetable(timetable, true)
}
function onValueTypeChange(timetable){
  normalizeTimetable(timetable, true)
}
// 覆盖 submit：在显示弹窗前做全局校验
function validateAll(){
  let allOk = true
  for(const t of dynamicForm.timetables){
    const r = normalizeTimetable(t, false)
    if(!r.valid) allOk = false
  }
  return allOk
}

// ---------- 分隔线辅助 ----------
// divider 存储的是"课程序号"（0-based），不是行索引
// 需要在行索引和课程序号之间转换

// 行索引 → 课程序号（仅 valueType==='index' 的行才有课程序号）
function rowToLessonIndex(tb, rowIdx) {
  let lessonIdx = -1
  for (let i = 0; i <= rowIdx; i++) {
    if (tb.segments[i].valueType === 'index') {
      lessonIdx++
    }
  }
  return lessonIdx
}

// 课程序号 → 行索引
function lessonIndexToRow(tb, lessonIdx) {
  let count = -1
  for (let i = 0; i < tb.segments.length; i++) {
    if (tb.segments[i].valueType === 'index') {
      count++
      if (count === lessonIdx) return i
    }
  }
  return -1
}

function isDivider(tb, rowIdx) {
  if (!tb.dividerInput || tb.dividerInput.trim() === '') return false
  const arr = tb.dividerInput.split(',').map(x => Number(x.trim())).filter(x => !Number.isNaN(x))
  const lessonIdx = rowToLessonIndex(tb, rowIdx)
  return arr.includes(lessonIdx)
}

function toggleDivider(tb, rowIdx) {
  let arr = []
  if (tb.dividerInput && tb.dividerInput.trim() !== '') {
    arr = tb.dividerInput.split(',').map(x => Number(x.trim())).filter(x => !Number.isNaN(x))
  }
  const lessonIdx = rowToLessonIndex(tb, rowIdx)
  const idx = arr.indexOf(lessonIdx)
  if (idx >= 0) {
    arr.splice(idx, 1)
  } else {
    arr.push(lessonIdx)
    arr.sort((a, b) => a - b)
  }
  tb.dividerInput = arr.join(',')
}

// ---------- 表格列定义 ----------
function getSegmentColumns(tIdx) {
  const tb = dynamicForm.timetables[tIdx]
  return [
    {
      title: '#',
      key: '_idx',
      width: 50,
      align: 'center',
      render(row) { return row._idx + 1 }
    },
    {
      title: '开始时间',
      key: 'start',
      width: 120,
      render(row) {
        const seg = tb.segments[row._idx]
        return h(NInput, {
          value: seg.start,
          placeholder: '07:10',
          size: 'small',
          style: 'width: 90px;',
          onUpdateValue(val) { onStartChange(tb, seg, val) }
        })
      }
    },
    {
      title: '结束时间',
      key: 'end',
      width: 120,
      render(row) {
        const seg = tb.segments[row._idx]
        return h(NInput, {
          value: seg.end,
          disabled: true,
          placeholder: '自动',
          size: 'small',
          style: 'width: 90px;'
        })
      }
    },
    {
      title: '值类型',
      key: 'valueType',
      width: 140,
      render(row) {
        const seg = tb.segments[row._idx]
        return h(NRadioGroup, {
          value: seg.valueType,
          size: 'medium',
          onUpdateValue() {
            seg.valueType = seg.valueType === 'text' ? 'index' : 'text'
            onValueTypeChange(tb)
          }
        }, {
          default: () => [
            h(NRadioButton, { value: 'text' }, { default: () => '文本' }),
            h(NRadioButton, { value: 'index' }, { default: () => '课程序号' })
          ]
        })
      }
    },
    {
      title: '值',
      key: 'value',
      width: 180,
      render(row) {
        const seg = tb.segments[row._idx]
        if (seg.valueType === 'text') {
          return h(NInput, {
            value: seg.text,
            placeholder: '早自习 / 课间',
            size: 'small',
            onUpdateValue(val) { seg.text = val }
          })
        } else {
          return h(NInputNumber, {
            value: seg.index,
            disabled: true,
            placeholder: '自动',
            size: 'small',
            style: 'width: 90px;'
          })
        }
      }
    },
    {
      title: '在此之后插入分隔线',
      key: 'divider',
      width: 70,
      align: 'center',
      render(row) {
        const seg = tb.segments[row._idx]
        if (seg.valueType !== 'index') return '-'
        return h(NCheckbox, {
          checked: isDivider(tb, row._idx),
          onUpdateChecked() { toggleDivider(tb, row._idx) }
        })
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      align: 'center',
      render(row) {
        return h(NSpace, { justify: 'center', size: 12 }, {
          default: () => [
            h(NTooltip, null, {
              trigger: () => h(NButton, { size: 'large', text: true, onClick: () => insertSegmentAbove(tb, row._idx) }, { default: () => '↑' }),
              default: () => '在上方插入'
            }),
            h(NTooltip, null, {
              trigger: () => h(NButton, { size: 'large', text: true, onClick: () => insertSegmentBelow(tb, row._idx) }, { default: () => '↓' }),
              default: () => '在下方插入'
            }),
            h(NPopconfirm, {
              onPositiveClick: () => removeSegment(tb, row._idx),
              negativeText: '取消',
              positiveText: '确认'
            }, {
              trigger: () => h(NButton, { size: 'large', text: true, type: 'error' }, { default: () => '删除' }),
              default: () => '确认删除此段？'
            })
          ]
        })
      }
    }
  ]
}
</script>

<template>
  <NFlex vertical>
    <NCard title="所选信息">
      <NFlex justify="center">
        <NCard class="stat">
          <NStatistic label="所选学校" :value="school.toString()" />
        </NCard>
        <NCard class="stat">
          <NStatistic label="所选年级" :value="grade.toString()" />
        </NCard>
      </NFlex>
    </NCard>

    <NCard title="配置表单">
      <n-form ref="formRef" :model="dynamicForm">
        <n-form-item label="开学日期">
          <NDatePicker v-model:value="dynamicForm.start" type="date" style="width: 200px;" />
        </n-form-item>
      </n-form>

      <NCollapse v-model:expanded-names="expandedTimetables" accordion>
        <NCollapseItem v-for="(tb, tIdx) in dynamicForm.timetables" :key="tIdx" :name="tIdx">
          <template #header>
            <div class="collapse-header">
              <NInput v-model:value="tb.name" placeholder="作息名称" style="width: 200px;" @click.stop />
              <span class="segment-count">{{ tb.segments.length }} 段</span>
              <NPopconfirm
                v-if="dynamicForm.timetables.length > 1 && tb.name !== '常日'"
                @positive-click="removeTimetable(tIdx)"
                negative-text="取消"
                positive-text="确认"
              >
                <template #trigger>
                  <NButton size="small" type="error" text @click.stop>删除</NButton>
                </template>
                确认删除此作息模板？
              </NPopconfirm>
            </div>
          </template>

          <NDataTable
            :columns="getSegmentColumns(tIdx)"
            :data="tb.segments.map((seg, sIdx) => ({ ...seg, _idx: sIdx }))"
            :bordered="true"
            :single-line="false"
            size="small"
            class="segment-table"
          />

          <NButton dashed type="primary" size="small" @click="addSegment(tb)" style="margin-top: 8px;">
            + 增加时间段
          </NButton>
        </NCollapseItem>
      </NCollapse>

      <NButton type="primary" dashed @click="openAddTimetable" style="margin-top: 16px;">
        + 增加作息模板
      </NButton>

      <div class="submit-area">
        <n-button type="primary" @click="submit">提交</n-button>
      </div>
    </NCard>

    <NCard title="提交前预览">
      <n-code :code="preview" language="json" show-line-numbers />
    </NCard>

    <ConfirmPasswordModal
      v-model:show="showModal"
      :loading="saving"
      title="你是入吗？"
      confirm-text="确认提交"
      @confirm="okay"
    />
    <NModal v-model:show="showCopyFromModal" preset="dialog" title="从哪个模板复制？">
      <div style="padding: 8px 0;">
        <NSelect
          v-model:value="copyFromIndex"
          :options="dynamicForm.timetables.map((t, i) => ({ label: t.name, value: i }))"
          placeholder="选择模板"
        />
      </div>
      <template #action>
        <NButton type="primary" @click="confirmAddTimetable">确认</NButton>
      </template>
    </NModal>
  </NFlex>
</template>

<style scoped>
.collapse-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
}

.segment-count {
    font-size: 12px;
    opacity: 0.5;
    margin-left: 8px;
}

.segment-table {
    margin-bottom: 8px;
}

.submit-area {
    display: flex;
    justify-content: center;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--n-border-color, #e0e0e6);
}
</style>
