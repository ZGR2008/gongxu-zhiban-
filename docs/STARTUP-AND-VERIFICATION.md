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

迁移010—021都是增量结构，包含条目追踪、用例/文档历史、证据变更、Agent心跳/审核、任务—用例配对、独立代码草稿及审查来源快照，安全和恢复范围见 `TRACEABILITY-AND-RECOVERY.md`。不得把旧源码直接挂到已升级的真实库，也不逆向删除新增列或历史。真实数据没有附在评审ZIP中；注册自己的测试账号，不需要共享任何用户账号密码。

文档及用例写入必须提供当前修订号，代码草稿保存也校验修订，缺省返回428、冲突返回409；计划采用必须明确勾选人工审核。需要配套更新前后端。保存代码草稿不调用AI，明确“提交审查”才调用；保存知识资料不自动建立索引。会话失效/跨标签换账号将清除旧会话内存状态，正常退出仍先处理未保存编辑。

需求`PATCH /projects/:projectId/requirements/:id`需提交`{content, expectedContent}`，确认`POST .../:id/confirm`需提交`{expectedContent}`；核对字段必须是之前已读取的完整原文，不是自动另读一次后替换。缺少原文428，原文或最新版本变化409，已确认不可改；客户端应保留输入、重新读取后由人审核。此改动无新迁移，001—021及所有历史保留；旧脚本须更新请求，不能为兼容无条件确认而跳过保护。

读取恢复：普通GET的完整响应有15秒截止，损坏JSON及项目结构显示错误后可重试；写入/生成保留原取消与时限。工作区脚本下载失败仅显示局部恢复界面；整页重新加载仍需先处理未保存编辑，保存失败不离开。运行回看在三类读取完成后才进入下个自动刷新周期。

RAG回答保留`answer/sources/reason`字段。有效回答兼容旧模型JSON；新JSON支持`status: answered | insufficient_evidence`。资料不足分支须零引用，响应`reason: insufficient_evidence`且`sources: []`，另以`candidates`提供实际召回片段，不能当作支持答案的引用。零命中仍不调用模型。没有迁移，也没有把新语义判定称为真实模型验证。

## 本轮验证入口

v4推荐统一入口：`pnpm verify`（默认离线）、`pnpm verify --suite=browser`、`pnpm verify --suite=accessibility`、`pnpm verify --suite=database`。离线包含所有根目录JS回归和Python打包回归，不读取真实.env或调用数据库、模型；每层结果独立保存在`.runtime/verification-v4-<id>/report.json`。Python不在PATH时显式提供`--python=<已有解释器绝对路径>`。数据库层由脚本在正确的API工作目录启动，使用既有配置和新合成记录；真实模型不在统一入口中。

本轮已应用020与021增量迁移。执行登记需同时提供`expectedRevision`和`expectedExecutionRevision`，分别对应定义与执行快照；旧执行令牌409，缺少令牌428。定义变更使旧执行令牌失效。分段审核独立保存`reviewRevision`，只允许当前确认需求，冲突后保留输入由人比较。前后端必须配套升级，不能把旧客户端重新接回升级后的真实库。

020不会删除旧用例或历史，以0初始化独立执行令牌。021新增审核及历史表，原始需求保持不变。回退时保留新增列和历史，先核对兼容性，不逆向删除真实数据。更详细恢复边界见`LONG-REQUIREMENTS-V4.md`和`CONTINUATION-V4.md`。

