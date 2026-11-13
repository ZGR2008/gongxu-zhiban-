# V10 文档导航

当前项目与评审入口以[仓库 README](../README.md)为准。

## 运行与工程说明

- [启动与恢复](STARTUP-AND-VERIFICATION.md)、[Windows 启动链修复记录](STARTUP-REPAIR-2026-11-03.md)
- [需求追踪与恢复](TRACEABILITY-AND-RECOVERY.md)、[长需求规划机制](LONG-REQUIREMENTS-V5.md)
- [教学权限](TEACHING-AND-PERMISSIONS-V6.md)、[教师任务版本](TEACHING-VERSIONS-V7.md)
- [公共课程来源](KNOWLEDGE-CURRICULUM-V6.md)、[课程审核边界](CURRICULUM-REVIEW-V7.md)
- [当前验证范围与部署差异](REVIEW-STATUS.md)、[源码包导出](SOURCE-PACKAGE.md)、[部署与重新部署](DEPLOYMENT.md)

## 真实 AI 与质量证据

- [V10 长需求补验](AI-LONG-PLAN-V10.md)、[失败定位](LONG-PLAN-DIAGNOSIS-V10.md)
- [AI 辅助初审，非独立人工审核](AI-QUALITY-PRELIMINARY-V10.md)、[离线人工审核方法](OFFLINE-QUALITY-REVIEW-V10.md)
- [历史 12 次模型评测](AI-EVALUATION-V4-2026-11-01.md)、[历史响应审核包](AI-REVIEW-PACK-V5.md)、[v7 长需求与教师点评](AI-REVIEW-PACK-V7.md)
- [第三方许可与 AI 参与说明](ORIGINALITY-AND-LICENSE-V8.md)、[当时的比赛规则来源记录](COMPLIANCE-SOURCES-V9.md)

文件名中的历史版本号表示该说明或证据的形成阶段，不表示功能已过时。各次调用、测试和审核按文中时间范围理解；历史报告不能自动证明当前提交已经重新验证。

## 保留的输入与归档

`verification/` 保留带时间范围的机器可读证据；`screenshots/` 保留历史合成截图及生成器依赖。`demo-v3/`、`demo-v4/` 的分镜仍被历史录制工具读取，不是最终视频。课程源码在 `knowledge/teaching-v6/`，录制工具在 `demo/recording-kit-v1.mjs`；二者仍有测试依赖。

旧交接、任务表、咨询稿、讲稿、验收模板和生成附件统一在[历史归档](archive/README.md)。原始真实 Git 历史完整保留。
