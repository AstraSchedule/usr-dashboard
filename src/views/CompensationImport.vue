<script setup>
import { computed, ref } from 'vue'
import { useRequest } from 'vue-request'
import { useMessage, NButton, NCard, NForm, NFormItem, NInputNumber, NSelect } from 'naive-ui'
import { AutorunType, ConditionKind, fetchCompYearPairs, fetchScopeTree, flattenScope, saveTask } from '@/api/autorun.js'
import { applyDisabledToScopeOptions, normalizeScopes } from '@/utils/scope.js'
import ConfirmPasswordModal from '@/components/ConfirmPasswordModal.vue'

const message = useMessage()

const scopeSelectOptions = ref([])
useRequest(fetchScopeTree, {
  manual: false,
  onSuccess: (res) => { scopeSelectOptions.value = flattenScope(res?.data || []) },
  onError: (e) => { console.warn('[scope] 获取失败', e); scopeSelectOptions.value = [] }
})

const scope = ref([])
const importYear = ref(new Date().getFullYear())
const importAllScope = ref(true)
const importing = ref(false)
const showPwd = ref(false)

// 必须用 computed：scope 树是异步拉的，setup 里一次性 map 会永远 NoData
const computedScopeOptions = computed(() =>
  applyDisabledToScopeOptions(scopeSelectOptions.value, scope.value)
)

function onScopeChange(v) {
  scope.value = normalizeScopes(v)
}

function buildImportScope() {
  if (importAllScope.value) return ['ALL']
  return Array.isArray(scope.value) ? scope.value : []
}

// 一整年的调休是「一个任务 + N 条条目」，不再逐条创建规则刷屏
function buildImportPayload(pairs, scopePayload, year) {
  return {
    name: year + ' 年调休',
    type: AutorunType.COMPENSATION,
    scope: scopePayload,
    priority: 0,
    enabled: true,
    entries: pairs.map(p => ({
      id: 'comp-' + p.workday,
      enabled: true,
      when: { kind: ConditionKind.DATE, date: p.workday },
      action: { useDate: p.holiday }
    }))
  }
}

function openImport() {
  if (!importAllScope.value && (!Array.isArray(scope.value) || scope.value.length === 0)) {
    message.warning('请选择生效域或勾选使用 ALL')
    return
  }
  showPwd.value = true
}

async function doImport(password) {
  importing.value = true
  try {
    const { data } = await fetchCompYearPairs(importYear.value)
    const pairs = (Array.isArray(data?.pairs) ? data.pairs : []).filter(p => p?.holiday && p?.workday)
    if (pairs.length === 0) { message.warning('该年无调休数据'); return }

    await saveTask(buildImportPayload(pairs, buildImportScope(), importYear.value), password)
    message.success('已导入 ' + pairs.length + ' 条调休条目（单个任务）')
    showPwd.value = false
  } catch (e) {
    const status = e?.status || e?.response?.status
    const detail = e?.response?.data?.detail
    if (status === 401) message.error('密码错误，已终止导入')
    else if (status === 400) message.error(detail || '服务端校验不通过')
    else if (status === 403) message.error('无权访问：有些门总是关着的')
    else if (!status) console.error(e)
    else message.error('导入失败（状态码：' + status + '）')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <n-card title="导入全年调休" :bordered="false">
    <n-form label-placement="left" label-width="120">
      <n-form-item label="年份">
        <n-input-number v-model:value="importYear" :show-button="false" :min="1970" :max="2100" />
      </n-form-item>
      <n-form-item label="生效域">
        <n-select v-model:value="scope" multiple tag :options="computedScopeOptions" placeholder="选择生效范围，可多选" @update:value="onScopeChange" />
      </n-form-item>
      <n-form-item label="使用 ALL">
        <n-select v-model:value="importAllScope" :options="[{ label: '是（推荐）', value: true }, { label: '否（使用上方生效域）', value: false }]" />
      </n-form-item>
      <n-form-item>
        <n-button type="primary" :loading="importing" @click="openImport">开始导入</n-button>
      </n-form-item>
    </n-form>

    <div style="font-size:12px;color:#888;margin-top:12px;">
      将创建 <b>一个</b> 名为「&lt;年份&gt; 年调休」的任务，调休数据中的每个 workday/holiday 对应任务内的一条条目（date=workday，useDate=holiday），整份数据一次提交。
    </div>
  </n-card>

  <confirm-password-modal
    :loading="importing"
    :show="showPwd"
    confirm-text="开始导入"
    title="导入全年调休"
    @confirm="doImport"
    @update:show="val => showPwd = val"
  />
</template>

<style scoped>
/* compensation import */
</style>
