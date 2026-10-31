import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditGuard } from './EditGuard';

/** Restore the history cursor before asking: Cancel keeps both URL and editor mounted. */
export function useGuardedRoute(onCommit: (path: string) => void) {
  const { protect, hasDirty } = useEditGuard();
  const [path, setPath] = useState(window.location.pathname);
  const current = useRef({ path, index: Number(history.state?.gongxuIndex ?? 0) });
  const callback = useRef(onCommit); callback.current = onCommit;
  const restoring = useRef<null | (() => void)>(null);
  const approvedPop = useRef(false);
  const commit = useCallback((next: string, index: number) => {
    current.current = { path: next, index }; callback.current(next); setPath(next);
  }, []);
  const navigate = useCallback((next: string) => {
    if (next === current.current.path) return;
    protect(() => {
      const index = current.current.index + 1;
      history.pushState({ gongxuIndex: index }, '', next);
      commit(next, index); window.scrollTo(0, 0);
    });
  }, [protect, commit]);
  useEffect(() => {
    history.replaceState({ ...history.state, gongxuIndex: current.current.index }, '', location.href);
    const pop = () => {
      if (restoring.current) { const ask = restoring.current; restoring.current = null; ask(); return; }
      const next = location.pathname;
      const known = Number.isInteger(history.state?.gongxuIndex);
      const index = known ? history.state.gongxuIndex as number : current.current.index + 1;
      if (approvedPop.current || !hasDirty()) {
        approvedPop.current = false;
        if (!known) history.replaceState({ ...history.state, gongxuIndex: index }, '', location.href);
        commit(next, index); return;
      }
      const delta = index - current.current.index;
      if (known && delta !== 0) {
        restoring.current = () => protect(() => { approvedPop.current = true; history.go(delta); });
        history.go(-delta);
      } else {
        history.replaceState({ gongxuIndex: current.current.index }, '', current.current.path);
        navigate(next);
      }
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [commit, hasDirty, navigate, protect]);
  return { path, navigate };
}
