<script setup>
import {h, ref} from 'vue'
import {NButton, NCard, NDataTable, NSpace, NTag, useMessage} from 'naive-ui'
import {useRequest} from 'vue-request'
import {useRouter} from 'vue-router'
import axios from 'axios'
import {getAPISRV} from '@/global.js'
import {AutorunType, getAutorunTypeLabel, listTasks, summarizeEntries} from '@/api/autorun.js'
import ScopeTags from '@/components/ScopeTags.vue'
import ConfirmPasswordModal from '@/components/ConfirmPasswordModal.vue'
import { confirmAction } from '@/api/auth.js'

// 排序：生效中 > 待生效 > 已过期；生效中内部按优先级降序，其他保持原顺序
function sortAutorunRows(list) {
  const order = {'生效中': 0, '待生效': 1, '已过期': 2}
  return (Array.isArray(list) ? list : [])
      .map((r, i) => ({__i: i, ...r}))
      .sort((a, b) => {
        const sa = order[a.status] ?? 9
        const sb = order[b.status] ?? 9
        if (sa !== sb) return sa - sb
        // 生效中内部按优先级降序
        if (sa === 0) return (Number(b.priority) || 0) - (Number(a.priority) || 0)
        // 其他状态按原顺序
        return a.__i - b.__i
      })
      .map(({__i, ...r}) => r)
}

const router = useRouter()
const message = useMessage()

const rows = ref([])
const { run, loading } = useRequest(listTasks, {
  manual: false,
  onSuccess: (res) => {
    const data = res?.data ?? []
    rows.value = sortAutorunRows(data)
  },
  onError: (e) => { console.error('[autorun] 获取失败', e); rows.value = [] }
})

const statusTypeMap = { '待生效': 'warning', '生效中': 'success', '已过期': 'error' }
// 颜色映射：兼容数值/字符串两种 type 表达
const typeTypeMapNum = {
  [AutorunType.COMPENSATION]: 'warning',
  [AutorunType.TIMETABLE]: 'info',
  [AutorunType.SCHEDULE]: 'success',
  [AutorunType.ALL]: 'default',
  [AutorunType.CLIENT_CONFIG]: 'primary'
}
const typeTypeMapStr = {
  'COMPENSATION': 'warning', 'TIMETABLE': 'info', 'SCHEDULE': 'success',
  'ALL': 'default', 'CLIENT_CONFIG': 'primary'
}

function getTypeLabelFlexible(type) {
  if (typeof type === 'number') return getAutorunTypeLabel(type)
  const map = {COMPENSATION: '调休', TIMETABLE: '作息表调整', SCHEDULE: '课程表调整', ALL: '全部调整', CLIENT_CONFIG: '客户端配置'}
  return map[type] || String(type)
}

function renderPriorityTag(priority) { return h(NTag, { size: 'small', bordered: false }, { default: () => String(priority) }) }

function renderType(type) {
  const color = typeof type === 'number' ? (typeTypeMapNum[type] || 'default') : (typeTypeMapStr[type] || 'default')
  const label = getTypeLabelFlexible(type)
  return h(NTag, {size: 'small', bordered: false, type: color}, {default: () => label})
}

function onEdit(row) {
  router.push(`/autorun/edit/${row.id}`)
}

// 删除逻辑（需密码）
const showDelete = ref(false)
const deleting = ref(false)
const deleteId = ref('')

function askDelete(row) {
  deleteId.value = row.id;
  showDelete.value = true
}

async function doDelete(password) {
  if(!deleteId.value) return
  deleting.value = true
  try {
    await confirmAction(password, (cfg) =>
      axios.delete(`${getAPISRV()}/web/autorun/${deleteId.value}`, cfg)
    )
    message.success('已删除')
    showDelete.value = false
    deleteId.value = ''
    run()
  } catch (e) {
    const status = e?.status || e?.response?.status
    if (status === 401) message.error('你寻思寻思这密码它对吗？')
    else if (status === 400) message.error('码姿不对，删了重写！（服务端校验不通过）')
    else if(status === 403) message.error('无权访问：有些门总是关着的')
    else message.error(`服务端看完天塌了（状态码：${status??'未知'}）`)
  } finally {
    deleting.value = false
  }
}

function renderName(row) {
  return row.name
      ? h('span', {}, row.name)
      : h('span', {style: 'color:#888'}, '未命名任务')
}

function renderEntryCount(row) {
  const n = Array.isArray(row.entries) ? row.entries.length : 1
  return h(NTag, {size: 'small', bordered: false}, {default: () => `${n} 条`})
}

function renderStatus(row) {
  if (row.enabled === false) {
    return h(NTag, {type: 'default', size: 'small', bordered: false}, {default: () => '已停用'})
  }
  const type = statusTypeMap[row.status] || 'default';
  return h(NTag, {type, size: 'small', bordered: false}, {default: () => row.status})
}

const columns = [
  {title: '名称', key: 'name', ellipsis: {tooltip: true}, render: (row) => renderName(row), width: 160},
  {title: '类型', key: 'type', render: (row) => renderType(row.type), width: 130},
  {title: '生效域', key: 'scope', render: (row) => h(ScopeTags, {scopes: row.scope})},
  {title: '内容', key: 'entries', ellipsis: {tooltip: true}, render: (row) => summarizeEntries(row)},
  {title: '条目', key: 'entryCount', align: 'center', width: 80, render: (row) => renderEntryCount(row)},
  {title: '优先级', key: 'priority', align: 'center', width: 90, render: (row) => renderPriorityTag(row.priority)},
  {title: '状态', key: 'status', align: 'center', width: 100, render: (row) => renderStatus(row)},
  {
    title: '快捷操作', key: 'actions', align: 'center', width: 160, render: (row) => h(NSpace, {justify: 'center'}, {
      default: () => [
      h(NButton, { size: 'small', tertiary: true, onClick: () => onEdit(row) }, { default: () => '修改' }),
      h(NButton, { size: 'small', tertiary: true, type: 'error', onClick: () => askDelete(row) }, { default: () => '删除' })
    ] }) }
]

function refresh() { run() }

function goAdd() {
  router.push('/autorun/add')
}
</script>

<template>
  <n-card :bordered="false" title="自动任务状态概览">
    <template #header-extra>
      <n-space>
        <n-button size="small" @click="goAdd">新增</n-button>
        <n-button size="small" @click="refresh" :loading="loading">刷新</n-button>
      </n-space>
    </template>

    <n-data-table :columns="columns" :data="rows" :loading="loading" :pagination="false" />

    <confirm-password-modal
        :loading="deleting"
        :show="showDelete"
        confirm-text="确认删除"
        title="删除确认"
        @confirm="doDelete"
        @update:show="val=> showDelete = val"
    />
  </n-card>
</template>

<style scoped>
:deep(.n-data-table th) {
    font-weight: 600;
}

:deep(.n-data-table td) {
    padding: var(--spacing-sm) var(--spacing-md);
}
</style>
