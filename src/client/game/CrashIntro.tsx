import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Color,
  MeshLambertMaterial,
  TorusGeometry,
  Vector3,
  type Group,
  type Points,
  type PointsMaterial,
} from 'three';
import type { CrashCause } from '../../shared/daily';
import {
  sfxImpact,
  sfxRinging,
  sfxThud,
  sfxThunder,
  startAlarm,
  startEngine,
  startWind,
} from './audio';
import { finishIntro, intro, setStage, stageAt, T } from './intro';
import { mergeStatic } from './shared';
import { run } from './state';
import { airfoil, finShape, fuselageGeometry, propBlade, softDot } from './Wreck';
import type { World } from './world';

const SMOKE = 70;
const CIRCLE_R = 68;
const ALT = 52;

const tmpV = new Vector3();
const fwd = new Vector3();
const up = new Vector3(0, 1, 0);
const side = new Vector3();

function bezier(out: Vector3, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number) {
  const u = 1 - t;
  out
    .copy(p0)
    .multiplyScalar(u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
  return out;
}

// Intact plane in flight (nose +X like the wreck).
function FlyingPlane({ seed, propRef }: { seed: number; propRef: RefObject<Group | null> }) {
  const parts = useMemo(
    () => ({
      fuselage: fuselageGeometry(seed),
      wing: airfoil(1.55, 0.16, 5.0),
      stab: (() => {
        const g = airfoil(0.85, 0.07, 3.3);
        g.translate(0, 0, -1.65);
        return g;
      })(),
      fin: finShape(),
      blade: propBlade(),
      strut: new CylinderGeometry(0.035, 0.035, 2.7, 6),
      tire: new TorusGeometry(0.2, 0.09, 8, 14),
    }),
    [seed]
  );
  const mats = useMemo(
    () => ({
      hull: new MeshLambertMaterial({ vertexColors: true }),
      paint: new MeshLambertMaterial({ color: '#e2dfd5' }),
      stripe: new MeshLambertMaterial({ color: '#c2452d' }),
      metal: new MeshLambertMaterial({ color: '#6c7175' }),
      dark: new MeshLambertMaterial({ color: '#26292c' }),
      glass: new MeshLambertMaterial({ color: '#1a2830' }),
      rubber: new MeshLambertMaterial({ color: '#1c1b1a' }),
    }),
    []
  );
  // airframe is rigid: merge everything except the spinning prop
  const root = useRef<Group>(null);
  useLayoutEffect(() => (root.current ? mergeStatic(root.current, { deep: true, exclude: [propRef.current] }) : undefined), [parts, mats, propRef]);
  return (
    <group ref={root}>
      <mesh geometry={parts.fuselage} material={mats.hull} />
      <mesh position={[2.55, 0.62, 0]} rotation-z={-0.75} material={mats.glass}>
        <boxGeometry args={[0.9, 0.03, 1.15]} />
      </mesh>
      <mesh position={[1.6, 0.38, 0.8]} material={mats.glass}>
        <boxGeometry args={[1.7, 0.42, 0.02]} />
      </mesh>
      <mesh position={[1.6, 0.38, -0.8]} material={mats.glass}>
        <boxGeometry args={[1.7, 0.42, 0.02]} />
      </mesh>
      <group position={[1.65, 0.98, 0.25]}>
        <mesh geometry={parts.wing} material={mats.paint} />
      </group>
      <group position={[1.65, 0.98, -0.25]} scale={[1, 1, -1]}>
        <mesh geometry={parts.wing} material={mats.paint} />
      </group>
      <mesh geometry={parts.strut} material={mats.metal} position={[1.62, 0.29, 1.85]} rotation-x={1.02} />
      <mesh geometry={parts.strut} material={mats.metal} position={[1.62, 0.29, -1.85]} rotation-x={-1.02} />
      <mesh geometry={parts.stab} material={mats.paint} position={[-3.6, 0.12, 0]} />
      <mesh geometry={parts.fin} material={mats.stripe} position={[-3.45, 0.25, 0]} />
      {[0.75, -0.75].map((z) => (
        <group key={z} position={[1.4, -1.05, z]}>
          <mesh geometry={parts.tire} material={mats.rubber} />
        </group>
      ))}
      <mesh position={[1.4, -0.75, 0]} material={mats.dark}>
        <boxGeometry args={[0.08, 0.5, 1.5]} />
      </mesh>
      <group ref={propRef} position={[4.2, 0, 0]}>
        <mesh rotation-z={-Math.PI / 2} material={mats.metal}>
          <coneGeometry args={[0.24, 0.42, 12]} />
        </mesh>
        <mesh geometry={parts.blade} material={mats.dark} position={[0.05, 0.1, 0]} rotation={[0, Math.PI / 2, 0]} />
        <mesh geometry={parts.blade} material={mats.dark} position={[0.05, -0.1, 0]} rotation={[0, Math.PI / 2, Math.PI]} />
      </group>
    </group>
  );
}

export function CrashIntro({ world, causes }: { world: World; causes: [CrashCause, CrashCause] }) {
  // effects for a cause start when that emergency happens
  const startOf = (c: CrashCause) => (causes[0] === c ? T.event : causes[1] === c ? T.event2 : Infinity);
  const has = (c: CrashCause) => causes[0] === c || causes[1] === c;
  const camera = useThree((s) => s.camera);
  const plane = useRef<Group>(null);
  const prop = useRef<Group>(null);
  const smoke = useRef<Points<BufferGeometry, PointsMaterial>>(null);
  const feathers = useRef<Points<BufferGeometry, PointsMaterial>>(null);
  const fire = useRef<Group>(null);

  const sim = useRef({
    theta: 0,
    propSpin: 0,
    propSpeed: 40,
    pos: new Vector3(),
    vel: new Vector3(),
    diveFrom: null as null | { p0: Vector3; p1: Vector3; p2: Vector3; p3: Vector3 },
    smokeHead: 0,
    flashed: false,
    flashed2: false,
    drop: 0,
    impacted: false,
    rung: false,
    thunderAt: 0,
  });

  const crash = useMemo(() => {
    const y = world.heightAt(world.wreck.x, world.wreck.z);
    return new Vector3(world.wreck.x, y + 0.8, world.wreck.z);
  }, [world]);

  // start angle: the circle ends roughly opposite the crash site so the dive is visible
  const theta0 = useMemo(() => Math.atan2(crash.z, crash.x) + Math.PI * 0.15, [crash]);

  const smokeData = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(SMOKE * 3).fill(-9999), 3));
    return { geo, life: new Float32Array(SMOKE), tex: softDot() };
  }, []);

  // black smoke for engine trouble/fire, white vapour for a fuel leak (set once, not per frame)
  const [c1, c2] = causes;
  const smokeColor = useMemo(() => {
    const is = (c: CrashCause) => c1 === c || c2 === c;
    return new Color(is('fire') || is('engine') ? '#2a2420' : is('fuel') ? '#c9cbc8' : '#4a4541');
  }, [c1, c2]);

  const featherData = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(40 * 3).fill(-9999), 3));
    const vel = new Float32Array(40 * 3);
    return { geo, vel };
  }, []);

  // audio layers live for the duration of the cinematic
  const audio = useRef<{ engine: ReturnType<typeof startEngine>; wind: ReturnType<typeof startWind>; alarm: ReturnType<typeof startAlarm> }>({
    engine: null,
    wind: null,
    alarm: null,
  });
  useEffect(() => {
    audio.current.engine = startEngine();
    audio.current.wind = startWind();
    const a = audio.current;
    return () => {
      a.engine?.stop();
      a.wind?.stop();
      a.alarm?.stop();
    };
  }, []);

  useFrame((state, rawDt) => {
    if (run.phase !== 'intro') return;
    const dt = Math.min(rawDt, 0.05);
    const s = sim.current;
    intro.frames++;
    if (intro.started) intro.t += dt;
    const t = intro.t;
    const stage = stageAt(t);
    setStage(stage);

    // slow motion during the grab
    const simDt = stage === 'grab' ? dt * 0.3 : dt;

    // --- emergency kicks in ---------------------------------------------------
    const trigger = (c: CrashCause) => {
      if (c === 'bird') {
        sfxThud();
        const pos = featherData.geo.attributes.position!;
        for (let i = 0; i < 40; i++) {
          pos.setXYZ(i, s.pos.x, s.pos.y + 0.5, s.pos.z);
          featherData.vel[i * 3] = (Math.random() - 0.5) * 8;
          featherData.vel[i * 3 + 1] = Math.random() * 5;
          featherData.vel[i * 3 + 2] = (Math.random() - 0.5) * 8;
        }
      }
      if (c === 'storm') sfxThunder();
      if (c === 'fire' || c === 'engine') sfxThud();
    };
    if (t >= T.event && !s.flashed) {
      s.flashed = true;
      audio.current.alarm = startAlarm();
      trigger(causes[0]);
    }
    if (t >= T.event2 && !s.flashed2) {
      s.flashed2 = true;
      trigger(causes[1]);
    }
    if (has('storm') && t > s.thunderAt && t < T.impact && t > startOf('storm') - 4) {
      s.thunderAt = t + 2.2 + Math.random() * 2;
      if (t > 1) sfxThunder();
    }

    // engine health: bird/fuel sputter, engine failure dies, storm stays on
    let engine = t < T.event ? 1 : 0.85;
    if (t > startOf('bird') || t > startOf('fuel')) engine = Math.min(engine, 0.45 + Math.random() * 0.3);
    if (t > startOf('engine')) engine = Math.min(engine, Math.max(0, 1 - (t - startOf('engine')) * 0.8));
    if (t > startOf('fire')) engine = Math.min(engine, Math.max(0.1, 0.6 - (t - startOf('fire')) * 0.25));
    audio.current.engine?.set?.(engine);
    audio.current.wind?.set?.(stage === 'dive' ? Math.min(1, (t - T.grabEnd) / 2.5) : 0.15);
    s.propSpeed += (engine * 45 - s.propSpeed) * Math.min(1, dt * 1.5);
    s.propSpin += s.propSpeed * simDt;
    if (prop.current) prop.current.rotation.x = s.propSpin;

    // --- flight path ---------------------------------------------------------
    const prevPos = tmpV.copy(s.pos);
    if (t < T.grabEnd) {
      const glide = t > T.event ? (t - T.event) * 1.2 : 0;
      // wind shear: the plane suddenly drops
      if (t > startOf('shear')) s.drop = Math.min(9, s.drop + simDt * 7);
      s.theta += (14 / CIRCLE_R) * simDt;
      const th = theta0 + s.theta;
      s.pos.set(Math.cos(th) * CIRCLE_R, ALT + crash.y * 0.3 - glide - s.drop, Math.sin(th) * CIRCLE_R);
    } else {
      if (!s.diveFrom) {
        const p0 = s.pos.clone();
        const dir = s.vel.lengthSq() > 0 ? s.vel.clone().normalize() : new Vector3(1, 0, 0);
        const toCrash = crash.clone().sub(p0).setY(0).normalize();
        s.diveFrom = {
          p0,
          p1: p0.clone().addScaledVector(dir, 22),
          p2: crash.clone().addScaledVector(toCrash, -18).setY(crash.y + 9),
          p3: crash.clone(),
        };
      }
      const k = Math.min(1, (t - T.grabEnd) / (T.impact - T.grabEnd));
      const d = s.diveFrom;
      bezier(s.pos, d.p0, d.p1, d.p2, d.p3, k * k * (1.6 - 0.6 * k));
    }
    if (simDt > 0) s.vel.copy(s.pos).sub(prevPos).divideScalar(Math.max(simDt, 1e-4));

    if (plane.current) {
      plane.current.position.copy(s.pos);
      fwd.copy(s.vel).normalize();
      if (fwd.lengthSq() > 0.5) plane.current.lookAt(tmpV.copy(s.pos).add(fwd));
      // bank into the circle, wobble once the emergency starts
      const shearing = t > startOf('shear') ? 2.5 : 1;
      const wobble = t > T.event ? (Math.sin(t * 9) * 0.06 + Math.sin(t * 3.3) * 0.08) * shearing : 0;
      plane.current.rotateZ(t < T.grabEnd ? -0.32 + wobble : wobble * 2);
      plane.current.visible = t < T.impact;
    }

    // --- smoke trail (world space) --------------------------------------------
    if (smoke.current) {
      const pos = smokeData.geo.attributes.position!;
      if (t > T.event && t < T.impact) {
        const emit = Math.ceil(simDt * (has('fire') || has('fuel') ? 60 : 40));
        for (let e = 0; e < emit; e++) {
          const i = s.smokeHead++ % SMOKE;
          // engine sits at the nose
          pos.setXYZ(i, s.pos.x + fwd.x * 3.5 + (Math.random() - 0.5) * 0.4, s.pos.y + 0.3, s.pos.z + fwd.z * 3.5 + (Math.random() - 0.5) * 0.4);
          smokeData.life[i] = 1;
        }
      }
      for (let i = 0; i < SMOKE; i++) {
        if (smokeData.life[i]! <= 0) continue;
        smokeData.life[i] = smokeData.life[i]! - simDt * 0.5;
        pos.setY(i, pos.getY(i) + simDt * 1.2);
        // puffs the chase camera flies through balloon into screen-filling dark blobs: drop them
        const dx = pos.getX(i) - camera.position.x;
        const dy = pos.getY(i) - camera.position.y;
        const dz = pos.getZ(i) - camera.position.z;
        if (dx * dx + dy * dy + dz * dz < 36) smokeData.life[i] = 0;
        if (smokeData.life[i]! <= 0) pos.setXYZ(i, -9999, -9999, -9999);
      }
      pos.needsUpdate = true;
      // the grab camera sits right in the trail; big soft points there read as black blobs
      smoke.current.visible = stage !== 'grab';
    }
    if (fire.current) {
      const on = t > startOf('fire') && t < T.impact;
      fire.current.visible = on;
      if (on) {
        fire.current.position.copy(s.pos).addScaledVector(fwd, 3.2).addScaledVector(up, 0.4);
        const f = 1 + Math.sin(t * 23) * 0.25 + Math.sin(t * 37) * 0.15;
        fire.current.scale.set(f, f * 1.4, f);
      }
    }
    if (feathers.current && has('bird')) {
      const pos = featherData.geo.attributes.position!;
      for (let i = 0; i < 40; i++) {
        featherData.vel[i * 3 + 1] = featherData.vel[i * 3 + 1]! - simDt * 6;
        pos.setXYZ(
          i,
          pos.getX(i) + featherData.vel[i * 3]! * simDt,
          pos.getY(i) + featherData.vel[i * 3 + 1]! * simDt,
          pos.getZ(i) + featherData.vel[i * 3 + 2]! * simDt
        );
      }
      pos.needsUpdate = true;
    }

    // --- impact + hand-off ------------------------------------------------------
    if (t >= T.impact && !s.impacted) {
      s.impacted = true;
      sfxImpact();
      audio.current.alarm?.stop();
      audio.current.engine?.stop();
      audio.current.wind?.stop();
      audio.current.engine = null;
      audio.current.wind = null;
    }
    if (t >= T.impact + 0.6 && !s.rung) {
      s.rung = true;
      sfxRinging();
    }
    if (t >= T.wake && run.phase === 'intro') {
      finishIntro();
      return;
    }

    // --- camera --------------------------------------------------------------------
    side.crossVectors(fwd, up).normalize();
    const shake = (t > T.event ? (stage === 'dive' ? 0.35 : 0.12) : 0.02) * (t > startOf('shear') && t < T.grab ? 3 : 1);
    if (stage === 'grab') {
      // close on the cockpit side window, far enough out to clear the high wing
      camera.position.copy(s.pos).addScaledVector(side, 9).addScaledVector(up, 2.5).addScaledVector(fwd, -3);
      camera.lookAt(tmpV.copy(s.pos).addScaledVector(fwd, 1.4).addScaledVector(up, 0.4));
    } else if (stage === 'dive') {
      camera.position.copy(s.pos).addScaledVector(fwd, -10).addScaledVector(up, 3.2).addScaledVector(side, 2);
      camera.lookAt(tmpV.copy(s.pos).addScaledVector(fwd, 6));
    } else if (t < T.impact) {
      const swing = Math.sin(t * 0.35) * 5;
      camera.position.copy(s.pos).addScaledVector(fwd, -11).addScaledVector(up, 3.5).addScaledVector(side, swing);
      camera.lookAt(tmpV.copy(s.pos).addScaledVector(fwd, 5));
    }
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    void state;
  });

  return (
    <>
      {/* stands in for the wreck's fire light (unlit here): with the same light count as
          gameplay, the shaders compiled in the intro and its warm-up are reused after wake */}
      <pointLight intensity={0} distance={16} decay={1.6} />
      <group ref={plane}>
        {/* model's nose is +X; lookAt aims +Z, so turn it */}
        <group rotation-y={-Math.PI / 2}>
          <FlyingPlane seed={world.seed} propRef={prop} />
        </group>
      </group>
      <points ref={smoke} geometry={smokeData.geo} frustumCulled={false}>
        <pointsMaterial map={smokeData.tex} color={smokeColor} size={3.2} transparent opacity={0.55} depthWrite={false} />
      </points>
      {/* engine fire trailing from the cowling */}
      <group ref={fire} visible={false}>
        <mesh>
          <coneGeometry args={[0.45, 1.6, 7]} />
          <meshBasicMaterial color="#ff7a1a" transparent opacity={0.85} blending={AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
        <mesh scale={0.55} position-y={-0.15}>
          <coneGeometry args={[0.45, 1.6, 7]} />
          <meshBasicMaterial color="#ffd36b" transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
      </group>
      {has('bird') && (
        <points ref={feathers} geometry={featherData.geo} frustumCulled={false}>
          <pointsMaterial map={smokeData.tex} color="#f4f1ea" size={0.35} transparent depthWrite={false} blending={AdditiveBlending} />
        </points>
      )}
    </>
  );
}
