# 工序智伴

工序智伴是一款面向软件工程实训的 AI 原生 Web 应用。本仓库当前处于**基础架构阶段**：已搭建前后端工程、数据库迁移及服务健康检查；项目管理、AI 导师、Agent、RAG、代码审查、测试及文档生成尚在开发中。

## 技术架构

- 前端：React、TypeScript、Vite、Tailwind CSS。
- 后端：Node.js、TypeScript、Fastify。
- 数据库：PostgreSQL，知识向量使用 pgvector；迁移文件在 `apps/api/migrations/`。
- 后续 AI 服务通过后端接入。密钥不放入前端或版本库。

## 环境准备

需要 Node.js 22 或更高版本、pnpm，以及启用了 pgvector 的 PostgreSQL。可使用 Docker Compose 启动仓库内的本地开发数据库；如果使用外部数据库，需提前创建数据库并确认有安装 `pgcrypto`、`vector` 扩展的权限。Compose 中的默认账号密码仅供本地开发。

```sh
pnpm install
docker compose up -d
```

复制 `apps/api/.env.example` 为 `apps/api/.env`，按实际环境配置数据库连接。不要提交 `.env` 或真实密钥。如果 PostgreSQL 已在其他地方运行，可以不使用 Docker，直接配置实际 `DATABASE_URL`。

```sh
pnpm --filter @gongxu/api db:migrate
pnpm dev
```

前端默认访问 `http://localhost:5173`；后端默认监听 `http://127.0.0.1:3001`。前端开发代理会将 `/api` 请求转发到后端。`GET /health` 只说明后端进程可响应；`GET /ready` 会实际查询数据库，数据库未配置或不可用时返回 503。数据库迁移必须在数据库可访问后运行；数据库尚未验证成功时不能视为功能已完成。

当前后端开发命令先编译 TypeScript，再监听编译后的文件；修改后端源码时需重新运行构建或重启开发命令。前端支持 Vite 热更新。

## 构建与测试

```sh
pnpm build
pnpm typecheck
pnpm test
```

上述命令检查现有工程，不代表尚未实现的业务功能已通过测试。

## 竞赛与团队信息

赛项要求和待确认项目见 [竞赛核对清单](docs/competition-checklist.md)。参赛团队、学校及指导教师信息由实际参赛人员确认后填写，不预填或虚构。
