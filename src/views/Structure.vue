<script setup>
import {ref, onMounted} from 'vue'
import {
  NButton, NCard, NEmpty, NInput, NModal, NSpace, NText, useMessage
} from 'naive-ui'
import axios from 'axios'
import {APISRV} from '@/global.js'
import {createSchool, deleteSchool, createGrade, deleteGrade, createClass, deleteClass} from '@/api/structure.js'
import {verifyPassword} from '@/api/auth.js'

const message = useMessage()
const tree = ref([])

async function refreshTree() {
  try {
    const resp = await axios.get(`${APISRV}/web/structure`)
    tree.value = resp.data || []
  } catch (e) {
    // 读取失败时退化为空树（界面显示「暂无数据」，用户可手动刷新重试），同时留日志便于排查
    console.warn('[structure] 结构树获取失败', e)
    tree.value = []
  }
}
onMounted(refreshTree)

const showModal = ref(false)
const modalType = ref('school')
const modalParent = ref('')
const modalName = ref('')
const modalLoading = ref(false)
const pwdShow = ref(false)
const pwdLoading = ref(false)
const pwdInput = ref('')
const savedPwd = ref('')
let pendingFn = null

function openCreate(type, parent = '', pwd = '') {
  modalType.value = type
  modalParent.value = parent
  modalName.value = ''
  showModal.value = true
  // 链式创建：记住密码，创建时跳过验证
  savedPwd.value = pwd
}

function doCreate() {
  if (!modalName.value.trim()) { message.warning('名称不能为空'); return }
  const go = (pwd) => {
    modalLoading.value = true
    const cfg = {headers: {'X-Verify-Password': pwd}}
    const p = modalParent.value
    const createdName = modalName.value
    let fn
    if (modalType.value === 'school') {
      fn = createSchool(createdName, cfg)
    } else if (modalType.value === 'grade') {
      fn = createGrade(p, createdName, cfg)
    } else {
      fn = createClass(p.split('/')[0], p.split('/')[1], createdName, cfg)
    }
    fn.then(() => {
      message.success('创建成功')
      showModal.value = false
      refreshTree()
      if (modalType.value === 'school') {
        setTimeout(() => openCreate('grade', createdName, pwd), 300)
      } else if (modalType.value === 'grade') {
        setTimeout(() => openCreate('class', p + '/' + createdName, pwd), 300)
      }
    })
    .catch(e => message.error(e?.response?.data?.detail || '创建失败'))
    .finally(() => { modalLoading.value = false })
  }
  // 已有验证过的密码则直接执行，否则弹出密码验证
  if (savedPwd.value) {
    go(savedPwd.value)
  } else {
    pendingFn = go
    pwdShow.value = true
  }
}

function onPwdConfirm(pwd) {
  pwdLoading.value = true
  savedPwd.value = pwd
  verifyPassword(pwd).then(() => pendingFn?.(pwd)).catch(() => message.error('你寻思寻思这密码它对吗？')).finally(() => { pwdLoading.value = false; pwdShow.value = false })
}

function doDelete(type, ...args) {
  pendingFn = (pwd) => {
    const cfg = {headers: {'X-Verify-Password': pwd}}
    let fn
    if (type === 'school') {
      fn = deleteSchool(args[0], cfg)
    } else if (type === 'grade') {
      fn = deleteGrade(args[0], args[1], cfg)
    } else {
      fn = deleteClass(args[0], args[1], args[2], cfg)
    }
    fn.then(() => { message.success('删除成功'); refreshTree() }).catch(e => message.error(e?.response?.data?.detail || '删除失败'))
  }
  pwdShow.value = true
}
</script>

