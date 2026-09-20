# AI优选零食

[![CI](https://github.com/TJQ275/campus-ai-mall/actions/workflows/ci.yml/badge.svg)](https://github.com/TJQ275/campus-ai-mall/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-67c23a.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-177%20passing-67c23a.svg)](#自动化验收)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)

> 说一句「想吃辣的，20 元以内」，AI 帮你挑好、加进购物车、下单 —— **每一步写操作都等你确认**。

**AI优选零食**是一个面向校园的零食与二手教材商城，包含原生微信小程序、Vue3 管理后台和 NestJS 后端三端。

它最大的不同，是把 AI 助手做成了**系统骨架**而不是一个聊天框：商品、购物车、订单、售后、经营数据全都是它会调用的工具，所以它能真的帮你加购、查订单、提交售后。

<img src="docs/assets/architecture.svg" alt="系统架构" width="900">

## 这个项目想证明什么

大多数「AI + 业务」的 Demo 停在「能聊」。这个项目往前多走了三步 —— 也正是 AI 应用上线后真正会痛的地方：

| | 做了什么 | 一句话 |
|---|---|---|
| **① 安全** | 两阶段写操作 | AI 不能直接改数据。加购 / 售后先落 pending，用户确认后才原子执行 |
| **② 可控** | 作答前规则校验 | 模型会**谎称做过某件事**。校验阶段在发给用户前拦掉，宁可说「没办成」 |
| **③ 可测** | 57 条用例的评测体系 | 改 prompt 不看感觉。**评测抓出过 6 个真实缺陷，通过率 74% → 100%** |

> 另外还有按调用粒度的 token 成本核算与日预算闸门 —— 超预算自动降级，账单不会失控。

## AI 助手是怎么工作的

### Agent 工作流：五个阶段，作答前先校验

<img src="docs/assets/agent-workflow.svg" alt="Agent 工作流" width="900">

编排交给 **LangChain 的 `createAgent`**（底层 LangGraph），工具用 LangChain 的 `tool()` + Zod 定义，
模型走 `ChatOpenAI`（所以换厂商只改配置）。**但产出仍是项目自己的 SSE 事件协议** —— 前端一行都没改。

> **框架替不掉的部分，仍然自己实现**：两阶段写操作、作答前校验、按调用粒度记账、日预算闸门。
> 迁移时验证过：LangChain 不提供这几样，换过去还是得自己写 —— 见 [docs/10](docs/10-AI评测与成本.md)。

**校验阶段不是装饰。** 它用一组规则在回答发给用户之前把关，最关键的一条是 R1：
「声称完成了写操作，但本轮既没调用写工具、也没有生成待确认动作」。

这条规则来自一次真实事故 —— 评测发现模型回答「已把商品加入购物车」，
而工具链里根本没有 `add_to_cart`。用户会以为购物车里真有东西，比答错一句话严重得多。

### RAG：召回 → 重排 → 精选

<img src="docs/assets/rag-pipeline.svg" alt="RAG 检索链路" width="900">

### 五个 AI 能力（全部可演示，无需大模型 Key）

| 能力 | 实现方式 | 没配 Key 时 |
|---|---|---|
| 对话式导购 | Function Calling 打通搜索 / 加购 / 查单 / 售后 | 规则意图解析 + 同一套工具链路 |
| 智能客服与售后 | 知识库 **RAG（召回 → 重排 → 精选）**，回答带引用来源 | 关键词检索 + 同义词扩展 + 本地重排 |
| 扫码 / 拍照找同款 | ISBN 精确匹配；VLM 识图 → 向量检索 | 扫码完全可用；拍照明确降级并给替代路径 |
| 评论摘要 + 推荐理由 | 模型读评论输出结构化 JSON；画像 + 协同过滤生成理由 | 模板从真实评分与文本归纳 |
| 商家侧 AI 运营 | 指标白名单查询 + 真实字段驱动的文案生成 | 模板文案，卖点仍来自真实字段 |

**没有大模型 Key 也能完整跑通**：自动降级为内置规则引擎，工具调用链路与真实模型完全一致。
## 界面

### 小程序：对话式导购

<p align="left"><img src="docs/assets/miniapp-chat.png" alt="小程序 AI 对话" width="300"></p>

问「有高数教材吗」，AI 调用检索工具、拿到真实商品、渲染成可直接点进详情的卡片。

> 截图底部显示 `mock-rule-based`，这是**未配置大模型 Key 时的降级模式** ——
> 工具调用链路与真实模型完全一致，只是话术由模板生成。配好 Key 后这里会显示真实模型名。

### 管理后台：AI 调用日志

<img src="docs/assets/admin-ai-logs.png" alt="AI 调用日志" width="1000">

每一次工具调用都落库：谁调的、调了什么、耗时多久、成功与否。
状态里的 `pending` 就是**两阶段写操作**留下的痕迹 ——
AI 想加购时只落一条待确认记录，用户点了确认才真正执行。点开任意一行可看完整入参与返回。

### 管理后台：AI 成本

<img src="docs/assets/admin-ai-cost.png" alt="AI 成本看板" width="1000">

**按「每次模型调用」粒度记账**，而不是按消息 —— 一次带工具轮次的对话会调模型多次，
只记最终回复的话账会差好几倍（这个 bug 修过）。费用按微元整数存储，可设日预算，超预算自动降级。

## 技术栈

| 层 | 选型 |
|---|---|
| 用户端 | 原生微信小程序，手写 WXSS，**零 npm 依赖、无需构建**，微信开发者工具打开即可运行/上传 |
| 管理后台 | Vue 3 + Vite + Element Plus + ECharts |
| 后端 | NestJS 12 + TypeScript + Drizzle ORM |
| 数据库 | PostgreSQL 16 + pgvector（本地开发默认 PGlite，零安装） |
| **AI 编排** | **LangChain `createAgent`（底层 LangGraph）**—— 模型、工具、消息都走 LangChain |
| AI 模型 | 任意 OpenAI 兼容接口（DeepSeek / 通义 / Kimi / Ollama），经 LangChain `ChatOpenAI` 调用 |
| 重排服务 | Python + FastAPI（BM25 + RRF，纯算法不下载模型权重） |

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
pnpm test           # 单元 71 + 后端全链路 34 + 加固 49 + 小程序 23 = 177 项断言
pnpm test:py        # Python 重排服务 13 条
pnpm lint           # ESLint（后端 / 后台 / 小程序三套规则）
pnpm typecheck      # 三个包的 tsc / vue-tsc
pnpm ci             # 一条命令跑完全部门禁（静态检查 + 测试 + AI 评测退步校验）
pnpm ai:eval        # AI 质量评测（57 条用例，需真实模型，见 docs/10）
```

分层说明：

| 命令 | 覆盖内容 | 是否需要数据库 |
|---|---|---|
| `pnpm test:unit` | 历史消息重建、入参 schema、密码哈希、生产密钥体检 | 不需要 |
| `pnpm test:acceptance` | 全链路：登录 → 检索 → 购物车 → 下单 → 支付 → 发货 → 售后 → 退款，AI 工具与写操作二次确认 | 需要（会真实下单） |
| `pnpm test:hardening` | 并发与资金：支付幂等、库存扣减、余额负数保护、防批量赋值、禁用账号即时失效、登录限流、AI 配置读写 | 需要（会真实下单） |
| `pnpm test:miniapp` | WXML 静态检查、SSE 客户端解码、首屏登录竞态、小程序 API 链路 | 最后一项需要后端 |
| `pnpm ai:eval` | AI 质量评测：工具命中率、答案要点、幻觉、提示词注入、写操作确认 | 需要后端 + 模型（或 Mock） |

> `pnpm test:acceptance` 与 `pnpm test:hardening` 会产生真实订单与商品，反复执行后想恢复演示数据请跑 `pnpm db:reset`。

最近一次干净环境（`pnpm db:reset` 后）的验收结果：**130 项断言全部通过**。

覆盖：服务健康、管理端登录与看板、AI 统计、知识库、经营快报、小程序登录、首页聚合与推荐理由、检索与价格换算、商品详情、评价摘要、地址、充值、购物车、结算、下单、支付、发货、收货、售后与退款、AI 工具注册表、对话式导购、写操作二次确认（含「确认前未写入」断言）、客服 RAG 引用、扫码找书、拍照降级、商家经营分析、AI 文案、工具调用可观测、会话回放；以及入参校验、重复支付、并发支付、购物车唯一约束、售后重复申请、越权与批量赋值、限流、AI 配置后台读写。

## 管理后台：卖家怎么用

管理后台（`http://localhost:5173`，`admin / admin123`）是给不懂技术的卖家用的，日常操作全在界面上：

- **商品管理** → 新增商品：选品类（零食 / 二手书）、上传图片、填价格库存和标签。零食与二手书字段不同，表单会跟着品类切换；「AI 写文案」生成标题 / 卖点 / 标签后可以一键填回表单。
- **AI 设置** → 填自己的大模型 API Key，点「测试连接」验证，保存即生效（不用改文件、不用重启）。
- 订单管理（发货）、售后管理（审核退款）、用户管理（改余额 / 禁用账号）、AI 知识库（客服话术，改完立刻生效）。

详细步骤见 [`docs/08-卖家操作手册.md`](docs/08-卖家操作手册.md)。

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

### AI 部分（主动交代，避免踩坑）

| 项 | 现状 | 为什么 |
|---|---|---|
| **Agent 是单循环，没有多 Agent 协作** | 五阶段工作流是显式化的，但没有「规划 Agent + 执行 Agent + 校验 Agent」那种多角色编排 | 单轮导购/客服的工具链是线性的，拆多 Agent 只增加延迟和 token 成本。真要用会用在**上下文隔离**上（先扫数据产出汇总、再基于汇总写结论） |
| **评测是离线的** | 57 条固定用例 + 基线回归，但没有线上真实流量回流 | 项目没有真实用户。上线后应先埋点（会话放弃率、追问率、工具错误率），再把坏 case 回流成用例 |
| **rerank 的收益没有量化** | 有 13 条 Python 测试证明**行为正确**（排序、兜底、降级），但没测 recall@5 / MRR 提升了多少 | 量化需要带标注的检索集，是下一步 |
| **`ai_feedback` 表建了但没接入口** | 表结构在，`ai_feedback` 有 👍/👎 字段，但没有 API 和小程序入口 | 还没有真实流量，先没做 |
| **微信支付是模拟的** | `payment` 表与状态机完整，支付动作是内部模拟的 | 接真实支付需要商户号与证书 |

> 这些不是「忘了做」，是**判断后没做或还没到时候**。写在这里是因为一个只讲优点的项目不可信。