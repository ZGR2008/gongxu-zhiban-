import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { RichContent, CopyButton } from './ContentView';
import { compareLines, requirementText } from './line-diff';
import './requirement-history.css';

type Version = { id: string; version: number; content: unknown; status: string; createdAt: string };
export function RequirementHistory({ versions, draft, onRestore, busy, formatDate }: {
  versions: Version[]; draft: string; onRestore: (text: string, onApplied: () => void) => void; busy: boolean; formatDate: (value: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('draft');
  const [view, setView] = useState<'compare' | 'preview'>('compare');
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [limit, setLimit] = useState(400);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const restoreCancel = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const sourceLabel = useId(); const targetLabel = useId();
  const ordered = [...versions].sort((a, b) => b.version - a.version);
  const source = ordered.find(item => item.id === sourceId) ?? ordered[0];
  const target = ordered.find(item => item.id === targetId);
  const before = source ? requirementText(source.content) : '';
  const after = targetId === 'draft' ? draft : target ? requirementText(target.content) : '';
  const diff = useMemo(() => open ? compareLines(before, after) : { rows: [], coarse: false, added: 0, removed: 0 }, [open, before, after]);
  const rows = onlyChanges ? diff.rows.filter(row => row.kind !== 'same') : diff.rows;
  useEffect(() => {
    if (!open) return;
    const modal = dialog.current;
    modal?.showModal();
    return () => modal?.close();
  }, [open]);
  useEffect(() => {
    if (!confirmRestore) return;
    restoreCancel.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    restoreCancel.current?.focus({ preventScroll: true });
  }, [confirmRestore]);
  const show = (id: string, mode: 'compare' | 'preview', trigger: HTMLButtonElement) => {
    opener.current = trigger;
    setSourceId(id); setTargetId('draft'); setView(mode); setOnlyChanges(false); setLimit(400); setConfirmRestore(false); setNotice(''); setOpen(true);
  };
  const resetComparison = () => { setLimit(400); setConfirmRestore(false); };
  return <div className="requirement-history">
    <div className="history-heading"><h3>版本记录</h3>{ordered.length > 0 && <button className="text-link" type="button" onClick={event => show(ordered[1]?.id ?? ordered[0].id, 'compare', event.currentTarget)}>比较版本</button>}</div>
    {ordered.length ? <ul className="version-list">{ordered.map(item => <li key={item.id}><button type="button" className="history-version" aria-label={`查看需求版本 ${item.version}`} onClick={event => show(item.id, 'preview', event.currentTarget)}><span>版本 {item.version}<small>{item.status === 'confirmed' ? '已确认' : '草稿'}</small></span><time>{formatDate(item.createdAt)}</time><span className="history-view">查看 →</span></button></li>)}</ul> : <p>保存后可在这里查看版本记录。</p>}
    {notice && <p className="history-notice" role="status">{notice}</p>}
    <dialog className="history-dialog" ref={dialog} aria-labelledby={headingId} onClose={() => { setOpen(false); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }} onCancel={() => setConfirmRestore(false)}>
      {open && <><header className="history-dialog-header"><div><span className="eyebrow">REQUIREMENT HISTORY</span><h2 id={headingId}>看清每一次需求变化</h2><p>历史版本只读。按文本行对比，不判断语义或正确性。</p></div><button className="icon-button" type="button" aria-label="关闭需求版本对比" onClick={() => setOpen(false)}>×</button></header>
        <div className="history-controls"><div className="history-selector"><label htmlFor={sourceLabel}>历史版本</label><select id={sourceLabel} value={source?.id ?? ''} onChange={event => { setSourceId(event.target.value); resetComparison(); }}>{ordered.map(item => <option key={item.id} value={item.id}>版本 {item.version} · {item.status === 'confirmed' ? '已确认' : '草稿'}</option>)}</select></div><div className="history-selector"><label htmlFor={targetLabel}>对比目标</label><select id={targetLabel} value={targetId} disabled={view === 'preview'} onChange={event => { setTargetId(event.target.value); resetComparison(); }}><option value="draft">当前编辑区（含未保存内容）</option>{ordered.map(item => <option key={item.id} value={item.id}>版本 {item.version} · 已保存</option>)}</select></div><div className="history-view-tabs" role="group" aria-label="版本阅读方式"><button type="button" aria-pressed={view === 'compare'} onClick={() => setView('compare')}>差异对比</button><button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>版本预览</button></div></div>
        {view === 'compare' ? <><div className="history-diff-summary"><span>V{source?.version} → {targetId === 'draft' ? '当前编辑区' : `V${target?.version}`}</span><span className="diff-added-count">+ {diff.added} 行</span><span className="diff-removed-count">− {diff.removed} 行</span><label><input type="checkbox" checked={onlyChanges} onChange={event => { setOnlyChanges(event.target.checked); setLimit(400); }}/><span>只看变化</span></label></div>{diff.coarse && <p className="history-diff-hint">差异段较长，按整段替换展示，增删行数不代表最小修改量。</p>}
          {!diff.added && !diff.removed ? <div className="history-identical" role="status">两个版本内容相同，没有增删行。</div> : null}
          <div className="history-diff" tabIndex={0} role="region" aria-label="需求逐行差异"><div className="diff-column-labels"><span>原行</span><span>新行</span><span>变化</span><span>文本内容</span></div>{rows.slice(0, limit).map((row, index) => <div key={index} className={`diff-line diff-line--${row.kind}`}><span className="diff-line-number">{row.before ?? ''}</span><span className="diff-line-number">{row.after ?? ''}</span><span className="diff-line-kind" aria-label={row.kind === 'added' ? '新增' : row.kind === 'removed' ? '删除' : '相同'}>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : '·'}</span><code>{row.text || ' '}</code></div>)}{rows.length > limit && <button className="history-more" type="button" onClick={() => setLimit(value => value + 400)}>继续显示后续行（剩余 {rows.length - limit} 行）</button>}</div>
        </> : <div className="history-preview" tabIndex={0} role="region" aria-label={`需求版本 ${source?.version} 正文`}><RichContent value={before} /></div>}
        <footer className="history-dialog-footer"><p>复制到编辑区后，需点击“保存需求草稿”才会形成新版本。</p><div><CopyButton value={before} label="复制历史文本"/><button className="button secondary" type="button" disabled={busy || !source || before === draft} onClick={() => setConfirmRestore(true)}>使用此版本编辑</button></div></footer>
        {confirmRestore && <div className="history-restore-confirm" role="group" aria-label="确认替换编辑区"><div><strong>将版本 {source?.version} 放入编辑区？</strong><p>下一步可选择保存、放弃或取消；已保存的历史版本会保留。</p></div><div><button ref={restoreCancel} className="button secondary" type="button" onClick={() => setConfirmRestore(false)}>保留当前编辑</button><button className="button primary" type="button" disabled={busy} onClick={() => { dialog.current?.close(); setOpen(false); setConfirmRestore(false); onRestore(before, () => setNotice(`版本 ${source?.version} 已放入编辑区，尚未保存。`)); }}>替换编辑区内容</button></div></div>}
      </>}
    </dialog>
  </div>;
}
