import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 开发时把 /api 与 /uploads 代理到后端，避免跨域配置
      '/api': { target: 'http://127.0.0.1:3100', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:3100', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
