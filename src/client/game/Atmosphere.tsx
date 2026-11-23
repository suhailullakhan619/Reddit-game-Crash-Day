import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  ShaderMaterial,
  type DirectionalLight,
  type HemisphereLight,
  type Mesh,
  type Points,
} from 'three';
import { atmo, fxTime } from './fx';
import { gameClock, playerPos } from './shared';
import { intro } from './intro';
import { run } from './state';
import { mulberry32 } from './world';

// Day phase 0..1 over one in-game day (60 s). Keyframes for sky, fog and light.
type Key = {
  t: number;
  sky: string; // horizon + fog
  zenith: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  night: number;
};

const KEYS: Key[] = [
  { t: 0.0, sky: '#2b3550', zenith: '#0e1730', sun: '#8aa0d8', sunI: 0.5, hemiSky: '#3a4a70', hemiGround: '#141a14', hemiI: 0.62, night: 0.8 },
  { t: 0.08, sky: '#e9b089', zenith: '#6f8fb8', sun: '#ffb27a', sunI: 1.5, hemiSky: '#f0c49a', hemiGround: '#2d3a24', hemiI: 0.85, night: 0 },
  { t: 0.22, sky: '#c4dde0', zenith: '#5d9cc8', sun: '#fff3dc', sunI: 2.7, hemiSky: '#d3e8ec', hemiGround: '#3b4a2a', hemiI: 1.15, night: 0 },
  { t: 0.45, sky: '#cfe0d8', zenith: '#6aa2c4', sun: '#ffe9c4', sunI: 2.4, hemiSky: '#d0e2da', hemiGround: '#3a4a2a', hemiI: 1.1, night: 0 },
  { t: 0.56, sky: '#ec9a64', zenith: '#5a6c9c', sun: '#ff9550', sunI: 1.4, hemiSky: '#f0aa82', hemiGround: '#3a3424', hemiI: 1.0, night: 0 },
  { t: 0.63, sky: '#4c3a58', zenith: '#1c2040', sun: '#8a7fc0', sunI: 0.45, hemiSky: '#5a4c7a', hemiGround: '#1c1a20', hemiI: 0.72, night: 0.5 },
  { t: 0.72, sky: '#131d30', zenith: '#050a18', sun: '#8aa2dc', sunI: 0.55, hemiSky: '#34477a', hemiGround: '#10160f', hemiI: 0.62, night: 1 },
  { t: 0.95, sky: '#131d30', zenith: '#050a18', sun: '#8aa2dc', sunI: 0.55, hemiSky: '#34477a', hemiGround: '#10160f', hemiI: 0.62, night: 1 },
  { t: 1.0, sky: '#2b3550', zenith: '#0e1730', sun: '#8aa0d8', sunI: 0.5, hemiSky: '#3a4a70', hemiGround: '#141a14', hemiI: 0.62, night: 0.8 },
];

const cA = new Color();
const cB = new Color();

function seg(phase: number): [Key, Key, number] {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    if (phase >= a.t && phase <= b.t) return [a, b, (phase - a.t) / (b.t - a.t || 1)];
  }
  return [KEYS[0]!, KEYS[0]!, 0];
}

function col(s: [Key, Key, number], pick: (k: Key) => string, out: Color) {
  return out.copy(cA.set(pick(s[0]))).lerp(cB.set(pick(s[1])), s[2]);
}

function num(s: [Key, Key, number], pick: (k: Key) => number) {
  return pick(s[0]) + (pick(s[1]) - pick(s[0])) * s[2];
}

export function dayPhase() {
  return (gameClock.startPhase + gameClock.elapsed / gameClock.dayLength) % 1;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to far plane
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, -0.2, 1.0);
    float t = pow(max(up, 0.0), 0.55);
    vec3 col = mix(uHorizon, uZenith, t);
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    // sun halo + disc (moon at night: smaller, paler)
    float disc = smoothstep(0.9985 - uNight * 0.0006, 0.9992, sd);
    col += uSunColor * (pow(sd, 24.0) * 0.35 * (1.0 - uNight * 0.6) + disc * (1.2 - uNight * 0.4));
    // horizon haze band
    col = mix(col, uHorizon, smoothstep(0.12, 0.0, abs(up)) * 0.6);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const STAR_COUNT = 420;

