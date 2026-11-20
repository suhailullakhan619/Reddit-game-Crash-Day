import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Group,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfxHit, sfxSnort } from './audio';
import { playerPos } from './shared';
import { addItem, combat, createCreature, creatureSlot, damage, emit, run, toast } from './state';
import { mulberry32, WATER_LEVEL, WORLD_HALF, type World } from './world';

// Wild boar. Grazes in small groups; stare-down when you come close, then a telegraphed
// charge (paws the ground: dodge window). Two spear hits bring one down for meat.

const HERDS = 4;
const VISIBLE = 65;

function bristleCoat(geo: BufferGeometry, seed: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position!;
  const cols = new Float32Array(p.count * 3);
  const rng = mulberry32(seed);
  const base = new Color('#4a3a2c');
  const dark = new Color('#2a2119');
  const grey = new Color('#6e6355');
  const c = new Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    c.copy(base).lerp(y > 0.1 ? dark : grey, Math.min(1, Math.abs(y) * 2.2));
    c.multiplyScalar(0.88 + rng() * 0.2);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(cols, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}

function boarGeos() {
  // barrel body with a high shoulder hump, built along +Z
  const body = new CapsuleGeometry(0.33, 0.75, 6, 12);
  body.rotateX(Math.PI / 2);
  body.scale(0.85, 1, 1);
  const hump = new SphereGeometry(0.36, 10, 8);
  hump.scale(0.8, 0.9, 1.1);
  hump.translate(0, 0.14, 0.28);
  // mane of bristles along the spine
  const bristles: BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const b = new ConeGeometry(0.035, 0.14, 4);
    b.rotateX(-0.5);
    b.translate(0, 0.42 - Math.abs(i - 3) * 0.03, 0.5 - i * 0.12);
    bristles.push(b);
  }
  const torso = mergeGeometries([bristleCoat(body, 1), bristleCoat(hump, 2), ...bristles.map((b, i) => bristleCoat(b, 10 + i))])!;
  torso.computeVertexNormals();

  const skull = new SphereGeometry(0.2, 10, 8);
  skull.scale(0.85, 0.9, 1.3);
  const snoutCone = new CylinderGeometry(0.09, 0.15, 0.3, 10);
  snoutCone.rotateX(Math.PI / 2);
  snoutCone.translate(0, -0.06, 0.28);
  const headG = mergeGeometries([bristleCoat(skull, 3), bristleCoat(snoutCone, 4)])!;
  headG.computeVertexNormals();

  const disc = new CylinderGeometry(0.085, 0.085, 0.03, 12);
  disc.rotateX(Math.PI / 2);
  const tusk = new ConeGeometry(0.022, 0.13, 6);
  tusk.rotateX(-0.6);
  const ear = new ConeGeometry(0.06, 0.13, 4);
  const leg = new CapsuleGeometry(0.055, 0.34, 3, 6);
  leg.translate(0, -0.2, 0);
  const hoof = new CylinderGeometry(0.045, 0.055, 0.06, 6);
  const tail = new CylinderGeometry(0.012, 0.02, 0.22, 4);
  tail.translate(0, -0.11, 0);
  return { torso, headG, disc, tusk, ear, leg, hoof, tail };
}

type Herd = { x: number; z: number };

function placeHerds(world: World): Herd[] {
  const rng = mulberry32(world.seed ^ 0x41c64e6d);
  const out: Herd[] = [];
  for (let i = 0; i < 3000 && out.length < HERDS; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 20);
    const z = (rng() * 2 - 1) * (WORLD_HALF - 20);
    const h = world.heightAt(x, z);
    if (h < WATER_LEVEL + 0.5 || h > 7) continue;
    if (Math.hypot(x - world.wreck.x, z - world.wreck.z) < 30) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 45)) continue;
    out.push({ x, z });
  }
  return out;
}

type Mode = 'graze' | 'alert' | 'windup' | 'charge' | 'retreat' | 'dead';

