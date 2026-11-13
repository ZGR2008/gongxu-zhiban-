# V10 部署与重新部署说明

本说明补齐服务器部署记录中、原 512 文件候选和初版 449 文件源码包均未包含的生产反向代理补丁与部署步骤。业务代码基准仍为 `30e4d5e12e0d2edbefd9f5ae57b508343a974b93`；文档整理保留其完整历史。以下操作只用于新的、单独准备的环境，不应直接在现有生产目录执行。

## 已有部署事实

2026-11-13 的部署记录使用 Node.js 24.22.3、pnpm 11.25.0、PostgreSQL 16.16 和 pgvector 0.8.7。API 与向量服务分别绑定 `127.0.0.1:3001`、`127.0.0.1:3010`；该服务器独立数据库绑定 `127.0.0.1:55432`。其他独立安装可以使用自己的数据库端口，须与 `DATABASE_URL` 一致。

当日 22:01 对 `https://43.142.160.90/` 和 `/api/ready` 的无登录 GET 均返回 200，正常 TLS 校验通过。网站可访问不等于全部业务、模型质量或比赛提交验收。域名 HTTPS 未在本轮确认为已就绪。

服务器在 `apps/api/src/app.ts` 中额外配置了 `trustProxy: '127.0.0.1'`。仓库提供[同内容补丁](../scripts/production-proxy.patch)，但不自动修改应用源码或运行中的实例。仅限 API 监听回环、反向代理确实位于本机的部署；其他拓扑必须重新设计信任范围。

## 源码中保留的部署输入

| 用途 | 保留文件或目录 |
| --- | --- |
| 依赖与构建 | 根目录 package.json、pnpm-lock.yaml、pnpm-workspace.yaml，以及三个应用的 package.json / tsconfig / 源码 |
| Web | apps/web/src、public、vite.config.ts；构建后生成 dist，不能只复制页面截图 |
| API 与数据库 | apps/api/src、全部 25 个 migrations；运行时 dist 与 migrations 必须同时在应用目录内 |
| 向量服务 | apps/embedding/src、model-manifest.json、下载脚本和第三方许可 |
| 本地配置 | apps/api/.env.example、apps/embedding/.env.example；均为模板 |
| HTTPS 代理 | scripts/production-proxy.patch 与本说明的路由约定 |
| 课程与评估 | knowledge/teaching-v6、scripts/import-teaching-curriculum.mjs、evaluation、测试及合成夹具 |

真实 `.env`、数据库备份/用户数据、密码、API 密钥、TLS 私钥、已安装依赖和模型权重不放进源码包。重新部署须在新环境单独准备它们；这是环境输入，不能用旧演示资料或模板口令代替。模型固定文件可按清单下载或从已授权本地资产复制，并验证大小与 SHA-256。见 [Embedding 说明](../apps/embedding/README.md)。

## 在独立的新环境准备

1. 从公开 Git 仓库完整克隆，不使用浅克隆。记录目标提交号并运行 `git fsck --full`。ZIP 不提供真实历史，历史评审应使用 Git 仓库。
2. 安装目标系统适用的 Node.js、pnpm、PostgreSQL 与 pgvector。不要把 Windows 的 node_modules 复制到 Linux；向量服务包含平台相关依赖。
3. 在新环境安装锁定依赖、准备模型，再构建：

```sh
pnpm install --frozen-lockfile
pnpm --filter @gongxu/embedding model:download
pnpm typecheck
pnpm build
```

模型下载不调用付费聊天模型；模型启动时会核对清单。内存较小的独立环境可改用 `pnpm --workspace-concurrency=1 -r --if-present build` 逐个构建。

4. 若使用与已部署服务器相同的本机 HTTPS 反向代理，在新副本根目录先核对再应用补丁：

```sh
git apply --check scripts/production-proxy.patch
git apply scripts/production-proxy.patch
pnpm --filter @gongxu/api build
```

