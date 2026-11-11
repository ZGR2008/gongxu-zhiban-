import { useEffect, useRef, useState } from 'react';
// Previous CSS preview remains archived; this scene uses the global presentation layer.

/** Isolated open-source WebGL artwork; it never receives project or account data. */
export function WorkspacePlanet() {
  // Start automatically while visible; keep the system's reduced-motion preference.
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(reduced);
  const visibleRef = useRef(true);
  pausedRef.current = reduced;
  function sync() {
    frame.current?.contentWindow?.postMessage(
      { type: 'gongxu:orbit-motion', paused: pausedRef.current || !visibleRef.current || document.hidden },
      window.location.origin,
    );
  }
  useEffect(() => {
    const preference=matchMedia('(prefers-reduced-motion: reduce)');
    const changed=()=>{pausedRef.current=preference.matches;setReduced(preference.matches);sync();};
    preference.addEventListener('change',changed);
    // Embedded Chromium can update .matches without emitting the change event.
    const timer=setInterval(()=>{if(!document.hidden&&pausedRef.current!==preference.matches)changed();},1000);
    document.addEventListener('visibilitychange',changed);
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
      preference.removeEventListener('change',changed);
      clearInterval(timer);
      document.removeEventListener('visibilitychange',changed);
      window.removeEventListener('message', onReady);
    };
  }, []);
  useEffect(sync, [reduced]);
  return (
    <div
      ref={container}
      className="hero-visual workspace-visual workspace-visual--webgl"
      data-motion={reduced ? 'paused' : 'running'}
    >
      <iframe
        ref={frame}
        src="/previews/planet-orbit.html?embed=1"
        title="可拖动的三维星球与旋转粒子星环"
        className="workspace-orbit-frame"
        onLoad={sync}
      />
    </div>
  );
}
