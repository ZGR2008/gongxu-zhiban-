# 文档中心接口

所有接口需登录并使用 `Authorization: Bearer <token>`；项目必须属于当前用户。`type` 为 `readme`、`requirements`、`design`、`api`、`test_report`、`summary` 之一。

- `GET /projects/:projectId/documents`：返回 `{documents: [...]}`。
- `POST /projects/:projectId/documents/generate`：提交 `{type}`，使用最新已确认需求版本，返回 `201 {document}`。
- `GET /projects/:projectId/documents/:id`：返回 `{document}`。
- `PATCH /projects/:projectId/documents/:id`：提交 `{content}`，返回更新后的 `{document}`。
- `GET /projects/:projectId/documents/:id/export`：下载 `text/markdown; charset=utf-8` 文件。

每份文档保存模型名称、需求版本和生成时间，支持手工编辑。生成上下文包括同一需求版本下已确认 Agent 计划的任务、人工登记的测试状态；明细最多各 50 条，测试数量汇总覆盖该版本全部用例。文档前缀展示实际测试状态快照；人工登记不代表系统自动执行，记录之后可能变化。代码、真实 API 和部署材料尚未接入，AI 生成内容必须人工核实，不能视为实际实现或验证结果。

无模型配置时返回 `503 ai_not_configured`；无已确认需求返回 `409 confirmed_requirement_required`；模型错误、超时和请求频率限制会返回对应错误，不生成伪造文档。
