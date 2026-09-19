import type { Component } from 'vue';
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { ChatDotRound, DataLine, Goods, Key, List, MagicStick, Notebook, RefreshLeft, Setting, User } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    /** 侧边菜单标题；不填就不进菜单 */
    title?: string;
    /** 菜单图标直接给组件，避免用字符串名时写错静默渲染成空白 */
    icon?: Component;
    /** 免登录页面 */
    public?: boolean;
    /** 有 title 但不进菜单 */
    hidden?: boolean;
  }
}

/** 后台主框架下的页面：侧边菜单直接由这张表生成，标题与图标只维护一份 */
const layoutRoutes: RouteRecordRaw[] = [
  { path: 'dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '数据概览', icon: DataLine } },
  { path: 'ai/logs', name: 'ai-logs', component: () => import('../views/AiLogs.vue'), meta: { title: 'AI 调用日志', icon: MagicStick } },
  { path: 'ai/conversations', name: 'ai-conversations', component: () => import('../views/AiConversations.vue'), meta: { title: 'AI 会话回放', icon: ChatDotRound } },
  { path: 'ai/knowledge', name: 'knowledge', component: () => import('../views/Knowledge.vue'), meta: { title: 'AI 知识库', icon: Notebook } },
  { path: 'ai/settings', name: 'ai-settings', component: () => import('../views/Settings.vue'), meta: { title: 'AI 设置', icon: Setting } },
  { path: 'products', name: 'products', component: () => import('../views/Products.vue'), meta: { title: '商品管理', icon: Goods } },
  { path: 'orders', name: 'orders', component: () => import('../views/Orders.vue'), meta: { title: '订单管理', icon: List } },
  { path: 'after-sales', name: 'after-sales', component: () => import('../views/AfterSales.vue'), meta: { title: '售后管理', icon: RefreshLeft } },
  { path: 'users', name: 'users', component: () => import('../views/Users.vue'), meta: { title: '用户管理', icon: User } },
  { path: 'login-logs', name: 'login-logs', component: () => import('../views/LoginLogs.vue'), meta: { title: '登录记录', icon: Key } },
  { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('../views/NotFound.vue'), meta: { title: '页面不存在', hidden: true } },
];

export interface MenuItem {
  path: string;
  title: string;
  icon?: Component;
}

export const menus: MenuItem[] = layoutRoutes.flatMap((route) => {
  const { title, icon, hidden } = route.meta ?? {};
  return title && !hidden ? [{ path: '/' + route.path, title, icon }] : [];
});

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true, title: '登录' } },
  { path: '/', component: () => import('../layouts/AdminLayout.vue'), redirect: '/dashboard', children: layoutRoutes },
];

const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach((to) => {
  // 登录态只看 store；守卫不再单独读 localStorage
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isLoggedIn) {
    // 记住被拦下的地址，登录后原路返回
    return { path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
  }
  if (auth.isLoggedIn && to.path === '/login') return { path: '/dashboard' };
  return true;
});

export default router;