export function Atmosphere({ shadows, shadowMap }: { shadows: boolean; shadowMap: number }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const dome = useRef<Mesh>(null);
  const stars = useRef<Points>(null);
  const fogColor = useMemo(() => new Color(), []);

  const skyMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uHorizon: { value: atmo.horizon },
          uZenith: { value: atmo.zenith },
          uSunDir: { value: atmo.sunDir },
          uSunColor: { value: atmo.sunColor },
          uNight: { value: 0 },
        },
      }),
    []
  );

  const starGeo = useMemo(() => {
    const rng = mulberry32(99);
    const pos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = rng() * Math.PI * 2;
      const v = 0.08 + rng() * 0.92; // upper hemisphere only
      const r = Math.sqrt(1 - v * v);
      pos[i * 3] = Math.cos(u) * r * 110;
      pos[i * 3 + 1] = v * 110;
      pos[i * 3 + 2] = Math.sin(u) * r * 110;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    return g;
  }, []);

  useEffect(() => {
    scene.background = null;
    scene.fog = new Fog(fogColor, 22, 105);
    return () => {
      scene.fog = null;
    };
  }, [scene, fogColor]);

  useEffect(() => {
    if (sun.current) scene.add(sun.current.target);
  }, [scene]);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.1);
    if (run.phase === 'play') gameClock.elapsed += step;
    fxTime.value += step;
    const s = seg(dayPhase());
    const phase = dayPhase();

    col(s, (k) => k.sky, atmo.horizon);
    col(s, (k) => k.zenith, atmo.zenith);
    atmo.night = num(s, (k) => k.night);
    fogColor.copy(atmo.horizon);
    if (scene.fog instanceof Fog) {
      // the aerial crash cinematic needs a longer view distance
      // during the low dive the haze closes in: far chunks/tiles hide with it (see Chunked)
      const aerial = run.phase === 'intro';
      const low = aerial && (intro.stage === 'dive' || intro.stage === 'black' || intro.stage === 'wake');
      scene.fog.near += ((low ? 45 : aerial ? 70 : 22) - scene.fog.near) * Math.min(1, step * 3);
      scene.fog.far += ((low ? 160 : aerial ? 250 : 105) - scene.fog.far) * Math.min(1, step * 3);
    }

    // sun arcs east to west during the day; at night a fixed moon angle
    const day = phase > 0.03 && phase < 0.62;
    const a = day ? ((phase - 0.03) / 0.59) * Math.PI : Math.PI * 0.32;
    const elev = Math.max(0.18, Math.sin(a));
    atmo.sunDir.set(Math.cos(a), elev, 0.35).normalize();

    if (sun.current) {
      col(s, (k) => k.sun, sun.current.color);
      atmo.sunColor.copy(sun.current.color);
      sun.current.intensity = num(s, (k) => k.sunI);
      sun.current.position.copy(playerPos).addScaledVector(atmo.sunDir, 45);
      sun.current.target.position.copy(playerPos);
    }
    if (hemi.current) {
      col(s, (k) => k.hemiSky, hemi.current.color);
      col(s, (k) => k.hemiGround, hemi.current.groundColor);
      hemi.current.intensity = num(s, (k) => k.hemiI);
    }
    skyMat.uniforms.uNight!.value = atmo.night;
    if (dome.current) dome.current.position.copy(camera.position);
    if (stars.current) {
      stars.current.position.copy(camera.position);
      const m = stars.current.material;
      if (!Array.isArray(m)) m.opacity = Math.max(0, atmo.night - 0.2) * 1.1;
      stars.current.visible = atmo.night > 0.22;
    }
  });

  return (
    <>
      <mesh ref={dome} material={skyMat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[250, 24, 12]} />
      </mesh>
      <points ref={stars} geometry={starGeo} renderOrder={-9} frustumCulled={false}>
        <pointsMaterial color="#e8ecff" size={1.4} sizeAttenuation={false} transparent depthWrite={false} fog={false} />
      </points>
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        castShadow={shadows}
        shadow-mapSize-width={shadowMap}
        shadow-mapSize-height={shadowMap}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-camera-near={1}
        shadow-camera-far={110}
        shadow-bias={-0.0008}
        shadow-normalBias={0.04}
      />
    </>
  );
}
