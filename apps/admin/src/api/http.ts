import axios from 'axios';
import { ElMessage } from 'element-plus';

export const http = axios.create({ baseURL: '/api', timeout: 60000 });

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('campus_token');
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});

http.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data;
      ElMessage.error(body.message || '请求失败');
      return Promise.reject(new Error(body.message));
    }
    return body;
  },
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;
    if (status === 401) {
      localStorage.removeItem('campus_token');
      if (location.hash.indexOf('/login') === -1) location.hash = '#/login';
    }
    ElMessage.error(message || '网络异常');
    return Promise.reject(error);
  },
);

export function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.get(url, { params }) as unknown as Promise<T>;
}

export function post<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

export function patch<T>(url: string, data?: unknown): Promise<T> {
  return http.patch(url, data) as unknown as Promise<T>;
}

export function del<T>(url: string): Promise<T> {
  return http.delete(url) as unknown as Promise<T>;
}
