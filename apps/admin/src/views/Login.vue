<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <h2 style="margin-top: 0">AI优选零食 · 管理后台</h2>
      <p class="muted">演示账号：admin / admin123</p>
      <el-form :model="form" @submit.prevent="submit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="账号" size="large" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="submit">登录</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { reportError } from '../composables/async';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
// 演示提示留在页面上，但不预填真实密码
const form = reactive({ username: '', password: '' });

/** 登录后回被拦下的地址；只接受站内路径，防止 ?redirect= 把人带去站外 */
const redirect = computed(() => {
  const target = route.query.redirect;
  const value = typeof target === 'string' ? target : '';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
});

async function submit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入账号和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    ElMessage.success('登录成功');
    await router.replace(redirect.value);
  } catch (error) {
    reportError(error, '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #1f2d3d, #3a5169);
}
.login-card {
  width: 380px;
  padding: 12px;
}
</style>
