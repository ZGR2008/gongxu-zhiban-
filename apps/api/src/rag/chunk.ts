/** A page of extracted text. Plain text files have no page number. */
export interface TextPage { page: number | null; text: string }
export interface TextChunk { page: number | null; content: string; startOffset: number; endOffset: number }

/** Split each page separately so a citation never points at the wrong page. */
export function chunkPages(pages: TextPage[], size = 1000, overlap = 150): TextChunk[] {
  if (!Number.isInteger(size) || size < 100 || !Number.isInteger(overlap) || overlap < 0 || overlap >= size) {
    throw new Error('Invalid chunk size or overlap');
  }
  const chunks: TextChunk[] = [];
  for (const { page, text } of pages) {
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + size, text.length);
      if (end < text.length) {
        // Prefer a nearby sentence or paragraph boundary, without creating tiny chunks.
        const window = text.slice(start + Math.floor(size * 0.6), end);
        const boundary = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('. '));
        if (boundary >= 0) end = start + Math.floor(size * 0.6) + boundary + 1;
      }
      const raw = text.slice(start, end);
      const leading = raw.length - raw.trimStart().length;
      const content = raw.trim();
      if (content) chunks.push({ page, content, startOffset: start + leading, endOffset: start + leading + content.length });
      if (end === text.length) break;
      start = Math.max(start + 1, end - overlap);
    }
  }
  return chunks;
}
