import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需引入：模板里的组件和 ElMessage / ElMessageBox 等函数式 API
    // 都自动带上各自的样式，不再整包引入 element-plus 及其全量 CSS。
    AutoImport({ resolvers: [ElementPlusResolver()], dts: 'src/types/auto-imports.d.ts' }),
    Components({ resolvers: [ElementPlusResolver()], dts: 'src/types/components.d.ts' }),
  ],
  server: {
    port: 5173,
    // 端口被占用时直接报错，而不是悄悄换到 5174 —— 否则文档里的 5173 会指向一个空端口
    strictPort: true,
    proxy: {
      // 开发时把 /api 与 /uploads 代理到后端，避免跨域配置
      '/api': { target: 'http://127.0.0.1:3100', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:3100', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // 三个大依赖各自成块：业务代码改动不会让它们的缓存失效
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('echarts') || id.includes('zrender')) return 'echarts';
          if (id.includes('element-plus')) return 'element-plus';
          if (id.includes('vue-router') || id.includes('pinia') || id.includes('/node_modules/vue/')) return 'vue';
        },
      },
    },
  },
});