import * as THREE from './vendor/three/three.module.min.js';
import { createParticleRing } from './vendor/saturn-webgl/particle-ring.js';

// Isolated visual scene; no application/API/session state or credentials.
const stage = document.querySelector('#canvas-stage');
const loading = document.querySelector('#loading');
const pauseButton = document.querySelector('#motion-toggle');
const focusButton = document.querySelector('#focus-toggle');
const resetButton = document.querySelector('#reset-view');
const status = document.querySelector('#motion-status');
const speedButtons = [...document.querySelectorAll('[data-speed]')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let paused = new URLSearchParams(location.search).has('embed'), speed = 1, elapsed = 0, previousTime = null, frame = null;
let contextLost = false, disposed = false, drag = null, renderer;

function setImmersive(value) {
  document.body.dataset.immersive = String(value);
  focusButton.textContent = value ? '退出沉浸' : '沉浸预览';
  focusButton.setAttribute('aria-pressed', String(value));
}
focusButton.addEventListener('click', () => setImmersive(document.body.dataset.immersive !== 'true'));
document.addEventListener('keydown', event => { if (event.key === 'Escape') setImmersive(false); });

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
} catch {
  loading.replaceChildren(document.createTextNode('当前浏览器未启用三维图形。请启用硬件加速后刷新，或'));
  const link = document.createElement('a');
  link.href = './archive/planet-orbit-css-v2.html';
  link.textContent = '查看上一版预览';
  loading.append(link);
  document.body.dataset.renderer = 'unavailable';
}
if (renderer) initialize().catch(() => {
  renderer.dispose();
  loading.hidden = false;
  loading.replaceChildren(document.createTextNode('三维场景未能完成初始化，请刷新后重试，或'));
  const link = document.createElement('a');
  link.href = './archive/planet-orbit-css-v2.html';
  link.textContent = '查看上一版预览';
  loading.append(link);
  document.body.dataset.renderer = 'unavailable';
});

