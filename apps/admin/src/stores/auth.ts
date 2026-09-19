import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api';
import { NICKNAME_KEY, TOKEN_KEY } from '../api/http';

export const useAuthStore = defineStore('auth', () => {
  // localStorage 只在这里读写：路由守卫、请求头、布局页统一看 store
  const token = ref(localStorage.getItem(TOKEN_KEY) || '');
  const nickname = ref(localStorage.getItem(NICKNAME_KEY) || '');
  const isLoggedIn = computed(() => token.value.length > 0);

  async function login(username: string, password: string) {
    const data = await api.login(username, password);
    token.value = data.token;
    nickname.value = data.user.nickname;
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(NICKNAME_KEY, data.user.nickname);
  }

  /** 唯一的登出入口：清 store + 清存储；跳转交给调用方（router）决定 */
  function logout() {
    token.value = '';
    nickname.value = '';
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NICKNAME_KEY);
  }

  return { token, nickname, isLoggedIn, login, logout };
});
