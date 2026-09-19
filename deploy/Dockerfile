# AI优选零食 —— 生产镜像（后端 + 管理后台，单端口）
#
# 后端会自己托管管理后台的构建产物，所以整站只有 3100 一个端口，
# 不需要单独跑 nginx 容器或 Vite。
#
# 构建（在仓库根目录执行，不是在 deploy/ 里）：
#   docker build -f deploy/Dockerfile -t campus-mall .
#
# 说明：本文件**未在真实服务器上实测过**（本机没有云服务器）。
# 本机验证过的等价路径是 deploy/README.md 里的「裸机部署」一节。

FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate

WORKDIR /app

# 先只拷贝清单文件，让依赖层能被 Docker 缓存复用
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json       apps/server/
COPY apps/admin/package.json        apps/admin/
RUN pnpm install --frozen-lockfile

# 再拷贝源码并构建（顺序不能反，否则改一行代码就要重装依赖）
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps     ./apps

RUN pnpm --filter @campus/shared build \
 && pnpm --filter @campus/server build \
 && pnpm --filter @campus/admin  build

ENV NODE_ENV=production
EXPOSE 3100

# 必须从 apps/server 启动：main.ts 用 process.cwd() 定位 uploads/ 和 ../admin/dist
WORKDIR /app/apps/server
CMD ["node", "dist/main.js"]
