<script setup>
import {h, ref, watch} from 'vue'
import {
  NButton, NCard, NCascader, NDataTable, NForm, NFormItem, NInput, NModal, NSelect, NSpace, NTag, NSwitch, useMessage
} from 'naive-ui'
import {useRequest} from 'vue-request'
import axios from 'axios'
import {APISRV} from '@/global.js'
import {listUsers, createUser, updateUser, deleteUser, verifyPassword} from '@/api/auth.js'

const message = useMessage()

const roleOptions = [
  {label: '管理员', value: 'admin'},
  {label: '只读', value: 'readonly'},
  {label: '校写入', value: 'school_w'},
  {label: '级写入', value: 'grade_w'},
  {label: '班写入', value: 'class_w'}
]
const roleLabelMap = {admin: '管理员', readonly: '只读', school_w: '校写入', grade_w: '级写入', class_w: '班写入'}
const roleTypeMap = {admin: 'error', readonly: 'default', school_w: 'warning', grade_w: 'info', class_w: 'success'}

const users = ref([])
const rawScopeTree = ref([])
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref(null)
const form = ref({username: '', password: '', role: 'class_w', scope: '', must_change_pwd: true, must_change_username: false})
let skipScopeReset = false

// NOSONAR: 页面组件引入顶层 await 会被要求 Suspense 包裹，这里保留 promise 链
axios.get(`${APISRV}/web/structure`).then(r => { rawScopeTree.value = r.data || [] }).catch(e => { console.warn('[users] 结构树获取失败', e) })

const {loading: listLoading, run: fetchUsers} = useRequest(listUsers, {
  manual: false,
  onSuccess: (data) => { users.value = Array.isArray(data?.data) ? data.data : [] },
  onError: (e) => { message.error(e?.response?.data?.detail || '获取用户列表失败') }
})

// 树数据处理
const treeData = ref([])
const filteredTreeData = ref([])

function mapTreeNode(n, parentKey) {
  const key = parentKey ? parentKey + '/' + n.text : n.text
  const node = {value: key, label: n.text}
  if (n.children?.length) node.children = n.children.map(c => mapTreeNode(c, key))
  return node
}

function buildTreeData(tree) {
  return (tree || []).map(s => mapTreeNode(s, ''))
}

function filterTreeByRole(tree, role) {
  if (!tree.length || !role || role === 'admin' || role === 'readonly') return []
  function filter(node, depth) {
    const copy = {...node, children: undefined}
    if (node.children?.length) {
      if (role === 'school_w') return copy
      if (role === 'grade_w' && depth >= 1) return copy
      copy.children = node.children.map((c, i) => filter(c, depth + 1)).filter(Boolean)
    }
    return copy
  }
  return tree.map(n => filter(n, 0)).filter(Boolean)
}

watch(rawScopeTree, (tree) => {
  treeData.value = buildTreeData(tree)
  filteredTreeData.value = filterTreeByRole(treeData.value, form.value.role)
}, {immediate: true})

watch(() => form.value.role, (role) => {
  if (!skipScopeReset) form.value.scope = ''
  skipScopeReset = false
  filteredTreeData.value = filterTreeByRole(treeData.value, role)
})

const columns = [
  {title: 'ID', key: 'id', width: 60},
  {title: '用户名', key: 'username'},
  {title: '角色', key: 'role', width: 100, render(row) { return h(NTag, {type: roleTypeMap[row.role] || 'default', bordered: false}, {default: () => roleLabelMap[row.role] || row.role}) }},
  {title: '作用域', key: 'scope'},
  {title: '需改密', key: 'must_change_pwd', width: 80, render(row) { return row.must_change_pwd ? h(NTag, {type: 'warning', bordered: false}, {default: () => '是'}) : h(NTag, {type: 'success', bordered: false}, {default: () => '否'}) }},
  {title: '操作', key: 'actions', width: 160, render(row) { return h(NSpace, {}, {default: () => [h(NButton, {size: 'small', onClick: () => openEdit(row)}, {default: () => '编辑'}), h(NButton, {size: 'small', type: 'error', onClick: () => doDelete(row)}, {default: () => '删除'})]}) }}
]

