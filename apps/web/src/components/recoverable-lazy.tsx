import { lazy, type ComponentType } from 'react';
import { useEditGuard } from './EditGuard';

function WorkspaceLoadFailure() {
  const { protect } = useEditGuard();
  return <section className="state-block workspace-load-failure" role="alert">
    <h3>此工作区暂时无法加载</h3>
    <p>请检查连接后重新加载页面，也可以先通过导航使用其他工作区。</p>
    <p>重新加载前会询问如何处理未保存的编辑；保存失败将留在此页。</p>
    <button className="button secondary" type="button" onClick={() => protect(() => window.location.reload())}>重新加载页面</button>
  </section>;
}

// Catch only module loading failures, leaving mounted sibling editors intact.
// Browser/module caches can retain rejected imports, so recovery is an explicit,
// edit-guarded page reload. This does not hide errors thrown by business rendering.
export function recoverableLazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy<T>(async () => {
    try { return await load(); }
    // Preserve the imported component's exact caller contract. The error view
    // intentionally ignores those props and can render for every work area.
    catch { return { default: WorkspaceLoadFailure as unknown as T }; }
  });
}
