/** Import provenance is separate from a test's later execution result. */
export function materialSourceLabel(modelName?: string | null): string {
  if (modelName === 'demo-material-import-v1') {
    return '演示资料导入 · AI 辅助编写 · 未调用平台模型 · 待人工审核';
  }
  return modelName?.trim() ? `模型来源：${modelName} · 需人工审核` : '资料来源未记录，需人工核对';
}

export function executionRecordLabel(result?: string | null): string {
  if (result === 'not_run') return '未执行，未登记执行结果';
  const outcomes: Record<string, string> = { passed: '通过', failed: '失败', blocked: '阻塞' };
  return result && outcomes[result] ? `${outcomes[result]}（人工登记）` : '执行状态未识别，需核对记录';
}