| 命令 | 验证范围 | 网络/数据边界 |
| --- | --- | --- |
| `pnpm test` | API与本地Embedding测试，含新的可靠性和追踪规则 | 使用替身与本地文件，不发起收费模型请求 |
| `pnpm test:ui-models`、`pnpm test:workbench` | 需求差异、概览和交付规则 | 纯规则测试 |
| `pnpm test:evidence`、`pnpm test:eval-report` | 依据过期与评测记录完整性/可比性 | 合成规则数据，不代表模型语义判断 |
| `pnpm test:review-package` | 没有.git的源码副本也能检查模板 | 合成临时目录，不读真实.env |
| `pnpm test:source-provenance` | 无Git、父仓库、自己的未提交修改和历史捕获拒绝 | 独立临时合成仓库，无全局Git配置修改、无上传；未知版本保持null |
| `pnpm typecheck`、`pnpm build` | 类型与生产构建 | 不代表视觉或真实AI验收 |
| `pnpm verify:reliability-ui` | 乱序、失败、编辑保护、历史、焦点、取消、动效 | 浏览器受控响应，外部网络被阻止 |
| `pnpm verify:web-entry` | 冻结本机生产构建，测首屏脚本资源且首页不加载排版库 | 临时回环静态服务及受控API，不读环境/DB/模型；先构建web |
| `pnpm verify:local -- --browser` | 真实本地DB、版本证据、权限、桌面HTTP与可选本地Embedding | 新建合成账号/项目，真实模型回复使用替身；不操作已有用户项目 |
| `pnpm eval:offline` | 8个版本化案例的实现协议检查 | 阻止网络调用；语义效果未评估 |
| `pnpm eval:prepare`、`pnpm eval:report` | 捕获合成输入与核对明确提供的评测记录 | 不读取.env；不执行模型；缺少真实结果时保持待执行 |
| `pnpm eval:prepare-historical`、`pnpm test:historical-source` | 固定本地Git提交的原始提示词组织及同输入配对检查 | 仅必要源码、合成存储与检索替身；拒绝网络，无历史数据库/模型执行；无Git副本不可重做历史捕获 |
| `pnpm verify:fresh-database` | 新建隔离空数据库，实际迁移CLI运行两次，HTTP确认需求与保存草稿 | 仅使用现有本机角色权限；保留合成数据库，不改真实库或权限；4组通过，不等于全新机器安装 |
| `pnpm verify:agent-recovery` | 过期运行、取消、重复请求与人工审核 | 真实本地DB、模型替身；保留合成运行记录 |
| `pnpm verify:review-context` | 审查来源、换版、隔离、取消、桌面原文显示 | 真实本地DB/向量/浏览器；聊天替身；禁止外部网络，不执行输入代码 |
| `pnpm verify:document-context` | 完整说明末尾、51条/30000字符阻止、账号和桌面恢复 | 真实本地DB/HTTP/浏览器，1次聊天替身；不截断、无收费 |
| `pnpm verify:knowledge-answer` | 检索/模型期间实际HTTP断开、取消信号、容量恢复与来源隔离 | 真实本地DB/向量/HTTP，聊天替身；不调用收费模型 |
| `pnpm verify:test-list` | 201条分页、完整统计、修订失效、微秒/同时间戳、跨账号与三个桌面页面 | 真实本地DB/HTTP/浏览器；新建合成项目，没有聊天或向量调用 |
| `pnpm verify:document-list` | 102份目录分页、隐藏类型完整摘要、历史/账号隔离、修订/导出与三个桌面页面 | 真实本地DB/HTTP/浏览器；新建合成文档，没有聊天或向量调用 |
| `pnpm verify:knowledge-list` | 201份资料完整分页、最早资料手动索引、草稿保留、账号/游标边界 | 真实本地DB/向量/HTTP/桌面；只索引新建合成资料，无聊天 |
| `pnpm verify:index-compatibility` | 当前索引、旧模型标识排除、手动重建失败与恢复、原文和上传草稿 | 真实本地DB/向量/HTTP/桌面，新建合成资料；旧身份及断网为受控注入，无聊天 |
| `pnpm verify:embedding-mixed` | 三账号实际索引/检索与Agent共用推理队列，第四账号排队取消及恢复、资料/活动隔离 | 真实回环HTTP/DB/向量；4个新合成账号，聊天替身1次；不注入服务延迟、不代表课堂容量 |
| `pnpm verify:requirement-preconditions` | 原文核对、并发更新/确认、最新版本、账号隔离及桌面刷新保护 | 真实本地HTTP/DB/浏览器；仅保存失败为受控响应，不调用模型 |
| `pnpm verify:trace-concurrency` | 12个首次追踪读取、当前/历史版本、审核保留和证据修订 | 实际HTTP及SQL；测试门闩协调首批查询同时开始，不模拟数据库回复、不代表课堂容量 |
| `pnpm test:request-transport` | 8项完整响应截止、取消、JSON损坏、非JSON错误及慢POST | 真实回环HTTP，合成响应；不读配置/DB/模型 |
| `pnpm verify:production-recovery` | 冻结实际构建，模块下载失败时保留导航/草稿及受保护重载 | 临时回环静态服务，全部API合成拦截；无外部调用 |
| `pnpm verify:accessibility` | 24个桌面页面/弹窗的axe规则、可访问名称和ARIA | 全部合成API；自动结果不含人工对比度/屏幕阅读器验收；见ACCESSIBILITY-V3.md |
| `pnpm eval:retrieval-local` | 冻结15篇合成资料及16问题的实际检索测量 | 真实本地向量/pgvector，不执行聊天；保留未召回和未评估语义支持 |
| `pnpm verify:growth-scope` | 当前/历史统计、多个项目、账号隔离与桌面范围切换 | 真实本地DB/HTTP/浏览器；新建合成记录，无模型调用 |
| `pnpm smoke --with-rag` | 实际运行API/数据库/PDF/本地索引及检索 | 先核对Embedding为已授权的本机服务；不用`--with-ai` |
| `pnpm smoke:browser`、`pnpm smoke:project-controls`、`pnpm smoke:ui`、`pnpm smoke:workbench` | 旧界面与核心流程回归 | 无`--with-ai`时增加收费接口拦截；部分场景受控替身 |
| `pnpm smoke:visual` | 独立WebGL预览像素、暂停、键盘及恢复 | 本地资产，不是AI算法或教学效果证据 |

