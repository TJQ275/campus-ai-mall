# 校园 AI 商城（零食 + 二手书）

一个以 **AI 助手为核心** 的校园商城：原生微信小程序用户端 + NestJS 后端 + Vue3 管理后台。

## 为什么不一样

传统校园商城的 AI 只是「一个导购入口 + 一轮大模型调用」。这里 AI 是**系统骨架**：

- **对话式导购**：Function Calling 真正打通业务 —— 能搜货、能加购、能查订单、能发起售后
- **智能客服 / 售后助手**：RAG 检索售后政策，回答带引用来源，可代提交工单
- **拍照 / 扫码找书找同款**：多模态识别 + pgvector 向量检索
- **评论摘要 + 个性化推荐理由**：异步聚合评价，推荐时给「为什么推荐给你」
- **商家侧 AI 运营**：一键生成文案、对话式经营数据分析

> 没有配置大模型 Key 也能完整演示 —— 自动降级为规则 + 协同过滤（MockProvider）。

## 技术栈

| 层 | 选型 |
|---|---|
| 用户端 | 原生微信小程序（Vant Weapp） |
| 管理后台 | Vue 3 + Vite + Element Plus + ECharts |
| 后端 | NestJS 12 + TypeScript + Drizzle ORM |
| 数据库 | PostgreSQL 16 + pgvector（本地开发默认 PGlite，零安装） |
| 大模型 | 任意 OpenAI 兼容接口（DeepSeek / 通义 / Kimi / Ollama） |

## 零安装启动（推荐）

本地开发**不需要 Docker，也不需要安装 PostgreSQL**：默认使用 PGlite（编译成 WASM 的 PostgreSQL 18，内置 pgvector）。

```bash
pnpm install
cp .env.example .env
pnpm db:push     # 建表（含 pgvector 扩展）
pnpm db:seed     # 灌入演示数据（零食 + 二手书 + 演示对话）
pnpm dev:server  # http://localhost:3100/api/health
```

## 切到真实 PostgreSQL

```bash
docker compose up -d postgres redis
# 改 .env: DB_DRIVER=postgres, DATABASE_URL=postgres://campus:campus@localhost:5432/campus_mall
pnpm db:push && pnpm db:seed
```

同一份 Drizzle schema 同时驱动 PGlite 与 PostgreSQL，业务代码零改动。

## 目录结构

```
campus-ai-mall/
├─ apps/
│  ├─ server/     NestJS API + AI Agent 运行时
│  ├─ admin/      Vue3 管理后台（含 AI 调用日志页）
│  └─ miniapp/    原生微信小程序
├─ packages/
│  └─ shared/     前后端共享类型 + Zod 校验
└─ docs/          架构 / 部署 / 答辩要点
```

## 文档

- `docs/01-架构设计.md` —— 分层、模块、数据流
- `docs/02-数据库设计.md` —— 表结构与字段说明
- `docs/03-AI助手设计.md` —— 工具契约、会话协议、降级策略

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | monorepo / 数据库（29 张表）/ 双驱动连接 / 健康检查 / API 文档 | ✅ |
| P1 | 认证、商品检索、购物车、地址、订单支付、售后、钱包 | ✅ |
| P2 | AI 骨架：Provider 抽象、工具注册表、导购 Agent、SSE | ⏳ 下一步 |
| P3 | 客服 RAG、拍照找同款、评论摘要、推荐理由 | ⏳ |
| P4 | 商家侧 AI、Vue3 管理后台、小程序端、部署文档与演示脚本 | ⏳ |

**已验证的端到端链路**：管理端登录 → 小程序登录 → 商品检索 → 加地址 → 充值 → 加购 → 下单 → 余额支付 → 发货 → 收货 → 申请售后 → 审核退款入账与库存回滚 → 数据概览。

演示账号：管理端 `admin / admin123`；小程序端任意 code 即可登录（未配置 WX_APPID 时后端走开发模式，`code` 直接映射为 openid）。
