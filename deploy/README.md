# 上公网 / 上线部署

> 这份文档解决一个问题：**怎么让别人的手机（不在你家 WiFi）用上这个产品。**

## 一、先搞清楚现状

| | 现在 | 上线后 |
|---|---|---|
| 服务器在哪 | 你这台电脑 | 云服务器 |
| 网址 | `http://192.168.1.100:3100` | `https://your-domain.com` |
| 谁能访问 | 同一个 WiFi 的设备 | 任何人，任何网络 |
| 小程序能不能发布 | 不能 | 能 |

**「必须同一局域网」不是产品设计，只是「服务器还没搬走」。**
手机通过微信服务器访问你的公网域名，跟局域网无关。

## 二、微信的硬性门槛（先看这个再决定投多少钱）

小程序要**发布**给别人用，必须在「小程序后台 → 开发管理 → 开发设置 → 服务器域名」
里配置 **request 合法域名**，要求：

| 要求 | 说明 |
|---|---|
| 必须 HTTPS | `http://` 一律拒绝 |
| 必须是已备案域名 | 国内服务器走 ICP 备案，**1–2 周**，这是最大的时间成本 |
| 不能填 IP | `http://192.168.1.100:3100` 永远配不进去 |
| 不能带端口 | 只能是 443 |

> 只想自己演示 / 给体验成员看：勾「不校验合法域名」就能绕过，不用备案。
> 想让陌生人正常搜索、使用：备案绕不过去。

## 三、两条落地路线

### 路线 A：内网穿透（5 分钟，先验证效果）

§§§powershell
pnpm dev:server                       # 先确保后端在跑
pwsh -File scripts/tunnel.ps1 -Apply  # 起隧道 + 自动配好小程序
pwsh -File scripts/tunnel.ps1 -Status # 看状态
pwsh -File scripts/tunnel.ps1 -Stop   # 关掉
§§§

脚本会给你一个 `https://xxx.lhr.life`，它**同时**能开管理后台和接口：

- **手机浏览器**直接开那个网址 → 管理后台，用流量也行，不用连你家 WiFi
- **小程序**：`-Apply` 已经把地址写进 `config.js` 并设好 `FORCE_ENV='prod'`，
  你只要在开发者工具里勾上「不校验合法域名」

**适合**：演示、答辩、给朋友看、验证公网链路通不通。
**不适合**：正式运营 —— 地址每次重开都会变，免费隧道也不保证可用性。

> **为什么不用 Cloudflare 快速隧道？** 本机实测运营商封了 7844 端口（UDP+TCP），
> 那是 cloudflared 的专用端口。隧道会显示「建立成功」、也能拿到 trycloudflare.com 网址，
> 但一访问就是 **HTTP 530**。详见 `docs/09-公网访问.md`。

### 路线 B：云服务器（正式运营）

**买什么**

| 东西 | 参考价 | 在哪买 |
|---|---|---|
| 轻量应用服务器 2核2G | 学生机 ¥100/年 左右 | 阿里云 / 腾讯云学生认证 |
| 域名 `.com`/`.cn` | ¥30–60/年 | 同上，或 Namesilo |
| 备案 | 免费 | 服务器厂商的备案系统，1–2 周 |
| HTTPS 证书 | 免费 | Let's Encrypt（脚本自动续期） |

> 不想备案：服务器买**香港/新加坡**节点，域名不用备案，但国内访问慢一些，
> 而且微信仍然要求域名 —— 备案能用境外域名解决，速度换合规。

**部署（Docker 路线，推荐）**

§§§bash
# 服务器上，装好 Docker 之后
git clone <你的仓库> /opt/campus && cd /opt/campus

# 生成生产密钥
cp .env.example .env.production
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))" >> .env.production
# 再把 POSTGRES_PASSWORD 也改成随机串，然后编辑 .env.production 补上：

docker compose -f deploy/docker-compose.prod.yml --env-file .env.production up -d --build
§§§

**部署（裸机路线，不用 Docker）**

§§§bash
apt install -y postgresql-16 postgresql-16-pgvector nodejs npm
npm i -g pnpm
git clone <你的仓库> /opt/campus && cd /opt/campus
pnpm install && pnpm build && pnpm build:admin
cp .env.example .env && vi .env      # DB_DRIVER=postgres、NODE_ENV=production、真实 JWT_SECRET
pnpm db:push && pnpm db:seed

sudo cp deploy/campus.service /etc/systemd/system/
sudo systemctl enable --now campus
§§§

**配 nginx + HTTPS**

§§§bash
apt install -y nginx certbot python3-certbot-nginx
cp deploy/nginx.conf /etc/nginx/sites-available/campus
sed -i 's/your-domain.com/你的真实域名/g' /etc/nginx/sites-available/campus
certbot --nginx -d 你的真实域名        # 自动签发证书 + 自动改配置 + 自动续期
nginx -t && systemctl reload nginx
§§§

## 四、上线前必做（安全）

默认密码和占位密钥是公开写在所有文档里的，**不做这三件事等于把后台送人**：

| 做什么 | 怎么做 |
|---|---|
| 改管理员密码 | `pnpm --filter @campus/server admin:password 你的新密码` |
| 换 JWT_SECRET | 随机 32 字节；`NODE_ENV=production` 下用占位串后端会**拒绝启动**（这是故意的） |
| 设 NODE_ENV | `production`：关闭接口文档、收紧登录限流 |
| 清演示数据 | `pnpm --filter @campus/server data:clear-demo`（会先备份） |

## 五、换域名后要改的地方

| 位置 | 改什么 | 必须吗 |
|---|---|---|
| `apps/miniapp/config.js` | `ENV.prod` 换成最终域名，`FORCE_ENV='prod'` | **必须** |
| 管理后台 | 不用改。接口走相对路径 `/api`，换任何域名都自动跟着走 | — |
| 后端 `.env` | 一般不用；前后端不同源时配 `CORS_ORIGINS` | 视情况 |
| 微信小程序后台 | 「服务器域名」加入 `https://你的域名` | **必须**（否则正式版连不上） |

## 六、文件清单

| 文件 | 干什么 |
|---|---|
| `nginx.conf` | 反向代理 + HTTPS。**AI 流式那段是关键**：不关 `proxy_buffering` 逐字输出会变成整段蹦 |
| `Dockerfile` | 后端 + 管理后台打包成一个镜像，单端口 |
| `docker-compose.prod.yml` | PostgreSQL(pgvector) + 后端；数据库不映射端口，后端只绑 127.0.0.1 |
| `campus.service` | 裸机部署的 systemd 单元（开机自启、崩溃重启） |
| `../scripts/tunnel.ps1` | 内网穿透一键脚本（路线 A，SSH 反向隧道，不用注册） |

## 七、实测状态说明

诚实交代，免得你踩坑：

- ✅ **本机验证过**：生产模式单端口跑通（后端托管管理后台）、`NODE_ENV=production` 密钥校验、PostgreSQL 18 + pgvector、Docker 镜像拉起 PostgreSQL
- ⚠️ **未实测**：`deploy/Dockerfile`、`nginx.conf`、systemd 单元 ——
  本机没有云服务器和公网域名，这几份配置是按标准写法给的，**第一次部署请预留调试时间**
- ⚠️ **未实测**：真实大模型调用（`LLM_API_KEY` 一直是空的，AI 全部在 MockProvider 上验证）