const {loading: saveLoading, run: runSave} = useRequest(() => {
  if (isEdit.value) {
    const p = {
      username: form.value.username,
      role: form.value.role,
      scope: form.value.scope,
      must_change_pwd: form.value.must_change_pwd,
      must_change_username: form.value.must_change_username
    }
    // 密码留空表示不修改：只有填了才带上该字段
    if (form.value.password) {
      p.password = form.value.password
    }
    return updateUser(editId.value, p)
  }
  return createUser({username: form.value.username, password: form.value.password, role: form.value.role, scope: form.value.scope, must_change_pwd: form.value.must_change_pwd, must_change_username: form.value.must_change_username})
}, { manual: true, onSuccess: () => { message.success(isEdit.value ? '用户更新成功' : '用户创建成功'); showModal.value = false; fetchUsers() }, onError: (e) => { message.error(e?.response?.data?.detail || '操作失败') } })

const {run: runDelete} = useRequest((row) => deleteUser(row.id), { manual: true, onSuccess: () => { message.success('用户已删除'); fetchUsers() }, onError: (e) => { message.error(e?.response?.data?.detail || '删除失败') } })

const deleteModalShow = ref(false)
const deletePwd = ref('')
const deleteLoading = ref(false)
const deleteRow = ref(null)

function doDelete(row) { deleteRow.value = row; deletePwd.value = ''; deleteModalShow.value = true }
function onDeleteConfirm(pwd) {
  deleteLoading.value = true
  verifyPassword(pwd).then(() => runDelete(deleteRow.value)).catch(() => message.error('你寻思寻思这密码它对吗？')).finally(() => { deleteLoading.value = false; deleteModalShow.value = false })
}

function openCreate() { isEdit.value = false; editId.value = null; form.value = {username: '', password: '', role: 'class_w', scope: '', must_change_pwd: true, must_change_username: false}; showModal.value = true }
function openEdit(row) {
  isEdit.value = true; editId.value = row.id
  skipScopeReset = true
  form.value = {username: row.username, password: '', role: row.role, scope: row.scope || '', must_change_pwd: row.must_change_pwd || false, must_change_username: row.must_change_username || false}
  showModal.value = true
}
function handleSave() { if (!isEdit.value && (!form.value.username || !form.value.password)) { message.warning('用户名和密码不能为空'); return } runSave() }
</script>

<template>
  <n-card title="用户管理">
    <template #header-extra><n-button type="primary" @click="openCreate">新增用户</n-button></template>
    <n-data-table :columns="columns" :data="users" :loading="listLoading" :bordered="false"/>
  </n-card>
  <n-modal v-model:show="showModal" preset="dialog" :title="isEdit ? '编辑用户' : '新增用户'">
    <n-form label-placement="left">
      <n-form-item label="用户名"><n-input v-model:value="form.username" placeholder="用户名"/></n-form-item>
      <n-form-item label="密码"><n-input v-model:value="form.password" type="password" show-password-on="click" :placeholder="isEdit ? '留空不修改' : '至少 6 位'"/></n-form-item>
      <n-form-item label="角色"><n-select v-model:value="form.role" :options="roleOptions"/></n-form-item>
      <n-form-item label="作用域" v-if="form.role !== 'admin' && form.role !== 'readonly'">
        <n-cascader v-model:value="form.scope" :options="filteredTreeData" expand-trigger="click" check-strategy="child" show-path :placeholder="form.role === 'school_w' ? '请选择学校' : form.role === 'grade_w' ? '请选择年级' : '请选择班级'" clearable/>
      </n-form-item>
      <n-form-item label="强制改密"><n-switch v-model:value="form.must_change_pwd"/></n-form-item>
      <n-form-item label="允许改名" v-if="form.must_change_pwd"><n-switch v-model:value="form.must_change_username"/></n-form-item>
    </n-form>
    <template #action><n-button :loading="saveLoading" type="primary" @click="handleSave">{{ isEdit ? '保存' : '创建' }}</n-button></template>
  </n-modal>
  <n-modal v-model:show="deleteModalShow" preset="dialog" title="验证身份">
    <n-space vertical>
      <div style="color: var(--n-text-color-3);">此操作需要密码确认</div>
      <n-input v-model:value="deletePwd" type="password" show-password-on="click" placeholder="输入密码" @keyup.enter="onDeleteConfirm(deletePwd)"/>
    </n-space>
    <template #action><n-button :loading="deleteLoading" type="error" @click="onDeleteConfirm(deletePwd)">确认删除</n-button></template>
  </n-modal>
</template>
