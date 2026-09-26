<template>
  <!-- 🤔 -->
  <n-config-provider :theme="theme" date-locale="dateZhCN" locale="zhCN" class="full" :hljs="hljs">
    <n-message-provider class="full">
      <n-dialog-provider class="full">
        <n-space vertical class="full">
          <n-layout has-sider style="height: 100vh">
            <n-layout-sider
              bordered
              collapse-mode="width"
              :collapsed-width="64"
              :width="240"
              :collapsed="collapsed"
              show-trigger
              @collapse="collapsed = true"
              @expand="collapsed = false"
              class="app-sider"
            >
              <div class="sider-logo" :class="{ 'collapsed': collapsed }">
                <img src="https://static.khbit.cn/2026/09/b179a9ca48077ef92e5aea63c3bfa080.png" alt="Logo" class="logo-img" />
                <span v-if="!collapsed" class="logo-text">星程课表</span>
              </div>
              <n-menu
                v-model:value="activeKey"
                :collapsed="collapsed"
                :collapsed-width="64"
                :collapsed-icon-size="22"
                :options="menuOptions"
              />
              <div style="padding: 8px; margin-top: auto;">
                <div v-if="userInfo.username"
                  style="margin: 0 8px 8px; padding: 10px 12px; border-radius: 8px; background: var(--n-card-color); border: 1px solid var(--n-border-color);">
                  <n-space align="center" :size="8">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--n-primary-color); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 14px; font-weight: 600; flex-shrink: 0;">
                      {{ userInfo.username.charAt(0).toUpperCase() }}
                    </div>
                    <div style="min-width: 0;">
                      <div style="font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3;">{{ userInfo.username }}</div>
                      <n-tag :type="userInfo.role === 'admin' ? 'warning' : 'info'" size="tiny" :bordered="false" round>{{ roleLabelMap[userInfo.role] || userInfo.role }}</n-tag>
                    </div>
                  </n-space>
                </div>
                <n-button block quaternary size="small" @click="handleLogout">退出登录</n-button>
              </div>
            </n-layout-sider>
            <n-layout style="padding: 16px">
              <n-alert
                  v-if="showInitServerEntry"
                  style="margin-bottom: 12px"
                  title="检测到服务端尚未配置学校/年级/班级"
                  type="warning"
              >
                当前 menu 中没有可用的学校班级配置，请先初始化服务端。
                <template #action>
                  <n-button size="small" type="primary" @click="openInitModal">
                    初始化服务器
                  </n-button>
                </template>
              </n-alert>
              <router-view></router-view>
            </n-layout>
          </n-layout>
        </n-space>
      </n-dialog-provider>
    </n-message-provider>

    <n-modal v-model:show="showInitModal" preset="dialog" title="初始化服务器">
      <n-form label-placement="top">
        <n-form-item label="学校">
          <n-input v-model:value="initForm.school" placeholder="例如：实验中学"/>
        </n-form-item>
        <n-form-item label="年级">
          <n-input v-model:value="initForm.grade" placeholder="例如：高一"/>
        </n-form-item>
        <n-form-item label="班级">
          <n-input v-model:value="initForm.cls" placeholder="例如：1班"/>
        </n-form-item>
        <n-form-item label="管理员密码">
          <n-input v-model:value="initForm.password" placeholder="用于 Basic Auth" show-password-on="click"
                   type="password"/>
        </n-form-item>
        <n-form-item label="初始化请求体（JSON，可按需修改）">
          <n-input
              v-model:value="initForm.bodyText"
              :autosize="{ minRows: 12, maxRows: 20 }"
              placeholder="参考 InitSrv.http 的 JSON"
              type="textarea"
          />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button :loading="initLoading" type="primary" @click="submitInitServer">
          提交初始化
        </n-button>
      </template>
    </n-modal>
  </n-config-provider>

</template>

<script setup>
import {computed, h, reactive, ref, provide, watch} from "vue";
import {
  darkTheme,
  NAlert,
  NButton,
  NConfigProvider,
  NDialogProvider,
  NForm,
  NFormItem,
  NInput,
  NLayout,
  NLayoutSider,
  NMenu,
  NMessageProvider,
  NModal,
  NSpace,
  useOsTheme
} from "naive-ui";
import {RouterLink, useRouter} from "vue-router";
import {useRequest} from "vue-request";
import axios from "axios";
import {getAPISRV} from "@/global.js";
import {getToken, removeToken, isLoggedIn, getUserInfo, setUserInfo, removeUserInfo} from "@/auth.js";
import hljs from 'highlight.js/lib/core'

const router = useRouter()

