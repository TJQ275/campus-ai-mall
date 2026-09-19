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
│  ├─ admin/      Vue3 管理后台（含 AI 调用日志与会话回放）
│  └─ miniapp/    原生微信小程序（14 个页面，AI 助手为 Tab 主入口）
├─ packages/
│  └─ shared/     前后端共享类型 + Zod 校验
├─ docs/          架构 / 数据库 / AI 设计 / 后台 / 小程序
└─ tests/         自动化测试（Node 桩替换 wx API，真实打后端）
```

## 文档

- `docs/01-架构设计.md` —— 分层、模块、数据流
- `docs/02-数据库设计.md` —— 表结构与字段说明
- `docs/03-AI助手设计.md` —— 工具契约、会话协议、降级策略
- `docs/04-管理后台与商家AI.md` —— 后台页面说明与商家侧 AI 的设计取舍
- `docs/05-小程序说明.md` —— 页面清单、流式实现细节、自动化测试
- `docs/06-部署与交付.md` —— 环境变量、接入真实模型、生产部署、二次开发、FAQ
- `docs/07-演示脚本.md` —— 照着念的 10 分钟演示流程 + 答辩问答

## 交付状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | monorepo / 数据库（29 张表）/ 双驱动连接 / 认证 / 商品 / 购物车 / 订单 / 售后 / 钱包 | ✅ |
| P2 | AI 骨架：Provider 抽象、工具注册表、Agent 主循环、SSE、写操作二次确认、无 Key 降级 | ✅ |
| P3 | 客服 RAG（带引用来源）、扫码找书、拍照找同款、评论摘要、可解释推荐 | ✅ |
| P4 | 商家侧 AI（经营分析 + 文案生成）、Vue3 管理后台（8 个页面） | ✅ |
| P4 | 原生微信小程序（14 个页面，含流式 AI 助手与写操作确认） | ✅ |
| P4 | 部署文档、演示脚本、自动化验收 | ✅ |

## 三端启动

§§§bash
pnpm install
cp .env.example .env
pnpm setup          # 建表 + 演示数据 + 生成评论摘要

pnpm dev:server     # 后端      http://localhost:3100/api   （文档 /api/docs）
pnpm dev:admin      # 管理后台  http://localhost:5173       (admin / admin123)
pnpm dev:miniapp    # 小程序    用微信开发者工具打开 apps/miniapp
§§§

小程序需要勾选「详情 → 本地设置 → 不校验合法域名」；不需要真实 AppID，后端未配置 `WX_APPID` 时走开发模式自动建号。

## 自动化验收

§§§bash
pnpm test           # 34 项后端全链路 + 22 项小程序
§§§

最近一次干净环境（`pnpm db:reset` 后）的验收结果：**56 项断言全部通过**。

覆盖：服务健康、管理端登录与看板、AI 统计、知识库、经营快报、小程序登录、首页聚合与推荐理由、检索与价格换算、商品详情、评价摘要、地址、充值、购物车、结算、下单、支付、发货、收货、售后与退款、AI 工具注册表、对话式导购、写操作二次确认（含「确认前未写入」断言）、客服 RAG 引用、扫码找书、拍照降级、商家经营分析、AI 文案、工具调用可观测、会话回放。

## 五个 AI 能力（全部可演示，无需大模型 Key）

| 能力 | 实现方式 | 没配 Key 时 |
|---|---|---|
| 对话式导购 | Function Calling 打通搜索 / 加购 / 查单 / 售后 | 规则意图解析 + 同一套工具链路 |
| 智能客服与售后 | 知识库 RAG，回答带引用来源，可代提交售后 | 关键词检索 + 打分重排 |
| 扫码 / 拍照找同款 | ISBN 精确匹配；VLM 识图 → 向量检索 | 扫码完全可用；拍照明确降级并给替代路径 |
| 评论摘要 + 推荐理由 | 模型读评论输出结构化 JSON；画像 + 协同过滤生成理由 | 模板从真实评分与文本归纳 |
| 商家侧 AI 运营 | 指标白名单查询 + 真实字段驱动的文案生成 | 模板文案，卖点仍来自真实字段 |

演示账号：管理端 `admin / admin123`；小程序端任意 code 即可登录。

**没有大模型 Key 也能完整演示**：`LLM_API_KEY` 留空时走内置规则引擎，`GET /api/ai/status` 可查看当前模式与全部工具清单（15 个）。配置 `LLM_EMBEDDING_MODEL` 后执行 `pnpm ai:embed` 即可把检索从关键词升级为语义。

## 想把它变成自己的项目

1. **换品类**：改 `packages/shared/src/enums.ts` 的 `ProductKind` 与 seed 数据即可，商品表已经同时容纳零食与二手书两套字段
2. **换大模型**：只改 `.env` 的 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，支持任意 OpenAI 兼容服务（含本地 Ollama）
3. **加一个新 AI 能力**：写一个实现 `AiTool` 的类并注册进 `ToolRegistry`，前端零改动 —— 详见 `docs/06-部署与交付.md` 第九节
4. **换主题色**：小程序在 `app.wxss`，管理后台在 `style.css`
