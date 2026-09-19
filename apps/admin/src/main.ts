import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import App from './App.vue';
import router from './router';
import { configureHttp } from './api/http';
import { useAuthStore } from './stores/auth';
import './style.css';

// Element Plus 组件与样式已按需引入（见 vite.config.ts）。
// 组件默认英文，这里用一个无渲染的 ConfigProvider 包住整个应用挂上中文包。
const app = createApp({
  render: () => h(ElConfigProvider, { locale: zhCn }, { default: () => h(App) }),
});

app.use(createPinia());
app.use(router);

const auth = useAuthStore();
configureHttp({
  getToken: () => auth.token,
  // 401 统一走 store 登出 + 路由跳转：不做 location.hash 跳转，保留原地址以便登录后回来
  onUnauthorized: () => {
    const current = router.currentRoute.value;
    auth.logout();
    if (current.path !== '/login') {
      router.push({ path: '/login', query: { redirect: current.fullPath } });
    }
  },
});

app.mount('#app');
