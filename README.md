# 工序智伴

工序智伴是一款面向软件工程实训的 AI 原生 Web 应用。当前核心版本已在真实 PostgreSQL + pgvector、DeepSeek 和本地中文向量服务上完成一轮完整业务联调，并通过桌面与移动宽度的浏览器检查。支持账号与项目管理、需求版本、AI 需求分析、任务规划、文档知识检索、代码审查、测试用例、文档和成长中心。当前仍处于开发阶段；本地验证不代表已完成线上部署、长期稳定性评估或竞赛交付。详见 [真实集成验证记录](docs/INTEGRATION-REPORT.md)。

## 技术架构

- 前端：React、TypeScript、Vite、Tailwind CSS。
- 后端：Node.js、TypeScript、Fastify。
- 数据库：PostgreSQL，知识向量使用 pgvector；迁移文件在 `apps/api/migrations/`。
- AI 服务通过后端接入，聊天与向量模型独立配置。密钥不放入前端或版本库。

## 工作台界面

当前界面统一采用深空紫黑主题，提供项目工具入口、项目搜索与筛选、列表/网格切换、项目内导航、Markdown 编辑预览、代码编辑辅助以及测试用例筛选。项目概况和成长数据来自当前账号的真实记录。具体实现和竞赛要求核对见 [界面升级记录](docs/UI-REVIEW.md)。

