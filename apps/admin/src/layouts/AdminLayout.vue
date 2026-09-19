<template>
  <el-container style="min-height: 100vh">
    <el-aside width="220px" style="background: #1f2d3d">
      <div class="brand">AI优选零食</div>
      <el-menu
        :default-active="route.path"
        router
        background-color="#1f2d3d"
        text-color="#c0c4cc"
        active-text-color="#67c23a"
      >
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="topbar">
        <div>
          <span class="muted">当前模式：</span>
          <el-tag v-if="aiMode.mock" type="warning" size="small">本地演示模式（未配置大模型 Key）</el-tag>
          <el-tag v-else type="success" size="small">{{ aiMode.model }}</el-tag>
        </div>
        <div>
          <span class="muted" style="margin-right: 12px">{{ auth.nickname }}</span>
          <el-button size="small" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type AiStats } from '../api';
import { menus } from '../router';
import { runAction } from '../composables/async';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const aiMode = ref<AiStats['mode']>({ provider: '', model: 'mock', mock: true, embedding: '' });

function logout() {
  // 登录态清理走 store，跳转交给 router，不再各自改一份状态
  auth.logout();
  void runAction(async () => {
    await router.push('/login');
  }, '退出失败');
}

onMounted(async () => {
  try {
    const stats = await api.aiStats(1);
    aiMode.value = stats.mode;
  } catch {
    /* 顶部状态拿不到不影响使用 */
  }
});
</script>

<style scoped>
.brand {
  color: #fff;
  font-weight: 700;
  padding: 18px 20px;
  font-size: 16px;
  letter-spacing: 1px;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
}
</style>