axios.interceptors.request.use(config => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 密码错误的 401 不是会话失效：detail 对应 usr-backend VerifyPassword「密码错误」
// 与 JWTAndPassword「需要提供密码」「你寻思寻思这密码它对吗？」（均表示验密失败而非令牌过期）。
// 若一并登出，密码管理器填充竞态提交空/错密码就会被概率性踢回登录页（#60）。
const PASSWORD_ERROR_DETAILS = new Set([
  '密码错误',
  '需要提供密码',
  '你寻思寻思这密码它对吗？'
])

axios.interceptors.response.use(
  resp => resp,
  error => {
    const detail = error?.response?.data?.detail
    if (error?.response?.status === 401 && !PASSWORD_ERROR_DETAILS.has(detail)) {
      removeToken()
      router.replace('/login')
    }
    return Promise.reject(error)
  }
)

const osThemeRef = useOsTheme();
let theme = computed(() => osThemeRef.value === "dark" ? darkTheme : null);
const message = console;

const roleLabelMap = {admin: '管理员', readonly: '只读', school_w: '校写入', grade_w: '级写入', class_w: '班写入'}
const userInfo = ref(getUserInfo())

// 如果有 token 但没有 userInfo，从 API 获取
if (isLoggedIn() && !userInfo.value.username) {
  axios.get(`${getAPISRV()}/web/auth/me`)
    .then(resp => { setUserInfo(resp.data); userInfo.value = resp.data })
    .catch(() => {})
}

// 路由变化时刷新 userInfo（登录后跳转时触发）
watch(() => router.currentRoute.value.path, () => {
  if (isLoggedIn()) {
    axios.get(`${getAPISRV()}/web/auth/me`)
      .then(resp => { setUserInfo(resp.data); userInfo.value = resp.data })
      .catch(() => {})
  }
})

function pad(n) {
  return n.toString().padStart(2, '0');
}

function ymd(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildDefaultInitBody() {
  return {
    subject_name: {
      "自": "自习",
      "英": "英语",
      "语": "语文",
      "体": "体育",
      "数": "数学",
      "史": "历史",
      "政": "政治",
      "班": "班会",
      "物": "物理",
      "化": "化学",
      "课": "课程"
    },
    timetable: {
      "常日": {
        "00:00-00:00": 0,
        "00:01-23:59": "尽量不要在部署阶段修改，最好通过 Web 端来修改"
      },
      "没课": {
        "00:00-00:00": 0,
        "00:01-23:59": "没课 q(≧▽≦q)"
      }
    },
    divider: {
      "常日": [],
      "没课": []
    },
    start: ymd(Date.now()),
    countdown_target: "hidden",
    weather_alert_override: true,
    weather_alert_brief: true,
    week_display: true,
    banner_text: "",
    css_style: {
      "--center-font-size": "30px",
      "--corner-font-size": "14px",
      "--countdown-font-size": "28px",
      "--global-border-radius": "16px",
      "--global-bg-opacity": "0.3",
      "--container-bg-padding": "8px 14px",
      "--countdown-bg-padding": "5px 12px",
      "--container-space": "16px",
      "--top-space": "16px",
      "--main-horizontal-space": "8px",
      "--divider-width": "2px",
      "--divider-margin": "6px",
      "--triangle-size": "16px",
      "--sub-font-size": "20px",
      "--banner-height": "30px"
    },
    daily_class: [
      {
        "Chinese": "日",
        "English": "SUN",
        "classList": ["课"],
        "timetable": "没课"
      },
      {
        "Chinese": "一",
        "English": "MON",
        "classList": ["课"],
        "timetable": "常日"
      },
      {
        "Chinese": "二",
        "English": "TUE",
        "classList": ["课"],
        "timetable": "常日"
      },
      {
        "Chinese": "三",
        "English": "WED",
        "classList": ["课"],
        "timetable": "常日"
      },
      {
        "Chinese": "四",
        "English": "THR",
        "classList": ["课"],
        "timetable": "常日"
      },
      {
        "Chinese": "五",
        "English": "FRI",
        "classList": ["课"],
        "timetable": "常日"
      },
      {
        "Chinese": "六",
        "English": "SAT",
        "classList": ["课"],
        "timetable": "没课"
      }
    ]
  };
}

const showInitServerEntry = ref(false);
const showInitModal = ref(false);
const initLoading = ref(false);
const initForm = reactive({
  school: '',
  grade: '',
  cls: '',
  password: '',
  bodyText: JSON.stringify(buildDefaultInitBody(), null, 2)
});

function hasSchoolGradeClassMenu(rawList) {
  const queue = Array.isArray(rawList) ? [...rawList] : [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (typeof node.to === 'string' && /^\/config\/[^/]+\/[^/]+\/[^/]+\//.test(node.to)) {
      return true;
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      queue.push(...node.children);
    }
  }
  return false;
}
// noinspection JSUnusedGlobalSymbols
let menuOptions = ref(
    [
        {
            label: () => h(
              RouterLink,
              {
                to: {
                  name: "Home"
                }
              },
              { default: () => "总览" }
            ),
            key: "go-back-home"
        },
        {
            label: () => h(
              RouterLink,
              {
                to: {
                  name: "Users"
                }
              },
              { default: () => "用户管理" }
            ),
            key: "users"
        }
    ]
);

// 直接请求，无需 setTimeout 包装，避免 Promise 嵌套潜在问题
const getMenu = () => axios.get(`${getAPISRV()}/web/menu`);

function resolveMenuItem(menuItem) {
    if (!menuItem) return null;
    // 递归处理数组
    if (Array.isArray(menuItem)) return menuItem.map(resolveMenuItem).filter(Boolean);
    const childrenSrc = menuItem.children;
    const resolvedChildren = Array.isArray(childrenSrc) && childrenSrc.length > 0 ? resolveMenuItem(childrenSrc) : undefined;
    if (typeof menuItem['to'] !== 'string') {
        console.warn('[menu] 菜单项缺少 to 字段，忽略', menuItem);
        return {
          key: menuItem['key'],
          children: resolvedChildren,
          label: menuItem['text']
        };
    }
    return {
        label: () => h(
            RouterLink,
            { to: menuItem['to'] },
            { default: () => menuItem['text'] }
        ),
        key: menuItem['key'],
        children: resolvedChildren
    };
}

function updateMenuFromResponse(response) {
  try {
    const payload = response?.data;
    const rawList = payload?.data;
    if (!Array.isArray(rawList)) {
      console.warn('[menu] 响应 data.data 不是数组，保持原菜单');
      return;
    }
    showInitServerEntry.value = !hasSchoolGradeClassMenu(rawList);
    const menu = rawList.map(d => resolveMenuItem(d)).filter(Boolean);
    if (menu.length === 0) {
      console.warn('[menu] 解析后为空，保留原菜单');
      return;
    }
    menuOptions.value = menu;
  } catch (e) {
    console.error('[menu] 解析失败', e);
  }
}

function openInitModal() {
  initForm.bodyText = JSON.stringify(buildDefaultInitBody(), null, 2);
  showInitModal.value = true;
}

async function submitInitServer() {
  if (!initForm.school || !initForm.grade || !initForm.cls) {
    message.warn('请完整填写学校/年级/班级');
    return;
  }
  if (!initForm.password) {
    message.warn('请输入管理员密码');
    return;
  }
  let payload;
  try {
    payload = JSON.parse(initForm.bodyText);
  } catch (e) {
    message.error('初始化请求体不是合法 JSON：', e);
    return;
  }

  initLoading.value = true;
  try {
    const encodedSchool = encodeURIComponent(initForm.school);
    const encodedGrade = encodeURIComponent(initForm.grade);
    const encodedCls = encodeURIComponent(initForm.cls);
    await axios.put(
        `${getAPISRV()}/${encodedSchool}/${encodedGrade}/${encodedCls}`,
        payload,
        {
          headers: { 'X-Verify-Password': initForm.password }
        }
    );
    message.log('初始化成功，正在刷新菜单');
    showInitModal.value = false;
    initForm.password = '';

    const response = await getMenu();
    updateMenuFromResponse(response);
  } catch (error) {
    const status = error?.response?.status;
    const detail = error?.response?.data?.detail || error?.response?.data?.error || '';
    if (status === 401) {
      message.error('鉴权失败：管理员密码不正确');
    } else if (status === 400 || status === 404) {
      message.error(detail || `初始化失败（${status}）`);
    } else {
      message.error(`初始化失败（${status || 'unknown'}）`);
    }
  } finally {
    initLoading.value = false;
  }
}

useRequest(
    getMenu,
    {
      initialData: {
        data: [
          {
            to: '/',
            text: '总览',
            key: 'go-back-home',
            children: []
          }
        ]
      },
      onSuccess: (response) => {
        updateMenuFromResponse(response);
      },
      onError: (e) => {
        console.error('[menu] 获取失败', e);
      }
    }
);

// 暴露刷新菜单方法给子组件
const refreshMenu = () => {
  getMenu().then(updateMenuFromResponse).catch(e => console.error('[menu] 刷新失败', e));
};
provide('refreshMenu', refreshMenu);

let activeKey =  ref(null), collapsed = ref(false)

function handleLogout() {
  removeToken()
  removeUserInfo()
  userInfo.value = {}
  router.replace('/login')
}
</script>

<style scoped>
.sider-logo {
    display: flex;
    align-items: center;
    padding: var(--spacing-md);
    gap: var(--spacing-sm);
    border-bottom: 1px solid var(--n-border-color, #e0e0e6);
    margin-bottom: var(--spacing-sm);
    overflow: hidden;
    white-space: nowrap;
}

.sider-logo.collapsed {
    justify-content: center;
    padding: var(--spacing-md) var(--spacing-sm);
}

.logo-img {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
}

.logo-text {
    font-size: 16px;
    font-weight: 600;
    opacity: 1;
}

.sider-logo.collapsed .logo-text {
    opacity: 0;
    width: 0;
}
</style>