工作台的三维星环是独立的装饰场景，支持暂停、拖动和减少动态效果，不参与模型调用。独立预览位于 `/previews/planet-orbit.html`，旧版 CSS/SVG 留在 `/previews/archive/planet-orbit-css-v2.html`。当前三维版通过本地 HTTP 服务加载模块，需要 WebGL2；所有运行资源本地提供，不依赖 CDN。轨道代码适配自 MIT 许可的 [SaturnWebGL](https://github.com/adelmassimo/SaturnWebGL)，使用 Three.js 0.187.0，来源和版权声明见 `apps/web/public/previews/vendor/NOTICE.txt`，前端依赖许可见 `apps/web/public/THIRD-PARTY-LICENSES.txt`。

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

前端默认访问 `http://localhost:5173`；后端默认监听 `http://127.0.0.1:3001`。前端开发代理会将 `/api` 请求转发到后端。`GET /health` 只说明后端进程可响应；`GET /ready` 会实际检查数据库连接、当前版本所需迁移和 pgvector 扩展，任一条件未满足时返回 503。登录页与工作台据此显示真实可用状态。

Windows 下可使用 `pnpm start:local` 启动本地开发服务并检查状态。脚本优先识别当前工作区已经安装的本地 PostgreSQL 启动器，其他工作区默认使用仓库的 Docker Compose；已有外部 PostgreSQL 可运行 `pnpm start:local -Database external`。首次构建可加 `-Build`，修改 API 源码或本地环境配置后可加 `-RestartApi`。脚本不会输出配置内容或发起收费模型请求；日志及进程记录保存在被 Git 忽略的 `.runtime/services/`。它使用默认端口 3001、3010、5173，不是公网部署脚本。

本机的 Docker 安装仍受 Windows 组件损坏影响，因此本轮验证使用原生 PostgreSQL 16.15 + pgvector 0.8.7，数据库数据位于工作区外层 `.setup/postgresql/data16/`；Docker 配置继续保留。切换数据库部署方式时应迁移真实数据，并避免两个数据库同时占用 5432 端口。

### AI 与知识检索配置

在仅供服务端读取的 `apps/api/.env` 中配置 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`，以启用兼容 Chat Completions 的真实模型。DeepSeek 配置可使用 `AI_BASE_URL=https://api.deepseek.com` 和 `AI_MODEL=deepseek-flash`，并将自己的密钥填入 `AI_API_KEY`；模型是否对账号可用以实际调用为准。参见 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。不要将密钥写入前端或提交到 Git。系统显示“已配置”仅代表配置项齐全，不代表服务已经联通。

配置后可执行 `pnpm --filter @gongxu/api ai:check`，单独发起一次真实模型请求；此检查会产生一次 API 调用，可能计费，不要求数据库或 Embedding 已启动。未配置时不会伪造成功。

模型请求支持 `AI_TIMEOUT_MS`（1–120 秒，模板为 90 秒）、`AI_MAX_OUTPUT_TOKENS`（256–16384，默认 4096）及可选的 `AI_REASONING_EFFORT`。DeepSeek 当前默认启用思考模式；本项目的交互实训流程使用 `AI_REASONING_EFFORT=none` 控制等待时间，规划结果仍经过结构、依赖和来源校验。其他服务不支持该参数时留空，后端会省略它。模型报告输出被长度限制截断时，后端返回 `ai_output_truncated`，不会把残缺内容保存为完整草稿。参数行为见 [DeepSeek Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。

连接失败时请根据实际错误处理。`.env.example` 是可提交的配置模板，真实密钥只填写到被 Git 忽略的 `apps/api/.env`；修改配置后须重启后端。不要在聊天、截图或 Git 评论中发送密钥。

| 错误或现象 | 处理方式 |
| --- | --- |
| `ai_auth_error` | 模型服务拒绝认证或访问，请检查本地 `AI_API_KEY` 是否有效及服务账号的访问权限；这不会使应用内登录失效。 |
| `ai_insufficient_balance` | 检查模型服务账号的可用余额。 |
| `ai_rate_limited` | 稍后重试，并检查模型服务的并发和请求频率限制。 |
| 数据库连接被拒绝 | 检查 Docker Desktop 是否已启动，再运行 `docker compose up -d`；外部数据库需核对本地 `DATABASE_URL` 对应的服务和端口。 |

模型服务错误只返回分类后的错误码，不向浏览器转发上游原始错误正文、密钥或服务地址。

Embedding 与聊天模型独立：配置 `EMBEDDING_BASE_URL`、`EMBEDDING_MODEL` 及按需 `EMBEDDING_API_KEY`，使用兼容 `/embeddings` 的服务。指向本机回环地址时可以不提供密钥；外部服务要求配置密钥。配置为 DeepSeek 聊天地址时会被拒绝；向量配置错误会禁用检索并在服务端提示，不会阻止其他 API 启动。尚未选择或配置向量服务时，仍可保存和分块文本资料。

仓库提供可选的 [本地中文向量服务](apps/embedding/README.md)，使用固定版本的 BGE-small-zh-v1.5 ONNX 量化模型，在 CPU 上生成 512 维向量，无需 Docker 或额外 API 密钥。服务单独下载模型、启动和验证：

```sh
pnpm --filter @gongxu/embedding model:download
pnpm --filter @gongxu/embedding build
pnpm --filter @gongxu/embedding start
```

首次下载模型后，在另一个终端执行 `pnpm --filter @gongxu/embedding check` 检查真实向量生成和中文样例的相似度排序。模型文件有固定哈希校验，默认仅监听本机端口 3010。具体配置和网络镜像选项见该服务 README。

知识库支持文本、Markdown 和可提取文本的 PDF 的解析、分块及保存；PDF 上限 3 MB、80 页、20 万字符，扫描件不包含可提取文本时会明确报错，暂不支持 OCR。配置 Embedding 服务后可建立向量索引、按账号检索并返回片段来源。PDF 依赖 [PDF.js](https://github.com/mozilla/pdf.js)，字体及 CMap 从安装的本地依赖读取；公开部署前应进一步对 PDF 解析进程进行资源隔离。更换向量模型或预处理方式时必须重新建立向量索引。Agent 基于已确认需求调用模型，Embedding 已配置时会实际检索知识；未配置时知识检索明确显示“已跳过”，计划标识缺少知识依据。页面在运行期间持续读取真实步骤与工具记录，计划需用户确认后才创建任务。服务未就绪时会显示真实状态，不提供模拟成功结果。

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

`pnpm test` 会先检查可提交的环境变量模板，要求 API 密钥、令牌和 secret 字段为空；此检查不会读取本地 `.env`，也不打印违规字段值。真实聊天检查只输出状态与耗时，不输出模型原文或配置内容。真实模型、数据库和业务联调需另外运行并记录结果。

启动真实本地服务后，可选择以下联调命令。脚本会创建明确标记的测试账号、项目和资料，保留测试记录，不删除原有数据；随机测试凭证只在测试进程中使用，结束后注销会话。报告保存在被 Git 忽略的 `.runtime/`，不会保存 API 密钥或登录令牌。

```sh
pnpm smoke                      # 真实数据库、解析、持久化及权限；不调用云模型
pnpm smoke --with-rag           # 额外验证真实向量索引与来源检索
pnpm smoke --with-ai            # 额外调用真实云模型，验证完整流程，会产生 API 用量
pnpm smoke:browser             # 浏览器操作、页面路由及移动布局；需要本地向量服务
pnpm smoke:browser --with-ai    # 额外验证 Agent 运行过程与审核按钮，会产生 API 用量
```

浏览器检查在 Windows 默认使用已安装的 Edge；其他系统可先运行 `pnpm exec playwright install chromium`，或通过 `SMOKE_BROWSER_CHANNEL` 选择已安装的兼容浏览器。测试地址可通过 `SMOKE_API_URL`、`SMOKE_WEB_URL` 指定，两个脚本都只允许无凭证的本机回环地址，避免误写线上业务数据。常规自动化测试中的数据库和模型替身不等同于这些真实联调结果。

## 竞赛与团队信息

赛项要求和待确认项目见 [竞赛核对清单](docs/competition-checklist.md)。参赛团队、学校及指导教师信息由实际参赛人员确认后填写，不预填或虚构。