<template>
  <n-card title="结构管理" :bordered="false">
    <template #header-extra>
      <n-button type="primary" size="small" @click="openCreate('school')">新增学校</n-button>
    </template>

    <div v-if="tree.length" style="display: flex; flex-direction: column; gap: 16px;">
      <div v-for="school in tree" :key="school.text"
        style="border: 1px solid var(--n-border-color); border-radius: 8px; overflow: hidden;">
        <!-- 学校 -->
        <div style="padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; background: var(--n-card-color);">
          <n-space align="center" :size="8">
            <n-text strong style="font-size: 15px;">{{ school.text }}</n-text>
            <n-text depth="3" style="font-size: 12px;">{{ (school.children || []).length }} 个年级</n-text>
          </n-space>
          <n-space :size="4">
            <n-button size="tiny" type="success" @click="openCreate('grade', school.text)">新增年级</n-button>
            <n-button size="tiny" type="error" quaternary @click="doDelete('school', school.text)">删除学校</n-button>
          </n-space>
        </div>
        <!-- 年级 -->
        <div v-if="school.children?.length" style="border-top: 1px solid var(--n-border-color);">
          <div v-for="grade in school.children" :key="grade.text"
            style="border-bottom: 1px solid var(--n-border-color);"
            :style="school.children.indexOf(grade) === school.children.length - 1 ? 'border-bottom: none;' : ''">
            <!-- 年级行 -->
            <div style="padding: 10px 16px 10px 32px; display: flex; justify-content: space-between; align-items: center; background: var(--n-card-color);">
              <n-space align="center" :size="6">
                <n-text strong style="font-size: 14px;">{{ grade.text }}</n-text>
                <n-text depth="3" style="font-size: 12px;">{{ (grade.children || []).length }} 个班级</n-text>
              </n-space>
              <n-space :size="4">
                <n-button size="tiny" type="success" @click="openCreate('class', school.text + '/' + grade.text)">新增班级</n-button>
                <n-button size="tiny" type="error" quaternary @click="doDelete('grade', school.text, grade.text)">删除年级</n-button>
              </n-space>
            </div>
            <!-- 班级 -->
            <div v-if="grade.children?.length" style="border-top: 1px solid var(--n-border-color); background: var(--n-card-color);">
              <div v-for="(cls, idx) in grade.children" :key="cls.text"
                style="padding: 8px 16px 8px 56px; display: flex; justify-content: space-between; align-items: center; font-size: 13px;"
                :style="idx < grade.children.length - 1 ? 'border-bottom: 1px solid var(--n-border-color);' : ''">
                <n-text>{{ cls.text }}</n-text>
                <n-button size="tiny" type="error" quaternary @click="doDelete('class', school.text, grade.text, cls.text)">删除</n-button>
              </div>
            </div>
            <div v-else style="padding: 8px 16px 8px 56px; font-size: 13px;">
              <n-text depth="3">暂无班级</n-text>
            </div>
          </div>
        </div>
        <div v-else style="padding: 12px 16px 12px 32px; font-size: 13px;">
          <n-text depth="3">暂无年级</n-text>
        </div>
      </div>
    </div>

    <n-empty v-else description="暂无学校数据" style="padding: 40px 0;">
      <template #extra>
        <n-button size="small" @click="openCreate('school')">创建第一个学校</n-button>
      </template>
    </n-empty>
  </n-card>

  <n-modal v-model:show="showModal" preset="dialog" @update:show="v => { if (!v) savedPwd = '' }"
    :title="modalType === 'school' ? '新增学校' : modalType === 'grade' ? '新增年级' : '新增班级'">
    <n-form label-placement="left">
      <n-form-item :label="modalType === 'school' ? '学校名称' : modalType === 'grade' ? '年级名称' : '班级名称'">
        <n-input v-model:value="modalName" :placeholder="modalType === 'school' ? '例如：实验中学' : modalType === 'grade' ? '例如：高一' : '例如：1班'" @keyup.enter="doCreate"/>
      </n-form-item>
    </n-form>
    <template #action>
      <n-button :loading="modalLoading" type="primary" @click="doCreate">创建</n-button>
    </template>
  </n-modal>

  <n-modal v-model:show="pwdShow" preset="dialog" title="验证身份">
    <n-space vertical>
      <div style="color: var(--n-text-color-3);">此操作需要密码确认</div>
      <n-input v-model:value="pwdInput" type="password" show-password-on="click" placeholder="输入密码" @keyup.enter="onPwdConfirm(pwdInput)"/>
    </n-space>
    <template #action>
      <n-button :loading="pwdLoading" type="primary" @click="onPwdConfirm(pwdInput)">确认</n-button>
    </template>
  </n-modal>
</template>
