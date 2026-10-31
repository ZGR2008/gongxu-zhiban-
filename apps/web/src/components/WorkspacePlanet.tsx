import { useEffect, useRef, useState } from 'react';
// Previous CSS preview remains archived; this scene uses the global presentation layer.

/** Isolated open-source WebGL artwork; it never receives project or account data. */
export function WorkspacePlanet() {
  const [paused, setPaused] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  const visibleRef = useRef(true);
  pausedRef.current = paused;
  function sync() {
    frame.current?.contentWindow?.postMessage(
      { type: 'gongxu:orbit-motion', paused: pausedRef.current || !visibleRef.current },
      window.location.origin,
    );
  }
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0]?.isIntersecting ?? true;
        sync();
      },
      { threshold: 0.05 },
    );
    if (container.current) observer.observe(container.current);
    const onReady = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === 'gongxu:orbit-ready'
      )
        sync();
    };
    window.addEventListener('message', onReady);
    return () => {
      observer.disconnect();
      window.removeEventListener('message', onReady);
    };
  }, []);
  useEffect(sync, [paused]);
  return (
    <div
      ref={container}
      className="hero-visual workspace-visual workspace-visual--webgl"
      data-motion={paused ? 'paused' : 'running'}
    >
      <iframe
        ref={frame}
        src="/previews/planet-orbit.html?embed=1"
        title="可拖动的三维星球与旋转粒子星环"
        className="workspace-orbit-frame"
        onLoad={sync}
      />
      <div className="workspace-visual__caption">
        <a href="/previews/planet-orbit.html" target="_blank" rel="noopener noreferrer">
          探索星环 ↗
        </a>
      </div>
      <button
        type="button"
        className="workspace-motion-toggle"
        aria-pressed={paused}
        onClick={() => setPaused((value) => !value)}
      >
        {paused ? '继续动效' : '暂停动效'}
      </button>
    </div>
  );
}