已应用的补丁不要重复应用；检查失败时先核对源码与代理架构。补丁会使新部署副本相对 Git 提交多一处明确的工作区差异，必须记录，不能宣称它与提交逐字节一致。源码 ZIP 内也带此补丁；在无 Git 仓库的解压目录可使用 `git apply --no-index --check` 和 `git apply --no-index`。

## 配置、数据库与进程工作目录

在新环境使用配置模板填写真实连接。API 需要 `HOST=127.0.0.1`、`PORT=3001`、目标 `DATABASE_URL` 和实际 HTTPS 站点的 `CORS_ORIGIN`。向量连接使用 `EMBEDDING_BASE_URL=http://127.0.0.1:3010/v1` 和清单中的 `EMBEDDING_MODEL`。聊天地址、模型及密钥独立设置；未配置时不能宣称 AI 聊天功能可用。

PostgreSQL 需有 pgcrypto 和 vector 扩展，并授予应用所需的数据库权限。核对数据库目标和备份后，在新环境执行：

```sh
pnpm --filter @gongxu/api db:migrate
```

API 的 `/ready` 会检查数据库连通、迁移版本和 vector 扩展；200 才表示这一就绪范围通过。只保存 `dist` 而漏掉 `apps/api/migrations` 会导致运行或就绪检查失败。

进程管理器必须设置正确的工作目录：API 为发布目录下的 `apps/api`，向量服务为 `apps/embedding`，两者启动命令均为相应 Node.js 的 `dist/server.js`。可使用独立 systemd 服务；数据库由独立服务管理。现有部署使用 `/etc/gongxu-zhiban/api.env`、`embedding.env` 作为 EnvironmentFile，并通过 `/opt/gongxu-zhiban/current` 指向发布目录。配置文件由管理员在新环境单独创建，限制读取权限；不要复制现有生产密钥、账号资料或未经授权的数据库到评审包。

Web 静态目录为 `apps/web/dist`。Vite 的开发代理只在开发服务器中生效；生产 Nginx 必须另外配置 `/api/` 转发与 SPA 回退。

## HTTPS 反向代理约定

在新站点管理员已配置的 TLS server 块内，API 路由的关键配置为：

```nginx
location ^~ /api/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
    proxy_buffering off;
}
```

`proxy_pass` 尾部斜杠用于移除 `/api/` 前缀，须与本地 API 路由对应。Web 根目录设置为该新发布目录的 `apps/web/dist`，应用路由使用 `try_files $uri $uri/ /index.html`；真实静态资源不存在时返回 404。限制请求体大小，禁止公开 `.env`、`.git`、数据库和向量端口，并保留证书续期使用的 ACME 路径。HTTP 跳转、证书、进程自启与备份计划由管理员针对新主机配置，不能照搬现有主机的证书私钥或自动切换现有站点。

## 数据与验收

- 新数据库只有迁移结构，不会自动包含当前服务器的账号、教师任务或学生资料。恢复业务数据须使用另行授权的备份与独立恢复环境，不能把合成夹具当作真实数据。
- 课程的 51 篇原创合成资料保留可重建源码；是否导入目标库需明确选择。实际导入入口和权限边界见[课程说明](KNOWLEDGE-CURRICULUM-V6.md)。
- 运行 `pnpm verify` 前先看[验证范围](REVIEW-STATUS.md)。离线单元测试不等同于新主机安装、数据库迁移、浏览器、TLS、自启或备份恢复全部通过。
- 新部署至少分别检查 API 和 Embedding 的 `/ready`、HTTPS 首页、`/api/ready`、静态资源、浏览器流程和备份恢复；真实模型调用须单独授权并记录费用范围。

本轮只在独立本机环境核对补丁、源码包、构建和测试，并对公开入口做只读请求。没有重新部署、迁移生产数据、调用付费模型、切换发布目录、重启服务或修改服务器配置。
