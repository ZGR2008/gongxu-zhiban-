export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string; before: number | null; after: number | null };

/** Bounded, line-level comparison. Large replacement blocks avoid quadratic work. */
export function compareLines(before: string, after: string) {
  const split = (value: string) => value ? value.replace(/\r\n?/g, '\n').split('\n') : [];
  const a = split(before); const b = split(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const left = a.slice(prefix, a.length - suffix); const right = b.slice(prefix, b.length - suffix);
  const rows: DiffLine[] = [];
  let oldLine = 1; let newLine = 1;
  const add = (kind: DiffLine['kind'], text: string) => rows.push({ kind, text, before: kind === 'added' ? null : oldLine++, after: kind === 'removed' ? null : newLine++ });
  for (let i = 0; i < prefix; i++) add('same', a[i]);
  const coarse = (left.length + 1) * (right.length + 1) > 250000;
  if (coarse || !left.length || !right.length) {
    for (const text of left) add('removed', text);
    for (const text of right) add('added', text);
  } else {
    const width = right.length + 1;
    const table = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
      table[i * width + j] = left[i] === right[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
    let i = 0; let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { add('same', left[i++]); j++; }
      else if (i < left.length && (j === right.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) add('removed', left[i++]);
      else add('added', right[j++]);
    }
  }
  for (let i = a.length - suffix; i < a.length; i++) add('same', a[i]);
  return { rows, coarse, added: rows.filter(row => row.kind === 'added').length, removed: rows.filter(row => row.kind === 'removed').length };
}

export function requirementText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') return content.text;
  return JSON.stringify(content, null, 2) ?? '';
}
