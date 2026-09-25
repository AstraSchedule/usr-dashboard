<script setup>
import {ref, watch} from 'vue'
import {NButton, NInput, NModal, NSpace, useMessage} from 'naive-ui'

const props = defineProps({
  show: {type: Boolean, default: false},
  title: {type: String, default: '你是入吗？'},
  confirmText: {type: String, default: '确认'},
  loading: {type: Boolean, default: false}
})
const emit = defineEmits(['update:show', 'confirm'])

const message = useMessage()
const pwd = ref('')
watch(() => props.show, (v) => {
  if (!v) pwd.value = ''
})

function onConfirm() {
  // 密码管理器自动回车可能先于填充/在请求在途时触发：空值与重复提交均直接拦截，
  // 避免空密码请求打到后端触发 401 踢登录（#60）
  if (props.loading) return
  if (!pwd.value) {
    message.warning('请输入密码')
    return
  }
  emit('confirm', pwd.value)
}
</script>

<template>
  <n-modal :show="props.show" :title="props.title" preset="dialog" @update:show="val=>emit('update:show', val)">
    <n-space vertical size="large">
      <div style="color: var(--text-secondary);">此操作需要密码</div>
      <n-input v-model:value="pwd" clearable placeholder="输入密码" type="password" :input-props="{ autocomplete: 'current-password' }" @keyup.enter="onConfirm" />
    </n-space>
    <template #action>
      <n-button :loading="props.loading" type="primary" @click="onConfirm">{{ props.confirmText }}</n-button>
    </template>
  </n-modal>
</template>
