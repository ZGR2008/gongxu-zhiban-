import { useCallback, useEffect, useState } from 'react';

type Connection = 'checking' | 'online' | 'offline';

const phases = ['需求分析', '任务规划', '知识检索', '代码审查', '测试设计', '项目交付'];

export default function App() {
  const [connection, setConnection] = useState<Connection>('checking');

  const checkHealth = useCallback(async () => {
    setConnection('checking');
    try {
      const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Service unavailable');
      setConnection('online');
    } catch {
      setConnection('offline');
    }
  }, []);

  useEffect(() => { void checkHealth(); }, [checkHealth]);

  return (
    <div className="min-h-screen bg-canvas text-ink md:flex">
      <aside className="bg-brand px-6 py-7 text-white md:min-h-screen md:w-64 md:shrink-0 md:px-8">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#c8f18d] text-lg font-bold text-brand" aria-hidden="true">工</span>
          <div><div className="text-lg font-semibold tracking-wide">工序智伴</div><div className="text-xs text-white/55">GONGXU AI</div></div>
        </div>
        <div className="mt-12 hidden text-xs font-medium tracking-[0.2em] text-white/45 md:block">工作空间</div>
        <div className="mt-4 rounded-xl bg-white/10 px-4 py-3 text-sm font-medium">项目工作台</div>
        <p className="mt-8 hidden text-xs leading-6 text-white/50 md:block">从一个想法开始，<br />在实践中掌握软件工程。</p>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-7 sm:px-10 lg:px-14">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
          <div><p className="text-xs font-semibold tracking-[0.18em] text-accent">WORKSPACE / 基础架构</p><h1 className="mt-2 text-2xl font-semibold">项目工作台</h1></div>
          <div className="flex items-center gap-3 text-sm" role="status" aria-live="polite">
            <span className={`h-2 w-2 rounded-full ${connection === 'online' ? 'bg-emerald-500' : connection === 'checking' ? 'bg-amber-400' : 'bg-rose-500'}`} />
            <span className="text-muted">{connection === 'online' ? '后端进程已连接' : connection === 'checking' ? '正在检查后端' : '后端未连接'}</span>
            <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium hover:border-accent" onClick={() => void checkHealth()} type="button">重新检查</button>
          </div>
        </header>
        <section className="mt-10 max-w-5xl">
          <p className="text-sm font-medium text-accent">软件工程实训 · AI 智能伙伴</p>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">让每一个想法，<br />走完真正的开发流程。</h2>
          <p className="mt-5 max-w-xl text-sm leading-7 text-muted">工序智伴将连接需求、开发、审查与交付，帮助你在完整项目中练习软件工程。目前正在建设基础架构。</p>
          <div className="mt-10 rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-base font-semibold">一条完整的实训路径</h3><span className="text-xs text-muted">功能将在后续阶段逐步开放</span></div>
            <ol className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {phases.map((phase, index) => <li key={phase} className="flex items-center gap-3 border-t border-line pt-4"><span className="font-mono text-xs text-accent">0{index + 1}</span><span className="text-sm font-medium">{phase}</span></li>)}
            </ol>
          </div>
          <p className="mt-6 text-xs leading-6 text-muted">当前页面用于验证前后端基础连接。项目管理、AI 服务及实训功能尚未开放。</p>
        </section>
      </main>
    </div>
  );
}