async function initialize() {
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', new URLSearchParams(location.search).has('embed')
    ? '自动旋转星环。使用方向键调整视角，系统减少动态效果时显示静态画面。'
    : '旋转星环。拖动或使用方向键调整视角，使用下方按钮暂停、调整速度。');
  canvas.setAttribute('role', 'img');
  stage.prepend(canvas);
  renderer.setClearColor(0x0a0614, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 70);
  const system = new THREE.Group();
  scene.add(system);
  const defaultTilt = { x: 0.10, y: 0, z: -0.28 };
  system.rotation.set(defaultTilt.x, defaultTilt.y, defaultTilt.z);
  const mobile = matchMedia('(max-width: 640px)').matches;
  const rings = [
    createParticleRing({ radius: 2.10, width: 0.50, count: mobile ? 4200 : 10000, speed: 0.48, seed: 13, color: '#cdb2ff', opacity: 0.8 }),
    createParticleRing({ radius: 2.77, width: 0.13, count: mobile ? 1600 : 3500, speed: -0.32, seed: 29, color: '#b6a0f5', opacity: 0.76 }),
    createParticleRing({ radius: 1.70, width: 0.055, count: mobile ? 700 : 1600, speed: 0.67, seed: 7, color: '#8cc9fb', opacity: 0.64 }),
  ];
  rings[1].points.rotation.set(0.20, 0, 0.15);
  rings[2].points.rotation.set(-0.25, 0, -0.13);
  rings.forEach(ring => system.add(ring.points));

  // Generate the original cloud map once. Animation only changes GPU transforms.
  const cloudTexture = await createCloudTexture();
  const planetMaterial = new THREE.ShaderMaterial({
    uniforms: { cloudMap: { value: cloudTexture } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = -p.xyz;
        gl_Position = projectionMatrix * p;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D cloudMap;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec3 n = normalize(vNormal);
        float facing = max(dot(n, normalize(vView)), 0.0);
        float diffuse = max(dot(n, normalize(vec3(-0.8, 0.6, 0.7))), 0.0);
        vec3 color = texture2D(cloudMap, vUv).rgb * (0.19 + diffuse);
        float fresnel = pow(1.0 - facing, 3.0);
        float rimDirection = smoothstep(-0.6, 0.75, dot(n, normalize(vec3(-0.9, 0.65, 0.0))));
        vec3 rimColor = mix(vec3(0.35, 0.08, 0.77), vec3(0.27, 0.78, 1.0), rimDirection);
        color += rimColor * fresnel * (0.55 + rimDirection * 0.65);
        color += vec3(0.18, 0.07, 0.33) * pow(1.0 - facing, 1.4) * diffuse;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const planetGeometry = new THREE.SphereGeometry(1.12, 64, 48);
  const planet = new THREE.Mesh(planetGeometry, planetMaterial);
  planet.rotation.z = 0.18;
  system.add(planet);
  // A back-facing atmosphere and depth testing give real front/back occlusion.
  const atmosphereGeometry = new THREE.SphereGeometry(1.155, 48, 32);
  const atmosphereMaterial = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = -p.xyz;
        gl_Position = projectionMatrix * p;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float f = abs(dot(normalize(vNormal), normalize(vView)));
        float glow = pow(1.0 - f, 5.0);
        float side = smoothstep(-0.5, 0.8, dot(normalize(vNormal), normalize(vec3(-0.8, 0.7, 0.2))));
        vec3 color = mix(vec3(0.35, 0.09, 0.7), vec3(0.21, 0.62, 1.0), side);
        gl_FragColor = vec4(color, glow * 0.52);
      }
    `,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  system.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));
  const haloTexture = createHaloTexture();
  const haloMaterial = new THREE.SpriteMaterial({ map: haloTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.42 });
  const halo = new THREE.Sprite(haloMaterial);
  halo.scale.set(6.3, 6.3, 1);
  scene.add(halo);
  const stars = createStars(mobile ? 90 : 170);
  scene.add(stars);

  function isMoving() { return !paused && !reducedMotion.matches && !document.hidden && !contextLost && !disposed; }
  function updateStatus() {
    const still = paused || reducedMotion.matches;
    pauseButton.textContent = reducedMotion.matches ? '静态预览' : paused ? '继续旋转' : '暂停旋转';
    pauseButton.setAttribute('aria-pressed', String(still));
    pauseButton.disabled = reducedMotion.matches || contextLost;
    status.textContent = contextLost ? '三维画面已中断，正在等待恢复。' : reducedMotion.matches ? '已遵循系统减少动态效果设置 · 可拖动查看' : paused ? '旋转已暂停 · 可拖动查看' : speed === 1 ? '三条轨道，顺逆交错。' : `当前旋转速度 ${speed}×`;
    document.body.dataset.motion = isMoving() ? 'running' : 'paused';
  }
  function draw() {
    rings.forEach(ring => ring.update(elapsed));
    planet.rotation.y = elapsed * 0.075;
    renderer.render(scene, camera);
  }
  function tick(timestamp) {
    frame = null;
    if (!isMoving()) { previousTime = null; lastMotionPreference = reducedMotion.matches; updateStatus(); return; }
    if (previousTime !== null) elapsed += Math.min((timestamp - previousTime) / 1000, 0.05) * speed;
    previousTime = timestamp;
    draw();
    frame = requestAnimationFrame(tick);
  }
  function syncMotion() {
    lastMotionPreference = reducedMotion.matches;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; previousTime = null;
    updateStatus();
    if (contextLost || disposed) return;
    draw();
    if (isMoving()) frame = requestAnimationFrame(tick);
  }
  function resize() {
    if (disposed || contextLost) return;
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio || 1, width < 640 ? 1.25 : 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    rings.forEach(ring => ring.setPixelRatio(dpr));
    stars.material.uniforms.pixelRatio.value = dpr;
    camera.aspect = width / height;
    const distance = Math.max(8.5, 3.35 / (Math.tan(THREE.MathUtils.degToRad(17.5)) * camera.aspect));
    camera.position.set(0, distance * 0.34, distance * 0.94);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    draw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  window.addEventListener('resize', resize);
  resetButton.disabled = false;
  speedButtons.forEach(button => {
    button.disabled = false;
    button.addEventListener('click', () => {
      speed = Number(button.dataset.speed);
      speedButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      updateStatus();
    });
  });
  pauseButton.addEventListener('click', () => { paused = !paused; syncMotion(); });
  resetButton.addEventListener('click', () => { system.rotation.set(defaultTilt.x, defaultTilt.y, defaultTilt.z); draw(); });
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  // Some embedded Chromium hosts update .matches without dispatching change.
  // This cheap fallback updates controls/resumes correctly without drawing while paused.
  let lastMotionPreference = reducedMotion.matches;
  const preferenceTimer = setInterval(() => {
    if (!document.hidden && lastMotionPreference !== reducedMotion.matches) {
      lastMotionPreference = reducedMotion.matches;
      syncMotion();
    }
  }, 500);
  function onParentMotion(event) {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'gongxu:orbit-motion' || typeof event.data.paused !== 'boolean') return;
    paused = event.data.paused; syncMotion();
  }
  window.addEventListener('message', onParentMotion);
  if (window.parent !== window) window.parent.postMessage({ type: 'gongxu:orbit-ready' }, location.origin);
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || contextLost) return;
    system.rotation.y += (event.clientX - drag.x) * 0.005;
    system.rotation.x = THREE.MathUtils.clamp(system.rotation.x + (event.clientY - drag.y) * 0.004, -0.60, 0.75);
    drag.x = event.clientX; drag.y = event.clientY; draw();
  });
  function endDrag() { drag = null; canvas.classList.remove('dragging'); }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || contextLost) return;
    event.preventDefault();
    system.rotation.y += event.key === 'ArrowLeft' ? -0.08 : event.key === 'ArrowRight' ? 0.08 : 0;
    system.rotation.x = THREE.MathUtils.clamp(system.rotation.x + (event.key === 'ArrowUp' ? -0.06 : event.key === 'ArrowDown' ? 0.06 : 0), -0.60, 0.75); draw();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true;
    loading.hidden = false; loading.textContent = '三维画面已中断，正在等待图形环境恢复。';
    resetButton.disabled = true; speedButtons.forEach(button => { button.disabled = true; }); syncMotion();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false; loading.hidden = true;
    resetButton.disabled = false; speedButtons.forEach(button => { button.disabled = false; }); resize(); syncMotion();
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    disposed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect(); window.removeEventListener('resize', resize);
    reducedMotion.removeEventListener('change', syncMotion);
    clearInterval(preferenceTimer);
    document.removeEventListener('visibilitychange', syncMotion);
    window.removeEventListener('message', onParentMotion);
    rings.forEach(ring => ring.dispose());
    [planetGeometry, planetMaterial, cloudTexture, atmosphereGeometry, atmosphereMaterial, haloTexture, haloMaterial, stars.geometry, stars.material].forEach(resource => resource.dispose());
    renderer.dispose();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) syncMotion(); });
  resize(); loading.hidden = true; document.body.dataset.renderer = 'webgl'; syncMotion();
}

async function createCloudTexture() {
  const width = 768, height = 384;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); const image = ctx.createImageData(width, height);
  function hash(x, y, z) {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  const mix = (a, b, t) => a + (b - a) * t;
  function noise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    x -= ix; y -= iy; z -= iz;
    x *= x * (3 - 2 * x); y *= y * (3 - 2 * y); z *= z * (3 - 2 * z);
    return mix(mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), x), mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), x), y), mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), x), mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), x), y), z);
  }
  function fbm(x, y, z) {
    let value = 0, amplitude = 0.53;
    for (let i = 0; i < 5; i++) { value += noise(x, y, z) * amplitude; x = x * 2.01 + 7; y = y * 2.03 + 9; z = z * 2.01 + 3; amplitude *= 0.49; }
    return value;
  }
  let sliceStart = performance.now();
  for (let y = 0; y < height; y++) {
    const latitude = y / (height - 1) * Math.PI;
    for (let x = 0; x < width; x++) {
      const longitude = x / width * Math.PI * 2;
      const sx = Math.sin(latitude) * Math.cos(longitude), sy = Math.cos(latitude), sz = Math.sin(latitude) * Math.sin(longitude);
      const warp = fbm(sx * 2.1 + 5, sy * 3.4, sz * 2.1);
      const cloud = fbm(sx * 4.7 + warp * 2.7, sy * 6.5 + warp * 1.8, sz * 4.7);
      const band = Math.sin(sy * 19 + warp * 11 + cloud * 6) * 0.5 + 0.5;
      const light = Math.pow(Math.max(0, cloud * 0.9 + band * 0.28), 2.1);
      const dust = (hash(x, y, 3) - 0.5) * 4; const index = (y * width + x) * 4;
      image.data[index] = 35 + light * 117 + dust; image.data[index + 1] = 13 + light * 59 + dust;
      image.data[index + 2] = 67 + light * 166 + dust; image.data[index + 3] = 255;
    }
    // Keep the same pixels, but let inputs/painting run between short CPU slices.
    // A timer yield works in both Chromium and WebKit without extra worker assets.
    if (performance.now() - sliceStart >= 8) {
      await new Promise(resolve => setTimeout(resolve, 0));
      sliceStart = performance.now();
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = THREE.RepeatWrapping; texture.anisotropy = 2; return texture;
}

function createHaloTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'); const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(76,28,139,0)'); gradient.addColorStop(0.28, 'rgba(86,35,154,0.20)');
  gradient.addColorStop(0.43, 'rgba(80,32,150,0.14)'); gradient.addColorStop(0.68, 'rgba(55,22,115,0.06)'); gradient.addColorStop(1, 'rgba(20,10,50,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(canvas);
}

function createStars(count) {
  const positions = new Float32Array(count * 3), sizes = new Float32Array(count);
  let state = 791; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let i = 0; i < count; i++) { positions.set([(random() - 0.5) * 26, (random() - 0.5) * 15, -6 - random() * 9], i * 3); sizes[i] = 0.8 + random() * 2.1; }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: 1 } },
    vertexShader: 'attribute float aSize; uniform float pixelRatio; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * pixelRatio; }',
    fragmentShader: 'void main() { float r = length(gl_PointCoord * 2.0 - 1.0); if (r > 1.0) discard; gl_FragColor = vec4(0.65, 0.57, 0.84, pow(1.0-r, 2.0) * 0.55); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}
