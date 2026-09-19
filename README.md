# AI优选零食

> 说一句「想吃辣的，20 元以内」，AI 帮你挑好、加进购物车、下单 —— 每一步都等你确认。

**AI优选零食**是一个面向校园的零食与二手教材商城，包含原生微信小程序、Vue3 管理后台和 NestJS 后端三端。

它最大的不同，是把 AI 助手做成了**系统骨架**而不是一个聊天框：商品、购物车、订单、售后、经营数据全都是它会调用的工具，所以它能真的帮你加购、查订单、提交售后。涉及写操作时会先落一条待确认记录，你点了确认才真正执行。

**没有配置大模型 Key 也能完整演示** —— 自动降级为内置规则引擎，工具调用链路与真实模型完全一致。
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
| 用户端 | 原生微信小程序，手写 WXSS，**零 npm 依赖、无需构建**，微信开发者工具打开即可运行/上传 |
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

## 切到真实 PostgreSQL（或 Docker）

```bash
docker compose up -d postgres redis
# 改 .env: DB_DRIVER=postgres, DATABASE_URL=postgres://campus:campus@localhost:5432/campus_mall
pnpm db:push && pnpm db:seed
```

同一份 Drizzle schema 同时驱动 PGlite 与 PostgreSQL，业务代码零改动。

Docker 路径同样实测通过（`pgvector/pgvector:pg16` 镜像自带 pgvector）。**国内网络直连 Docker Hub 会超时**，需要先配镜像加速，见 `docs/06-部署与交付.md`。
本机 5432 已被原生 PostgreSQL 占用时，用 `POSTGRES_PORT=5433` 换端口。

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
| P4 | 商家侧 AI（经营分析 + 文案生成）、Vue3 管理后台（9 个页面） | ✅ |
| P4 | 原生微信小程序（14 个页面，含流式 AI 助手与写操作确认） | ✅ |
| P4 | 部署文档、演示脚本、自动化验收 | ✅ |

## 三端启动

```bash
pnpm install        # 会自动构建 packages/shared
cp .env.example .env
pnpm setup          # 建表 + 演示数据 + 生成评论摘要

pnpm dev:server     # 后端      http://localhost:3100/api   （文档 /api/docs）
pnpm dev:admin      # 管理后台  http://localhost:5173       (admin / admin123)
pnpm dev:miniapp    # 小程序    用微信开发者工具打开 apps/miniapp
```

也可以 `pnpm dev` 一键起后端 + 后台（各自开一个窗口，关窗口才停）。

小程序需要勾选「详情 → 本地设置 → 不校验合法域名」；不需要真实 AppID，后端未配置 `WX_APPID` 时走开发模式自动建号。

## 自动化验收

```bash
pnpm test           # 单元 31 + 后端全链路 34 + 加固 42 + 小程序 23 = 130 项断言
pnpm lint           # ESLint（后端 / 后台 / 小程序三套规则）
pnpm typecheck      # 三个包的 tsc / vue-tsc
```

分层说明：

| 命令 | 覆盖内容 | 是否需要数据库 |
|---|---|---|
| `pnpm test:unit` | 历史消息重建、入参 schema、密码哈希、生产密钥体检 | 不需要 |
| `pnpm test:acceptance` | 全链路：登录 → 检索 → 购物车 → 下单 → 支付 → 发货 → 售后 → 退款，AI 工具与写操作二次确认 | 需要（会真实下单） |
| `pnpm test:hardening` | 并发与资金：支付幂等、库存扣减、余额负数保护、防批量赋值、禁用账号即时失效、登录限流、AI 配置读写 | 需要（会真实下单） |
| `pnpm test:miniapp` | WXML 静态检查、SSE 客户端解码、首屏登录竞态、小程序 API 链路 | 最后一项需要后端 |

> `pnpm test:acceptance` 与 `pnpm test:hardening` 会产生真实订单与商品，反复执行后想恢复演示数据请跑 `pnpm db:reset`。

最近一次干净环境（`pnpm db:reset` 后）的验收结果：**130 项断言全部通过**。

覆盖：服务健康、管理端登录与看板、AI 统计、知识库、经营快报、小程序登录、首页聚合与推荐理由、检索与价格换算、商品详情、评价摘要、地址、充值、购物车、结算、下单、支付、发货、收货、售后与退款、AI 工具注册表、对话式导购、写操作二次确认（含「确认前未写入」断言）、客服 RAG 引用、扫码找书、拍照降级、商家经营分析、AI 文案、工具调用可观测、会话回放；以及入参校验、重复支付、并发支付、购物车唯一约束、售后重复申请、越权与批量赋值、限流、AI 配置后台读写。

## 管理后台：卖家怎么用