function Boar({ home, seed, world, geo, mats }: { home: Herd; seed: number; world: World; geo: ReturnType<typeof boarGeos>; mats: BoarMats }) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);
  const ai = useRef(
    (() => {
      const rng = mulberry32(seed);
      const x = home.x + (rng() - 0.5) * 6;
      const z = home.z + (rng() - 0.5) * 6;
      return { rng, x, z, y: world.heightAt(x, z), heading: rng() * 6, speed: 0, mode: 'graze' as Mode, t: 0, hp: 2, gait: 0, target: { x, z }, dir: { x: 0, z: 0 }, hitDone: false, snortAt: 0 };
    })()
  );
  const me = useMemo(() => createCreature('boar', ai.current.x, ai.current.z), []);
  useEffect(creatureSlot(me), [me]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const a = ai.current;
    const g = root.current;
    if (!g) return;
    const dx = playerPos.x - a.x;
    const dz = playerPos.z - a.z;
    const dist = Math.hypot(dx, dz);
    g.visible = dist < VISIBLE && run.phase !== 'intro';
    if (!g.visible && a.mode !== 'charge') {
      me.danger = 0;
      me.windup = false;
      return;
    }
    a.t += dt;
    const playing = run.phase === 'play';
    const setMode = (m: Mode) => {
      a.mode = m;
      a.t = 0;
    };

    if (me.pendingHit > 0 && a.mode !== 'dead') {
      a.hp -= me.pendingHit;
      me.pendingHit = 0;
      sfxHit();
      if (a.hp <= 0) {
        setMode('dead');
        me.alive = false;
        run.kills.boar++;
        addItem('meat', 2);
        toast('Boar down. +2 Boar meat');
        emit();
      } else {
        // a wounded boar fights back
        setMode('windup');
        sfxSnort();
      }
    }

    let targetSpeed = 0;
    let face = a.heading;
    switch (a.mode) {
      case 'graze': {
        if (Math.hypot(a.target.x - a.x, a.target.z - a.z) < 1 || a.t > 8) {
          a.target.x = home.x + (a.rng() - 0.5) * 16;
          a.target.z = home.z + (a.rng() - 0.5) * 16;
          a.t = 0;
        }
        face = Math.atan2(a.target.x - a.x, a.target.z - a.z);
        targetSpeed = a.t % 4 < 2.5 ? 0.9 : 0; // amble, stop to root around
        if (playing && dist < 11) {
          setMode('alert');
          sfxSnort();
        }
        break;
      }
      case 'alert': {
        face = Math.atan2(dx, dz);
        if (dist > 15) setMode('graze');
        else if (dist < 6.5 || a.t > 4) {
          setMode('windup');
          sfxSnort();
        }
        break;
      }
      case 'windup': {
        face = Math.atan2(dx, dz);
        if (a.t > 0.7) {
          const len = dist || 1;
          a.dir.x = dx / len;
          a.dir.z = dz / len;
          a.hitDone = false;
          setMode('charge');
        }
        break;
      }
      case 'charge': {
        face = Math.atan2(a.dir.x, a.dir.z);
        targetSpeed = 11;
        if (!a.hitDone && dist < 1.3 && combat.invuln <= 0 && playing) {
          a.hitDone = true;
          damage(16, 'boar');
          combat.knockX = a.dir.x * 6;
          combat.knockZ = a.dir.z * 6;
        }
        if (a.t > 1.1) setMode('retreat');
        break;
      }
      case 'retreat': {
        face = Math.atan2(-dx, -dz);
        targetSpeed = 3;
        if (a.t > 3) setMode(dist < 8 ? 'alert' : 'graze');
        break;
      }
      case 'dead':
        break;
    }

    if (a.mode !== 'dead') {
      let d = face - a.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a.heading = a.mode === 'charge' ? face : a.heading + d * Math.min(1, dt * 5);
      a.speed += (targetSpeed - a.speed) * Math.min(1, dt * (a.mode === 'charge' ? 10 : 4));
      const nx = a.x + Math.sin(a.heading) * a.speed * dt;
      const nz = a.z + Math.cos(a.heading) * a.speed * dt;
      if (world.heightAt(nx, nz) > WATER_LEVEL + 0.2) {
        const res = world.collide(nx, nz, 0.45);
        a.x = res.x;
        a.z = res.z;
      } else if (a.mode === 'charge') setMode('retreat');
      a.y += (world.heightAt(a.x, a.z) - a.y) * Math.min(1, dt * 10);
    }
    me.x = a.x;
    me.z = a.z;
    me.windup = a.mode === 'windup';
    me.danger = a.mode === 'windup' || a.mode === 'charge' ? 0.85 : a.mode === 'alert' ? 0.35 : 0;

    // animation
    a.gait += dt * (a.speed * 3 + 0.3);
    g.position.set(a.x, a.y, a.z);
    g.rotation.y = a.heading;
    g.rotation.z = a.mode === 'dead' ? Math.min(Math.PI / 2, g.rotation.z + dt * 4) : 0;
    const t = state.clock.elapsedTime;
    if (body.current) {
      body.current.position.y = 0.62 + (a.speed > 4 ? Math.abs(Math.sin(a.gait)) * 0.06 : 0);
      body.current.rotation.x = a.mode === 'windup' ? 0.12 : 0;
    }
    if (head.current) {
      const rooting = a.mode === 'graze' && a.speed < 0.2;
      head.current.rotation.x = rooting ? 0.55 + Math.sin(t * 4 + seed) * 0.1 : a.mode === 'windup' ? 0.35 : 0.1;
    }
    legs.current.forEach((leg, i) => {
      if (!leg) return;
      const phase = i === 0 || i === 3 ? 0 : Math.PI;
      const paw = a.mode === 'windup' && i === 0 ? Math.sin(t * 14) * 0.6 : 0;
      leg.rotation.x = Math.sin(a.gait + phase) * Math.min(0.8, a.speed * 0.15) + paw;
    });
  });

  const legPos: [number, number, number][] = [
    [0.17, -0.1, 0.42],
    [-0.17, -0.1, 0.42],
    [0.17, -0.1, -0.4],
    [-0.17, -0.1, -0.4],
  ];

  return (
    <group ref={root} visible={false}>
      <group ref={body} position-y={0.62}>
        <mesh geometry={geo.torso} material={mats.fur} />
        <mesh geometry={geo.tail} material={mats.dark} position={[0, 0.12, -0.72]} rotation-x={-0.4} />
        {legPos.map((p, i) => (
          <group key={i} ref={(el) => void (legs.current[i] = el)} position={p}>
            <mesh geometry={geo.leg} material={mats.dark} />
            <mesh geometry={geo.hoof} material={mats.hoof} position-y={-0.44} />
          </group>
        ))}
        <group ref={head} position={[0, 0.05, 0.78]}>
          <mesh geometry={geo.headG} material={mats.fur} />
          <mesh geometry={geo.disc} material={mats.snout} position={[0, -0.06, 0.44]} />
          <mesh geometry={geo.tusk} material={mats.tusk} position={[0.08, -0.08, 0.34]} rotation-z={-0.4} />
          <mesh geometry={geo.tusk} material={mats.tusk} position={[-0.08, -0.08, 0.34]} rotation-z={0.4} />
          <mesh geometry={geo.ear} material={mats.dark} position={[0.12, 0.17, -0.05]} rotation-z={-0.5} />
          <mesh geometry={geo.ear} material={mats.dark} position={[-0.12, 0.17, -0.05]} rotation-z={0.5} />
          <mesh position={[0.1, 0.05, 0.12]} material={mats.eye}>
            <sphereGeometry args={[0.018, 5, 4]} />
          </mesh>
          <mesh position={[-0.1, 0.05, 0.12]} material={mats.eye}>
            <sphereGeometry args={[0.018, 5, 4]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function boarMats() {
  return {
    fur: new MeshLambertMaterial({ vertexColors: true }),
    dark: new MeshLambertMaterial({ color: '#2a2119' }),
    hoof: new MeshLambertMaterial({ color: '#1a1512' }),
    snout: new MeshLambertMaterial({ color: '#8a6a62' }),
    tusk: new MeshLambertMaterial({ color: '#efe6cf' }),
    eye: new MeshBasicMaterial({ color: '#0d0907' }),
  };
}

type BoarMats = ReturnType<typeof boarMats>;

export function Boars({ world }: { world: World }) {
  const herds = useMemo(() => placeHerds(world), [world]);
  const geo = useMemo(boarGeos, []);
  const mats = useMemo(boarMats, []);
  return (
    <>
      {herds.flatMap((h, hi) =>
        [0, 1].map((k) => <Boar key={`${hi}-${k}`} home={h} seed={(world.seed ^ (hi * 7919 + k * 104729)) >>> 0} world={world} geo={geo} mats={mats} />)
      )}
    </>
  );
}
