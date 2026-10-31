// Storage remains backward compatible. Generation never silently truncates stored text.
export const REQUIREMENT_STORAGE_LIMIT = 50_000;
export const REQUIREMENT_GENERATION_LIMIT = 20_000;
export function requirementGenerationIssue(content: string) {
  return content.length > REQUIREMENT_GENERATION_LIMIT ? {
    error: 'requirement_generation_limit', actual: content.length, limit: REQUIREMENT_GENERATION_LIMIT,
    message: '需求完整保留，但超过单次生成的 20000 字符边界。请拆分为可独立验收的需求范围后再生成；本次未调用模型，也未丢弃尾部内容。',
  } : undefined;
}
export function requirementSegments(content: string, maxLength = 4000) {
  if (!Number.isInteger(maxLength) || maxLength < 2) throw new Error('invalid_segment_size');
  const parts: { part: number; start: number; end: number; content: string }[] = [];
  for (let start = 0; start < content.length;) {
    let end = Math.min(start + maxLength, content.length);
    // Keep surrogate pairs intact while retaining exact original UTF-16 offsets.
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
    parts.push({ part: parts.length + 1, start, end, content: content.slice(start, end) }); start = end;
  }
  return parts;
}
