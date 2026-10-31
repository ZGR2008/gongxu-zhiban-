# 启动、验收与恢复

项目目录：`E:\ai\gongxu-zhiban`。已有真实环境配置保持原位；本轮没有更改凭据、数据库部署方式、系统权限或登录启动项。

## 本机再次打开

在项目根目录运行 `pnpm start:local -Database external`，浏览器访问 `http://127.0.0.1:5173/dashboard`。若通过既有桌面“打开工序智伴”快捷方式启动，也应先等待就绪状态。电脑重启会停止本地进程，本机地址不等于公网部署。

改了API源码后先 `pnpm build`，再 `pnpm start:local -Database external -RestartApi`。改了服务端.env后也要重启API，但不要在终端打印文件内容、把密钥贴入聊天或上传仓库。

启动脚本只在普通Windows用户可见的进程视图中核验监听端口及归属。受限宿主如果看不到进程，会明确报错，不再创建重复进程或假报启动成功。应在用户自己的普通PowerShell窗口运行，而不是关闭安全保护。已有不属于本项目的占用进程不会被任意结束。

API `/health`只证明进程在响应；`/ready`会核对数据库、迁移和pgvector。Embedding `/ready`会区分模型引擎就绪。新接口 `/projects/<项目ID>/trace` 在未登录时应返回401；404可能意味着连接了旧API，需要先核对服务与构建版本。

## 外部评审从源码包运行

解压后使用 Node.js 22+、pnpm，执行 `pnpm install --frozen-lockfile`。依赖目录、模型权重与真实环境文件不在ZIP中。源码包内Compose和数据库连接模板是本地评审占位配置，必须使用独立数据库/数据卷，并自行配置密码；不要把评审副本指向本机真实业务库。

复制API模板到本地.env，在自己的环境填写数据库连接；聊天与向量配置可以暂时留空，应用明确显示未配置。启动PostgreSQL+pgvector后运行 `pnpm --filter @gongxu/api db:migrate`，再 `pnpm dev`。可选本地向量服务的模型下载、校验和启动见 `apps/embedding/README.md`。不要把DeepSeek聊天地址当Embedding接口。

迁移010、011都是增加结构，安全和恢复范围见 `TRACEABILITY-AND-RECOVERY.md`。真实数据没有附在评审ZIP中；注册自己的测试账号，不需要共享任何用户账号密码。

## 本轮验证入口

| 命令 | 验证范围 | 网络/数据边界 |
| --- | --- | --- |
| `pnpm test` | API与本地Embedding测试，含新的可靠性和追踪规则 | 使用替身与本地文件，不发起收费模型请求 |
| `pnpm test:ui-models`、`pnpm test:workbench` | 需求差异、概览和交付规则 | 纯规则测试 |
| `pnpm test:review-package` | 没有.git的源码副本也能检查模板 | 合成临时目录，不读真实.env |
| `pnpm typecheck`、`pnpm build` | 类型与生产构建 | 不代表视觉或真实AI验收 |
| `pnpm verify:reliability-ui` | 乱序、失败、编辑保护、历史、焦点、取消、动效 | 浏览器受控响应，外部网络被阻止 |
| `pnpm verify:local -- --browser` | 真实本地DB、版本证据、权限、桌面HTTP与可选本地Embedding | 新建合成账号/项目，真实模型回复使用替身；不操作已有用户项目 |
| `pnpm eval:offline` | 8个版本化案例的实现协议检查 | 阻止网络调用；语义效果未评估 |
| `pnpm smoke --with-rag` | 实际运行API/数据库/PDF/本地索引及检索 | 先核对Embedding为已授权的本机服务；不用`--with-ai` |
| `pnpm smoke:browser`、`pnpm smoke:project-controls`、`pnpm smoke:ui`、`pnpm smoke:workbench` | 旧界面与核心流程回归 | 无`--with-ai`时增加收费接口拦截；部分场景受控替身 |
| `pnpm smoke:visual` | 独立WebGL预览像素、暂停、键盘及恢复 | 本地资产，不是AI算法或教学效果证据 |

上述真实联调会保留明确标为合成的测试项目，不清理用户数据。结果存放于被忽略的 `.runtime/`，对外报告只保留汇总和合成截图。不要把原始目录整体上传。

## 尚未获授权的操作

本轮没有运行 `ai:check` 或任何 `--with-ai`，也没有推送、部署、上传或联系参与者。下一轮若要测试真实新提示词，先明确调用范围、费用和仅使用合成输入，得到授权后再执行。费用上限不能只靠本地程序猜测，供应商计费应另行核对。

若后续中断，先看 `OPTIMIZATION-PROGRESS.md` 和当前Git状态，核对北京时间截止2026-11-01 12:00。过期后不自动继续大改。本轮没有设置会话自动恢复或持续执行任务。
