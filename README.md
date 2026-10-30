# 工序智伴

工序智伴是一款面向软件工程实训的 AI 原生 Web 应用。当前版本正在开发：已编写账号与项目管理、需求版本、AI 需求分析、任务规划、文档知识检索、代码审查、测试用例、文档和成长中心；这些功能仍需在配置真实 PostgreSQL、模型及 Embedding 服务后完成端到端验证。

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

### AI 与知识检索配置

在仅供服务端读取的 `apps/api/.env` 中配置 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`，以启用兼容 Chat Completions 的真实模型。DeepSeek 配置可使用 `AI_BASE_URL=https://api.deepseek.com` 和 `AI_MODEL=deepseek-flash`，并将自己的密钥填入 `AI_API_KEY`；模型是否对账号可用以实际调用为准。参见 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。不要将密钥写入前端或提交到 Git。系统显示“已配置”仅代表配置项齐全，不代表服务已经联通。

配置后可执行 `pnpm --filter @gongxu/api ai:check`，单独发起一次真实模型请求；此检查会产生一次 API 调用，可能计费，不要求数据库或 Embedding 已启动。未配置时不会伪造成功。

Embedding 与聊天模型独立：配置 `EMBEDDING_BASE_URL`、`EMBEDDING_MODEL` 及按需 `EMBEDDING_API_KEY`，使用兼容 `/embeddings` 的服务。指向本机回环地址时可以不提供密钥；外部服务要求配置密钥。DeepSeek 聊天接口不会被当成 Embedding 接口。尚未选择或配置向量服务时，仍可保存和分块文本资料。

知识库支持文本、Markdown 和可提取文本的 PDF 的解析、分块及保存；PDF 上限 3 MB、80 页、20 万字符，扫描件不包含可提取文本时会明确报错，暂不支持 OCR。配置 Embedding 服务后可建立向量索引、按账号检索并返回片段来源。PDF 依赖 [PDF.js](https://github.com/mozilla/pdf.js)，部署时应安装锁定的依赖；公开部署前应进一步对 PDF 解析进程进行资源隔离。模型候选是本地运行的 [BGE-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)，尚未在本机下载或验证；更换模型或预处理方式时必须重新建立向量索引。Agent 基于已确认需求调用模型，Embedding 已配置时会实际检索知识；未配置时知识检索明确显示“已跳过”，计划标识缺少知识依据。执行步骤和校验结果会记录，计划需用户确认后才创建任务。服务未就绪时会显示真实状态，不提供模拟成功结果。

代码审查目前的确定性检测仅覆盖 JavaScript/TypeScript 语法，不执行提交的代码；AI 的安全、性能等意见属于待验证建议。生成的测试用例默认未执行，人工修改用例后执行状态会重置。文档草稿读取已确认需求、相关任务和人工测试记录，缺失的 API、代码和部署事实须人工补充。

注意：当前登录限频为单进程机制，前端令牌存储在本地浏览器中；上线前需增加 HTTPS、共享限流、会话保护及安全审查。运行中的 Agent 在进程意外中断后尚不能自动恢复。

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
