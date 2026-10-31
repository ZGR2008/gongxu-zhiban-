import { useEffect, useRef, useState } from 'react';
import { RichContent } from './ContentView';
import { RequestScope } from './request-scope';

type Revision = { revision: number; content: string; savedAt: string; recordedAt: string };
export function DocumentRevisionHistory({ request, base, revision, disabled, onRestore }: {
  request: <T>(path: string, options?: RequestInit) => Promise<T>; base: string; revision: number; disabled: boolean; onRestore: (value: string) => void;
}) {
  const [open, setOpen] = useState(false), [rows, setRows] = useState<Revision[]>([]), [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const scope = useRef(new RequestScope());
  async function load(before?: number) {
    const ticket = scope.current.begin(base); setLoading(true); setError('');
    try {
      const result = await request<{ history: Revision[]; nextCursor: number | null }>(`${base}/history${before ? `?beforeRevision=${before}` : ''}`, { signal: ticket.signal });
      if (!scope.current.accepts(ticket, base)) return;
      setRows(old => before ? [...old, ...result.history] : result.history); setCursor(result.nextCursor);
    } catch (error) { if (scope.current.accepts(ticket, base)) setError(error instanceof Error ? error.message : '修订记录读取失败。'); }
    finally { if (scope.current.accepts(ticket, base)) setLoading(false); }
  }
  useEffect(() => { if (open) void load(); return () => scope.current.cancel(); }, [open, revision, base, request]);
  return <section className="editor-panel document-history"><button className="text-link" type="button" aria-expanded={open} aria-controls="document-revisions" onClick={() => setOpen(value => !value)}>修订记录 {open ? '收起 ↑' : '展开 ↓'}</button>
    {open && <div id="document-revisions"><p>已保存的历史文本只读。恢复只放入编辑区，需再次保存；启用修订记录之前的修改不可追溯。</p>
      {error && <p role="alert" className="alert error">{error}<button type="button" onClick={() => void load()}>重试读取</button></p>}
      {rows.map(row => <details key={row.revision}><summary>修订 {row.revision} · {new Date(row.savedAt).toLocaleString('zh-CN')}</summary><div className="document-remote" role="region" tabIndex={0} aria-label={`历史修订 ${row.revision}`}><RichContent value={row.content} /></div><button type="button" className="button secondary" disabled={disabled} onClick={() => onRestore(row.content)}>使用修订 {row.revision} 编辑</button></details>)}
      {loading ? <p role="status">正在读取修订记录…</p> : !error && !rows.length ? <p>尚无历史修订。当前为修订 {revision}。</p> : null}
      {cursor && <button className="button secondary" type="button" disabled={loading} onClick={() => void load(cursor)}>读取更早的修订</button>}
    </div>}
  </section>;
}
