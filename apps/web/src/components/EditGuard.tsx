import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import './edit-guard.css';

type Editor = { label: string; dirty: boolean; save: () => Promise<boolean> };
type Guard = { register: (key: string, read: () => Editor) => () => void; protect: (action: () => void) => void; hasDirty: () => boolean };
const Context = createContext<Guard | null>(null);
export function EditGuardProvider({ children }: { children: ReactNode }) {
  const editors = useRef(new Map<string, () => Editor>());
  const pending = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const dirtyEditors = useCallback(() => [...editors.current.values()].map(read => read()).filter(editor => editor.dirty), []);
  const register = useCallback((key: string, read: () => Editor) => {
    editors.current.set(key, read);
    return () => { if (editors.current.get(key) === read) editors.current.delete(key); };
  }, []);
  const hasDirty = useCallback(() => dirtyEditors().length > 0, [dirtyEditors]);
  const protect = useCallback((action: () => void) => {
    if (pending.current) return; // Do not replace the destination on repeated clicks.
    const dirty = dirtyEditors();
    if (!dirty.length) { action(); return; }
    pending.current = action;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLabels(dirty.map(editor => editor.label)); setError('');
    dialog.current?.showModal();
  }, [dirtyEditors]);
  function finish(proceed: boolean) {
    if (saving.current) return;
    const action = pending.current; pending.current = null;
    dialog.current?.close();
    trigger.current?.isConnected && trigger.current.focus({ preventScroll: true });
    if (proceed) action?.();
  }
  async function saveAndContinue() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      for (const editor of dirtyEditors()) if (!(await editor.save())) throw new Error('save_failed');
      saving.current = false; finish(true);
    } catch { setError('保存未成功，已留在当前编辑位置。请检查页面中的错误后重试，或选择留在此页。'); }
    finally { saving.current = false; setBusy(false); }
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (hasDirty()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasDirty]);
  return <Context.Provider value={{ register, protect, hasDirty }}>{children}<dialog ref={dialog} className="edit-guard-dialog" aria-labelledby="edit-guard-title" onCancel={event => { event.preventDefault(); finish(false); }} onKeyDown={event=>{
    if(event.key!=='Tab')return;
    const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const first=buttons[0],last=buttons.at(-1);
    if(!first){event.preventDefault();return;}
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }}>
    <h2 id="edit-guard-title">保留未保存的编辑</h2><p>以下内容尚未保存：{labels.join('、')}。保存成功后才能继续离开。</p>
    {error && <p role="alert" className="alert error">{error}</p>}
    <div className="form-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => finish(false)} autoFocus>留在此页</button><button className="button secondary" type="button" disabled={busy} onClick={() => finish(true)}>放弃并继续</button><button className="button primary" type="button" disabled={busy} onClick={() => void saveAndContinue()}>{busy ? '正在保存…' : '保存并继续'}</button></div>
  </dialog></Context.Provider>;
}
export function useEditGuard() { const guard = useContext(Context); if (!guard) throw new Error('EditGuardProvider is required'); return guard; }
export function useUnsavedEdit(key: string, editor: Editor) {
  const { register } = useEditGuard(); const current = useRef(editor); current.current = editor;
  useEffect(() => register(key, () => current.current), [key, register]);
}
