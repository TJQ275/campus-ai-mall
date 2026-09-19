import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('campus_token') || '');
  const nickname = ref(localStorage.getItem('campus_nickname') || '');

  async function login(username: string, password: string) {
    const data = await api.login(username, password);
    token.value = data.token;
    nickname.value = data.user.nickname;
    localStorage.setItem('campus_token', data.token);
    localStorage.setItem('campus_nickname', data.user.nickname);
  }

  function logout() {
    token.value = '';
    nickname.value = '';
    localStorage.removeItem('campus_token');
    localStorage.removeItem('campus_nickname');
  }

  return { token, nickname, login, logout };
});
