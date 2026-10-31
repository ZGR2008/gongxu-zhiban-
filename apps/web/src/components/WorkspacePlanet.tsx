import { useState } from 'react';
import './workspace-skin.css';

const rings = ['outer', 'middle', 'inner'] as const;
const layers = ['back', 'front'] as const;
const stars = [[11, 19], [43, 12], [80, 29], [90, 66], [22, 72], [56, 85], [12, 48], [73, 15], [35, 35], [82, 85], [36, 91], [92, 45]];

/** Decorative only: motion controls never change project or Agent state. */
export function WorkspacePlanet() {
  const [paused, setPaused] = useState(false);

  return (
    <div className="hero-visual workspace-visual" data-motion={paused ? 'paused' : 'running'}>
      <div className="workspace-atmosphere" aria-hidden="true">
        <div className="workspace-nebula workspace-nebula--one" />
        <div className="workspace-nebula workspace-nebula--two" />
        <svg className="workspace-stars" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          {stars.map(([x, y], index) => <circle className="workspace-star" key={index} cx={x} cy={y} r={index % 3 === 0 ? 0.2 : 0.16} />)}
        </svg>
      </div>

      <div className="gx-planet" aria-hidden="true">
        {layers.flatMap(layer => rings.map(ring => (
          <div key={`${layer}-${ring}`} className={`gx-orbit gx-orbit--${ring} gx-orbit--${layer}`}>
            {/* Fixed half-plane masks keep the orbit behind/in front of the sphere. */}
            <div className="gx-orbit__mask">
              <div className="gx-orbit__spin">
                <svg viewBox="0 0 200 200" focusable="false">
                  <circle className="gx-orbit__track" cx="100" cy="100" r="90" />
                  <circle className="gx-orbit__trail" cx="100" cy="100" r="90" pathLength="100" strokeDasharray="10 90" />
                  <circle cx="190" cy="100" r="7" fill="currentColor" opacity="0.16" />
                  <circle cx="190" cy="100" r="2.5" fill="currentColor" />
                </svg>
              </div>
            </div>
          </div>
        )))}
        <div className="gx-planet__sphere" />
      </div>

      <div className="workspace-visual__caption" aria-hidden="true">
        <span /> IDEA <span className="workspace-visual__arrow">→</span> DELIVERY
      </div>
      <button
        type="button"
        className="workspace-motion-toggle"
        onClick={() => setPaused(value => !value)}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
          {paused
            ? <path d="M5 3.5 12 8l-7 4.5Z" fill="currentColor" />
            : <path d="M5 4v8M11 4v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </svg>
        {paused ? '继续动效' : '暂停动效'}
      </button>
    </div>
  );
}
