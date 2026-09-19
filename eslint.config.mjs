import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

/**
 * 统一 lint 配置（flat config）。
 *
 * 三个代码库的规则差异很大，所以按目录分开：
 *   - apps/server     NestJS + TypeScript（Node 环境）
 *   - apps/admin      Vue3 + TypeScript（浏览器环境）
 *   - apps/miniapp    原生小程序，纯 JS，靠 wx/Page/App 这些全局对象
 *   - tests / scripts 交付脚本，Node 环境的 CommonJS
 *
 * 只开「能抓真 bug」的规则，不做格式化风格检查（风格交给编辑器）。
 * 目标：pnpm lint 在任何一次改动后都能跑通，而不是常年飘红被人忽略。
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'apps/server/drizzle/**',
      'apps/admin/src/types/**',
    ],
  },

  // JS 基础规则 + TS 推荐规则（TS 规则只作用于 TS/Vue，避免套到 .cjs 脚本上）
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.ts', '**/*.vue'] })),

  // ── 后端：TypeScript ──
  {
    files: ['apps/server/**/*.ts', 'packages/shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      // 下划线开头的参数是「故意不用」，Nest 装饰器与接口签名里很常见
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 存量代码里有少数 any，降级为警告而不是一次性大改
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── 管理后台：Vue3 + TypeScript ──
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['apps/admin/**/*.ts', 'apps/admin/**/*.vue'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        // .vue 里的 <script lang="ts"> 交给 TS 解析器
        parser: tseslint.parser,
        ecmaVersion: 2023,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // 以下几条是模板排版风格，不是 bug
      'vue/multi-word-component-names': 'off',
      'vue/attributes-order': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/multiline-html-element-content-newline': 'off',
    },
  },

  // ── 小程序：原生 JS ──
  {
    files: ['apps/miniapp/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.es2021,
        // 微信小程序运行时全局对象，ESLint 不认识，必须显式声明
        // 只列小程序里真实存在的 API，故意不放 window/document 以免掩盖用法错误
        wx: 'readonly',
        App: 'readonly',
        Page: 'readonly',
        Component: 'readonly',
        Behavior: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'writable',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
      parserOptions: { ecmaVersion: 2020, sourceType: 'script' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ── 交付脚本 / 测试：Node + CommonJS ──
  {
    files: ['tests/**/*.cjs', 'scripts/**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2023, sourceType: 'script' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
