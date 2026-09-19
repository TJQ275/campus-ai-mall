import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../layouts/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '数据概览', icon: 'DataLine' } },
      { path: 'ai/logs', name: 'ai-logs', component: () => import('../views/AiLogs.vue'), meta: { title: 'AI 调用日志', icon: 'MagicStick' } },
      { path: 'ai/conversations', name: 'ai-conversations', component: () => import('../views/AiConversations.vue'), meta: { title: 'AI 会话回放', icon: 'ChatDotRound' } },
      { path: 'ai/knowledge', name: 'knowledge', component: () => import('../views/Knowledge.vue'), meta: { title: 'AI 知识库', icon: 'Notebook' } },
      { path: 'products', name: 'products', component: () => import('../views/Products.vue'), meta: { title: '商品管理', icon: 'Goods' } },
      { path: 'orders', name: 'orders', component: () => import('../views/Orders.vue'), meta: { title: '订单管理', icon: 'List' } },
      { path: 'after-sales', name: 'after-sales', component: () => import('../views/AfterSales.vue'), meta: { title: '售后管理', icon: 'RefreshLeft' } },
      { path: 'users', name: 'users', component: () => import('../views/Users.vue'), meta: { title: '用户管理', icon: 'User' } },
    ],
  },
];

const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach((to) => {
  const token = localStorage.getItem('campus_token');
  if (!to.meta.public && !token) return { path: '/login' };
  return true;
});

export default router;
