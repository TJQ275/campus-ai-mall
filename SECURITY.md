# 安全说明

## 报告问题

如果你发现了安全漏洞，请**不要开公开 Issue**，用邮件或 GitHub 的私密漏洞报告功能联系维护者。

## 这个项目涉及的安全面

它同时处理**登录凭证**、**第三方 API Key** 和**会改数据的 AI 操作**，所以有三处值得注意。

### 1. 大模型 API Key

- Key 存在数据库的 `sys_config` 表里（后台「AI 设置」页填），优先级高于 `.env`
- **读取接口永远不回显明文**，只回显前后各 4 位（`sk-8****954d`）
- ⚠️ **后台点「恢复默认」会把 Key 一并删除且无法找回** —— 这是设计使然（明文不落任何地方），二次确认里已明确提示
- ⚠️ **跑 `pnpm test:hardening` 会覆盖并重置 AI 配置**。所以脚本检测到已配置真实 Key 时会**自动跳过**那几条破坏性用例；确需强制跑请设 `ALLOW_DESTRUCTIVE_AI_CONFIG_TEST=1`

### 2. AI 发起的写操作

- AI **不能直接改数据**。加购 / 售后这类写操作会先落 `ai_pending_action` 表，等用户在界面上确认才执行
- 确认时先**原子抢占**状态（`pending` → `executing`），只有抢到的那次调用会执行 —— 用户双击确认不会重复加购
- 作答前还有一层规则校验（见 `apps/server/src/modules/ai/workflow.ts`），拦截「声称完成但实际没执行」的回答

### 3. 上线前必做

默认配置是给本地演示用的，**直接暴露到公网等于把后台送人**：

| 做什么 | 怎么做 |
|---|---|
| 改管理员密码 | `pnpm --filter @campus/server admin:password <新密码>` |
| 换 JWT_SECRET | 随机 32 字节。`NODE_ENV=production` 下用占位串后端会**拒绝启动**（故意设计） |
| 设 NODE_ENV | `production` —— 关闭接口文档、收紧登录限流 |
| 清演示数据 | `pnpm --filter @campus/server data:clear-demo`（会先备份） |
| 配 CORS 白名单 | 前后端不同源时设 `CORS_ORIGINS` |

## 自动化保障

`pnpm test:hardening` 覆盖了：支付幂等、库存扣减、余额负数保护、防批量赋值、禁用账号即时失效、登录限流（按 IP + 账号分桶，避免一个账号被爆破连累其他人）、AI 配置读写权限。
