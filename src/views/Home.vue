<script setup>
import {useRequest} from 'vue-request';
import {
  NButton,
  NCard,
  NDataTable,
  NFlex,
  NResult,
  NSpin,
  NStatistic,
  NTag,
  useThemeVars
} from 'naive-ui';
import axios from 'axios';
import {computed, h, reactive, ref} from "vue";
import gsap from 'gsap';
import {APISRV} from '../global.js'
import {getToken} from '../auth.js'

const isServerless = ref(false);
const isInitialLoading = ref(true);
const hitokoto = ref({ content: '', from: '' });
const showHitokoto = ref(false);

const columns = [
  {
      title: '班级',
      key: 'name',
      defaultSortOrder: false,
      sorter: 'default'
  },
  {
      title: '连接状态',
      key: 'status',
      defaultSortOrder: false,
      sorter: 'default',
      render(row) {
          return h(
                NTag,
                {
                    style: {
                        marginRight: '6px'
                    },
                    type: row.status === '已断开连接' ? "error" : 'success',
                    bordered: false
                },
                {
                    default: () => row.status
                }
            )

      }
  },
  {
      title: '今日异常断连次数',
      key: 'disconnect',
      defaultSortOrder: false,
      sorter: (row1, row2) => row1.disconnect - row2.disconnect
  }
]
const getStatistic = () => axios.get(`${APISRV}/web/statistic`, { headers: { Authorization: `Bearer ${getToken()}` } });
const getHitokoto = () => axios.get('https://v1.hitokoto.cn/');
const refreshHitokoto = () => {
    hitokoto.value = { content: '', from: '' };
    getHitokoto().then(response => {
        hitokoto.value = { content: response.data.hitokoto, from: response.data.from || '' };
    }).catch(() => {
        hitokoto.value = { content: '人生如逆旅，我亦是行人。', from: '' };
    });
};
const statInfo = reactive(
    {
        "weather_error":0,
        "websocket_disconnect":{},
        "clients":[],
        "websocket_disconnect_count": 0,
        "clients_count": 0
    }
);

let statTable = ref([]);
// noinspection JSCheckFunctionSignatures
const { cancel } = useRequest(
    getStatistic,
    {
      pollingInterval: 1000,
      initialData: {
          "weather_error": 0,
          "websocket_disconnect": {},
          "clients": [],
          "websocket_disconnect_count": 0,
          "clients_count": 0
      },
      onSuccess: (response) => {
        isInitialLoading.value = false;
        if (response.data.serverless) {
          isServerless.value = true;
          cancel();
          getHitokoto().then(response => {
            hitokoto.value = { content: response.data.hitokoto, from: response.data.from || '' };
          }).catch(() => {
            hitokoto.value = { content: '人生如逆旅，我亦是行人。', from: '' };
          });
          return;
        }
        let statMap = {};
        statTable.value = []
        console.log(response.data);
        gsap.to(statInfo, {
          "weather_error": response.data["weather_error"],
          "websocket_disconnect": response.data["websocket_disconnect_count"],
          "clients": response.data["clients_count"]
        });
        // noinspection JSCheckFunctionSignatures
        for (let [key, value] of Object.entries(response.data["websocket_disconnect"])) {
            statMap[key] = ["已断开连接", value];
        }
        for (let [, name] of Object.entries(response.data["clients"])) {
            if (statMap[name])
                statMap[name][0] = "保持连接";
            else
                statMap[name] = ["保持连接", 0];
        }
        for (let [keys, value] of Object.entries(statMap)) {
            statTable.value.push(
                {
                    key: keys,
                    name: keys,
                    status: value[0],
                    disconnect: value[1]
                }
            )
        }
        console.log(statTable);
      }
    }
);
const weatherError = computed(() => {
    return Number.parseInt(statInfo.weather_error).toLocaleString();
});
const wsDisconnect = computed(() => {
    return Number.parseInt(statInfo.websocket_disconnect).toLocaleString();
});
const clientsCount = computed(() => {
    // noinspection JSCheckFunctionSignatures
    return Number.parseInt(statInfo.clients).toLocaleString();
});
useThemeVars();


</script>

<template>
    <div class="home-container">
        <div v-if="isInitialLoading" class="centered">
            <n-spin size="large">
                <div style="padding: 50px; text-align: center; color: var(--text-tertiary);">
                    正在获取数据...
                </div>
            </n-spin>
        </div>
        <div v-else-if="isServerless" class="centered">
            <NResult
                v-if="!showHitokoto"
                status="418"
                title="星程课表 | AstraSchedule"
                description="星辰落旧室，星程起新程"
            >
                <template #icon>
                    <img src="https://cn-nb1.rains3.com/kuohublog-images/2026/09/b179a9ca48077ef92e5aea63c3bfa080.png" alt="星程课表" style="width: 80px; height: 80px;" />
                </template>
                <template #footer>
                    <NButton @click="showHitokoto = true; refreshHitokoto()">换一句</NButton>
                </template>
            </NResult>
            <NResult
                v-else
                status="418"
                :title="hitokoto.content || '正在获取一言...'"
                :description="hitokoto.content ? (hitokoto.from ? `—— ${hitokoto.from} ——` : '') : '请求数据中...'"
            >
                <template #footer>
                    <NButton @click="showHitokoto = false">返回</NButton>
                </template>
            </NResult>
        </div>
        <div v-else class="content">
            <NCard title="今日统计">
                <NFlex justify="center">
                    <NCard class="stat">
                      <NStatistic label="天气上游 API 响应错误" :value="weatherError"/>
                    </NCard>
                    <NCard class="stat">
                      <NStatistic label="WebSocket 异常断连" :value="wsDisconnect"/>
                    </NCard>
                    <NCard class="stat">
                     <NStatistic label="正在连接的客户端数量" :value="clientsCount"/>
                    </NCard>
                </NFlex>
            </NCard>
            <NCard title="各班详情">
                <n-data-table
                  ref="dataTableInst"
                  :columns="columns"
                  :data="statTable"
                />
            </NCard>
        </div>
    </div>
</template>

<style scoped>
.home-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
}

.centered {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
}

.content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
}

.stat {
    max-width: 300px;
    min-width: 200px;
    border-radius: var(--radius-lg) !important;
}

.stat :deep(.n-statistic__label) {
    font-size: 13px;
}

.stat :deep(.n-statistic__value) {
    font-size: 28px;
    font-weight: 600;
}

.stat :deep(.n-card__content) {
    padding: var(--spacing-lg);
}
</style>
