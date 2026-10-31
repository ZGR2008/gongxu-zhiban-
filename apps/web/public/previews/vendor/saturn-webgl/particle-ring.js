/**
 * SaturnWebGL particle-orbit port, MIT.
 * Copyright (c) 2018 Adel Massimo Ramadan. See ./LICENSE.
 * Upstream: adelmassimo/SaturnWebGL @ c960494e221d6a722b8fb5d9973d6d649d806f72
 * Adapted for this preview: current BufferGeometry, bounded particles, point
 * sprites, violet/cyan bands and visible moving clusters. The upstream orbit
 * equations and base_angle/offsetX/offsetZ attributes are retained below.
 */
import * as THREE from '../three/three.module.min.js';

const vertexShader = /* glsl */`
  attribute float base_angle;
  attribute float offsetX;
  attribute float offsetZ;
  attribute float aSize;
  attribute float aLight;
  attribute float aTint;
  uniform vec3 stretch;
  uniform float time;
  uniform float pixelRatio;
  varying float vLight;
  varying float vTint;
  varying float vShade;
  void main() {
    vec3 p = position;
    // Retained from SaturnWebGL's vertexShaderDEBRIS (MIT).
    p.x = (stretch.x + offsetX) * cos(base_angle + time);
    p.z = (stretch.z + offsetZ) * sin(base_angle + time);
    p.y += (stretch.y + offsetX / 10.0) * cos(base_angle + time);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = aSize * pixelRatio * clamp(7.5 / -viewPosition.z, 0.5, 2.0);
    vLight = aLight;
    vTint = aTint;
    vShade = 0.67 + 0.33 * smoothstep(-2.5, 2.5, p.z);
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 tint;
  uniform float opacity;
  varying float vLight;
  varying float vTint;
  varying float vShade;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    if (r2 > 1.0) discard;
    float core = mix(0.65 * (1.0 - smoothstep(0.05, 1.0, r2)), exp(-r2 * 22.0), vLight);
    float halo = exp(-r2 * 4.5) * 0.26;
    vec3 color = mix(tint, vec3(0.20, 0.81, 1.0), vTint);
    color = mix(color, vec3(0.85, 0.92, 1.0), vLight * 0.64);
    float alpha = (core + halo) * opacity * vShade * (0.55 + vLight * 1.5);
    gl_FragColor = vec4(color, alpha);
  }
`;

// A fixed seed makes visual comparisons repeatable without freezing animation.
function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createParticleRing({ radius, width, count, speed, seed, color, opacity = 0.8, pixelRatio = 1 }) {
  const random = randomGenerator(seed);
  const tails = 150;
  const total = count + tails;
  const position = new Float32Array(total * 3);
  const angles = new Float32Array(total);
  const offsetX = new Float32Array(total);
  const offsetZ = new Float32Array(total);
  const size = new Float32Array(total);
  const light = new Float32Array(total);
  const tint = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const trail = i >= count;
    const t = trail ? (i - count) / tails : 0;
    const band = random();
    // Separate bands and gaps keep the ring from looking like a solid torus.
    let radial = (random() - 0.5) * width;
    if (band < 0.34) radial = width * 0.36 + (random() - 0.5) * width * 0.06;
    if (band > 0.75) radial = -width * 0.32 + (random() - 0.5) * width * 0.09;
    if (trail) radial = width * 0.36 + (random() - 0.5) * width * 0.035;
    angles[i] = trail ? 0.8 - Math.sign(speed) * t * 0.65 : random() * Math.PI * 2;
    offsetX[i] = radial;
    offsetZ[i] = radial;
    position[i * 3 + 1] = (random() - 0.5) * (trail ? 0.01 : 0.018);
    light[i] = trail ? Math.pow(1 - t, 1.8) : (random() > 0.985 ? 0.65 : 0);
    size[i] = trail ? 2.5 + 9 * Math.pow(1 - t, 7) : 1 + random() * 1.25 + light[i] * 3;
    tint[i] = trail ? 0.75 : random() > 0.91 ? 0.7 : random() * 0.15;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('base_angle', new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute('offsetX', new THREE.BufferAttribute(offsetX, 1));
  geometry.setAttribute('offsetZ', new THREE.BufferAttribute(offsetZ, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aLight', new THREE.BufferAttribute(light, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius + width);
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      stretch: { value: new THREE.Vector3(radius, 0.015, radius) },
      time: { value: seed * 0.41 },
      pixelRatio: { value: pixelRatio },
      tint: { value: new THREE.Color(color) },
      opacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  return {
    points,
    update(seconds) { material.uniforms.time.value = seed * 0.41 + seconds * speed; },
    setPixelRatio(value) { material.uniforms.pixelRatio.value = value; },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