管理后台（`http://localhost:5173`，`admin / admin123`）是给不懂技术的卖家用的，日常操作全在界面上：

- **商品管理** → 新增商品：选品类（零食 / 二手书）、上传图片、填价格库存和标签。零食与二手书字段不同，表单会跟着品类切换；「AI 写文案」生成标题 / 卖点 / 标签后可以一键填回表单。
- **AI 设置** → 填自己的大模型 API Key，点「测试连接」验证，保存即生效（不用改文件、不用重启）。
- 订单管理（发货）、售后管理（审核退款）、用户管理（改余额 / 禁用账号）、AI 知识库（客服话术，改完立刻生效）。

详细步骤见 [`docs/08-卖家操作手册.md`](docs/08-卖家操作手册.md)。

## 五个 AI 能力（全部可演示，无需大模型 Key）

| 能力 | 实现方式 | 没配 Key 时 |
|---|---|---|
| 对话式导购 | Function Calling 打通搜索 / 加购 / 查单 / 售后 | 规则意图解析 + 同一套工具链路 |
| 智能客服与售后 | 知识库 RAG，回答带引用来源，可代提交售后 | 关键词检索 + 打分重排 |
| 扫码 / 拍照找同款 | ISBN 精确匹配；VLM 识图 → 向量检索 | 扫码完全可用；拍照明确降级并给替代路径 |
| 评论摘要 + 推荐理由 | 模型读评论输出结构化 JSON；画像 + 协同过滤生成理由 | 模板从真实评分与文本归纳 |
| 商家侧 AI 运营 | 指标白名单查询 + 真实字段驱动的文案生成 | 模板文案，卖点仍来自真实字段 |

演示账号：管理端与小程序**商家登录**都用 `admin / admin123`（接手后请立刻改密码）；小程序**买家登录**点一下微信一键登录即可，可以顺手填昵称头像。

**当前已切到真实 PostgreSQL**：PostgreSQL 18.6 + pgvector 0.8.6（本机原生安装，非 Docker），29 张表与全套 HNSW / pg_trgm 索引均已建好，验收 130 项全部通过。
想切回零安装的 PGlite：把 `.env` 的 `DB_DRIVER` 改成 `pglite` 即可，代码不用动。

**没有大模型 Key 也能完整演示**：`LLM_API_KEY` 留空时走内置规则引擎，`GET /api/ai/status` 可查看当前模式与全部工具清单（15 个）。配置 `LLM_EMBEDDING_MODEL` 后执行 `pnpm ai:embed` 即可把检索从关键词升级为语义。

## 想把它变成自己的项目

1. **换品类**：改 `packages/shared/src/enums.ts` 的 `ProductKind` 与 seed 数据即可，商品表已经同时容纳零食与二手书两套字段
2. **换大模型**：在管理后台「AI 设置」页填，或改 `.env` 的 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，支持任意 OpenAI 兼容服务（含本地 Ollama）—— 详见 `docs/08-卖家操作手册.md`
3. **加一个新 AI 能力**：写一个实现 `AiTool` 的类并注册进 `ToolRegistry`，前端零改动 —— 详见 `docs/06-部署与交付.md` 第九节
4. **换主题色**：小程序在 `app.wxss`，管理后台在 `style.css`

## 上线前必做

本地开发开箱即用，但对外发布前有几件事不能省：

1. `NODE_ENV=production`：此时 Swagger 文档默认关闭、`JWT_SECRET` 若为空或仍是 `.env.example` 里的占位值会**直接拒绝启动**
2. `CORS_ORIGINS=https://你的后台域名`：不设会放行所有来源（启动日志里会有警告）
3. `WX_APPID` / `WX_SECRET`：不配则小程序走开发模式（任意 code 都能登录），不能上线
4. `PUBLIC_BASE_URL`：拍照识图要把图片地址拼成公网可访问的绝对地址
5. 数据库换成真实 PostgreSQL（`DB_DRIVER=postgres`），并把 `uploads/` 挂到持久卷

限流目前是**单进程内存实现**（登录 10 次/分、AI 对话 30 次/分、上传 30 次/分），多实例部署需要换成 Redis 版本，见 `docs/06-部署与交付.md`。

## 已知边界

- 小程序的枚举与状态文案是手抄的（小程序没有构建步骤，无法直接 import `packages/shared`），改共享包里的枚举时需要同步 `apps/miniapp/utils/format.js`；后端与管理后台已经统一走共享包
- 向量列维度在建表时固定（默认 1024）。换 embedding 模型时若输出维度不同，系统会记一条错误日志并自动退回关键词检索，不会影响下单等主流程
- `pnpm test:hardening` 里的「禁用后 token 立即失效」依赖 15 秒状态缓存，因此该用例会等 16 秒