上述真实联调会保留明确标为合成的测试项目，不清理用户数据。结果存放于被忽略的 `.runtime/`，对外报告只保留汇总和合成截图。不要把原始目录整体上传。

受控可靠性脚本支持`--engine=webkit`和`--engine=firefox`；Windows可先设置`$env:PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browsers"`复用已装缓存。引擎30秒内未启动就标为未执行；CDP CPU减速场景只在Chromium执行，其他引擎不冒报通过。以下三引擎数字为v3历史结果，v4见最终报告。v3最终Edge86组通过；Firefox157.0完整85组通过、CDP CPU减速1组未执行；Windows WebKit27.2完整84组通过，CDP及完整系统强制调色板2组未执行（该引擎只触发媒体规则，未完整模拟系统调色板）。Firefox最初在受限子进程环境超时，正常本机测试进程实际运行成功，未改变安全设置。最终固定源码后三引擎完整套件分别留存，不能混成一个跨引擎通过率。Windows WebKit结果不是Safari真机验收，浏览器模拟也不等于Windows高对比度或屏幕阅读器真机验收。

## 尚未获授权的操作

本轮没有运行 `ai:check` 或任何 `--with-ai`，也没有推送、部署、上传或联系参与者。下一轮若要测试真实新提示词，先明确调用范围、费用和仅使用合成输入，得到授权后再执行。费用上限不能只靠本地程序猜测，供应商计费应另行核对。

若后续中断，先看 `CONTINUATION-V4.md` 的最新阶段与可复制续跑指令、当前Git状态。用户已取消所有固定研发截止时间，以本轮任务完成并验证或确实需要授权/环境为结束条件。`CONTINUATION-2026-11-01.md`与`OPTIMIZATION-PROGRESS.md`保留历史过程，旧时间安排不再生效。本轮没有设置会话自动恢复或持续执行任务。
