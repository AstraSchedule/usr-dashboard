<script setup>
import {computed, ref} from 'vue'
import {useRouter} from 'vue-router'
import {NAutoComplete, NButton, NCard, NForm, NFormItem, NInput, NSpace, useMessage, useOsTheme} from 'naive-ui'
import {useRequest} from 'vue-request'
import {login} from '@/api/auth.js'
import {setToken, setUserInfo} from '@/auth.js'
import {getServer, setServer} from '@/global.js'
import IcpFiling from '@/components/IcpFiling.vue'

const router = useRouter()
const message = useMessage()
const osTheme = useOsTheme()

const form = ref({server: getServer(), username: '', password: ''})

// 自动补全建议
const serverOptions = computed(() => {
  const val = form.value.server
  if (!val) return []
  if (val.includes('.')) return []
  return [
    val + '.getastra.cn',
    'http://localhost:9000',
  ]
})

const {loading, run} = useRequest(() => login(form.value.username, form.value.password, form.value.server), {
  manual: true,
  onSuccess: (data) => {
    setServer(form.value.server)
    setToken(data.token)
    setUserInfo(data.user || {})
    if (data.must_change_pwd) {
      message.warning('首次登录请修改密码')
      router.replace('/change-password')
    } else {
      router.replace('/')
    }
  },
  onError: (e) => {
    message.error(e?.response?.data?.detail || '登录失败')
  }
})

function handleLogin() {
  if (loading.value) return
  if (!form.value.username || !form.value.password) {
    message.warning('请输入用户名和密码')
    return
  }
  run()
}

function windowOpen(url) {
  window.open(url, '_blank')
}
</script>

<template>
  <div class="login-wrapper" :class="{ dark: osTheme === 'dark' }">
    <n-card title="星程课表 - 登录" class="login-card">
      <n-space vertical size="large">
        <n-form label-placement="left">
          <n-form-item label="后端地址">
            <n-auto-complete v-model:value="form.server" :disabled="loading" :options="serverOptions" placeholder="例如：aaa-do.getastra.cn" @keyup.enter="handleLogin"/>
          </n-form-item>
          <n-form-item label="用户名">
            <n-input v-model:value="form.username" :disabled="loading" placeholder="请输入用户名" @keyup.enter="handleLogin"/>
          </n-form-item>
          <n-form-item label="密码">
            <n-input v-model:value="form.password" :disabled="loading" type="password" show-password-on="click" placeholder="请输入密码" @keyup.enter="handleLogin"/>
          </n-form-item>
        </n-form>
        <n-button type="primary" block :loading="loading" :disabled="loading" @click="handleLogin">登录</n-button>
        <n-button block :disabled="loading" @click="windowOpen('https://go.getastra.cn')">注册</n-button>
      </n-space>
    </n-card>
    <IcpFiling class="login-icp" />
  </div>
</template>

<style scoped>
.login-wrapper {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f5f5f5;
}
.login-icp {
  margin-top: 16px;
}
.login-wrapper.dark {
  background: #18181c;
}
.login-card {
  width: 400px;
}
</style>
