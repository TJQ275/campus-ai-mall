import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

/** 存储键只在这里定义，读写一律经过 auth store */
export const TOKEN_KEY = 'campus_token';
export const NICKNAME_KEY = 'campus_nickname';

export const http = axios.create({ baseURL: '/api', timeout: 60000 });

/** 记录每个请求实际带出去的 token，用来判断 401 是否来自过期请求 */
interface AuthConfig extends InternalAxiosRequestConfig {
  authToken?: string;
}

let getToken: () => string = () => '';
let onUnauthorized: () => void = () => {};

/**
 * main.ts 注入依赖：token 由 store 提供，401 交给 store + router 处理。
 * 这样 http 层不直接碰 localStorage 和 location，登录态只有一个来源。
 */
export function configureHttp(options: { getToken: () => string; onUnauthorized: () => void }) {
  getToken = options.getToken;
  onUnauthorized = options.onUnauthorized;
}

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = 'Bearer ' + token;
    (config as AuthConfig).authToken = token;
  }
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
  (error: AxiosError) => {
    // 主动取消（切筛选、翻页、离开页面）不是错误，也不该弹提示
    if (axios.isCancel(error)) return Promise.reject(error);
    const status = error.response?.status;
    const message = (error.response?.data as { message?: string } | undefined)?.message || error.message;
    if (status === 401) {
      const used = (error.config as AuthConfig | undefined)?.authToken;
      if (used === undefined) {
        // 登录接口自己的 401（账号或密码错误）：正常提示，不涉及登出
        ElMessage.error(message || '账号或密码错误');
      } else if (used === getToken()) {
        // 失败的正是当前这支 token：登出并回登录页
        ElMessage.error('登录已过期，请重新登录');
        onUnauthorized();
      }
      // 剩下的是陈旧 token 迟到的 401：当前会话已经换了新 token，静默丢弃
      return Promise.reject(error);
    }
    ElMessage.error(message || '网络异常');
    return Promise.reject(error);
  },
);

/** params 用宽松的 object：调用方各自传自己的查询对象，不需要为了类型兼容再包一层 */
export function get<T>(url: string, params?: object, signal?: AbortSignal): Promise<T> {
  return http.get(url, { params, signal }) as unknown as Promise<T>;
}

export function post<T>(url: string, data?: unknown): Promise<T> {
  return http.post(url, data) as unknown as Promise<T>;
}

export function patch<T>(url: string, data?: unknown): Promise<T> {
  return http.patch(url, data) as unknown as Promise<T>;
}

export function put<T>(url: string, data?: unknown): Promise<T> {
  return http.put(url, data) as unknown as Promise<T>;
}

export function del<T>(url: string): Promise<T> {
  return http.delete(url) as unknown as Promise<T>;
}
