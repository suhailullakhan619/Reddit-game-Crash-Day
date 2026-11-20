import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Group,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfxGrowl, sfxHit, sfxSnap, sfxSplash } from './audio';
import { playerPos } from './shared';
import { combat, createCreature, creatureSlot, damage, emit, run, toast } from './state';
import { mulberry32, WATER_LEVEL, WORLD_HALF, type World } from './world';

// Alligators lurk in deep water, only eyes and back ridges above the surface.
// Wade or swim near one and it hunts you; drink at the bank and it may lunge from the water.
// Jaws open before a bite (dodge window). They never leave the water.

const COUNT = 7;
const VISIBLE = 70;

function hide(geo: BufferGeometry, seed: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const p = g.attributes.position!;
  const cols = new Float32Array(p.count * 3);
  const rng = mulberry32(seed);
  const back = new Color('#3c4227');
  const mid = new Color('#545a32');
  const belly = new Color('#bdb48a');
  const c = new Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    c.copy(y > 0.02 ? back : y > -0.06 ? mid : belly);
    c.multiplyScalar(0.85 + rng() * 0.25);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(cols, 3));
  return g;
}

function gatorGeos() {
  // flattened torso with rows of armoured scutes; built along +Z
  const torso = new CapsuleGeometry(0.32, 1.1, 6, 12);
  torso.rotateX(Math.PI / 2);
  torso.scale(1.05, 0.55, 1);
  const parts: BufferGeometry[] = [hide(torso, 1)];
  for (let row = -1; row <= 1; row++) {
    for (let i = 0; i < 9; i++) {
      const s = new ConeGeometry(0.05, 0.08, 4);
      s.translate(row * 0.12, 0.17 - Math.abs(row) * 0.02, 0.6 - i * 0.15);
      parts.push(hide(s, 20 + row * 10 + i));
    }
  }
  const body = mergeGeometries(parts)!;
  body.computeVertexNormals();

  // long tapered snout + upper jaw
  const skull = new SphereGeometry(0.2, 10, 8);
  skull.scale(1.05, 0.55, 1);
  const snout = new BoxGeometry(0.22, 0.09, 0.62);
  snout.translate(0, -0.01, 0.38);
  const brow = new SphereGeometry(0.06, 6, 5);
  brow.translate(0.08, 0.08, 0.06);
  const brow2 = brow.clone();
  brow2.translate(-0.16, 0, 0);
  const nostril = new SphereGeometry(0.03, 5, 4);
  nostril.translate(0, 0.04, 0.66);
  const upper = mergeGeometries([hide(skull, 2), hide(snout, 3), hide(brow, 4), hide(brow2, 5), hide(nostril, 6)])!;
  upper.computeVertexNormals();
  const jaw = new BoxGeometry(0.2, 0.05, 0.6);
  jaw.translate(0, 0, 0.3);
  const lower = hide(jaw, 7);
  lower.computeVertexNormals();
  // teeth along both jaws
  const teethParts: BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    for (const side of [-1, 1]) {
      const t = new ConeGeometry(0.012, 0.04, 3);
      t.rotateX(Math.PI);
      t.translate(side * 0.1, -0.06, 0.12 + i * 0.07);
      teethParts.push(t);
    }
  }
  const teeth = mergeGeometries(teethParts.map((t) => {
    for (const k of Object.keys(t.attributes)) if (k !== 'position' && k !== 'normal') t.deleteAttribute(k);
    return t;
  }))!;

  const tailSeg = new CapsuleGeometry(0.2, 0.5, 4, 8);
  tailSeg.rotateX(Math.PI / 2);
  tailSeg.scale(0.9, 0.55, 1);
  tailSeg.translate(0, 0, -0.35);
  const tail = hide(tailSeg, 8);
  tail.computeVertexNormals();
  const leg = new CapsuleGeometry(0.06, 0.2, 3, 6);
  leg.rotateZ(Math.PI / 2);
  leg.translate(0.16, -0.06, 0);
  const legG = hide(leg, 9);
  legG.computeVertexNormals();
  return { body, upper, lower, teeth, tail, legG };
}

type Spot = { x: number; z: number };

function placeGators(world: World): Spot[] {
  const rng = mulberry32(world.seed ^ 0x6a09e667);
  const out: Spot[] = [];
  for (let i = 0; i < 6000 && out.length < COUNT; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 12);
    const z = (rng() * 2 - 1) * (WORLD_HALF - 12);
    if (world.heightAt(x, z) > WATER_LEVEL - 1.0) continue; // deep water only
    if (Math.hypot(x - world.spawn.x, z - world.spawn.z) < 25) continue;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 30)) continue;
    out.push({ x, z });
  }
  return out;
}

type Mode = 'lurk' | 'hunt' | 'windup' | 'snap' | 'retreat' | 'dead';

function Gator({ home, seed, world, geo, mats }: { home: Spot; seed: number; world: World; geo: ReturnType<typeof gatorGeos>; mats: GatorMats }) {
  const root = useRef<Group>(null);
  const jaw = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const tail2 = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);
  const ai = useRef({
    rng: mulberry32(seed),
    x: home.x,
    z: home.z,
    heading: (seed % 628) / 100,
    speed: 0,
    mode: 'lurk' as Mode,
    t: 0,
    hp: 3,
    sub: 1, // 1 = submerged, 0 = surfaced
    swim: 0,
    target: { x: home.x, z: home.z },
    bit: false,
  });
  const me = useMemo(() => createCreature('gator', home.x, home.z), [home]);
  useEffect(creatureSlot(me), [me]);

  const inWater = (x: number, z: number) => world.heightAt(x, z) < WATER_LEVEL - 0.35;

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const a = ai.current;
    const g = root.current;
    if (!g) return;
    const dx = playerPos.x - a.x;
    const dz = playerPos.z - a.z;
    const dist = Math.hypot(dx, dz);
    g.visible = dist < VISIBLE && run.phase !== 'intro';
    if (!g.visible) {
      me.danger = 0;
      me.windup = false;
      return;
    }
    a.t += dt;
    const playing = run.phase === 'play';
    const playerWet = world.heightAt(playerPos.x, playerPos.z) < WATER_LEVEL + 0.15;
    const setMode = (m: Mode) => {
      a.mode = m;
      a.t = 0;
    };

    if (me.pendingHit > 0 && a.mode !== 'dead') {
      a.hp -= me.pendingHit;
      me.pendingHit = 0;
      sfxHit();
      sfxSplash();
      if (a.hp <= 0) {
        setMode('dead');
        me.alive = false;
        run.kills.gator++;
        toast('The alligator rolls over and sinks.');
        emit();
      } else setMode('retreat');
    }

    let targetSpeed = 0;
    let face = a.heading;
    switch (a.mode) {
      case 'lurk': {
        if (Math.hypot(a.target.x - a.x, a.target.z - a.z) < 1.5 || a.t > 14) {
          for (let k = 0; k < 8; k++) {
            const tx = home.x + (a.rng() - 0.5) * 24;
            const tz = home.z + (a.rng() - 0.5) * 24;
            if (inWater(tx, tz)) {
              a.target.x = tx;
              a.target.z = tz;
              break;
            }
          }
          a.t = 0;
        }
        face = Math.atan2(a.target.x - a.x, a.target.z - a.z);
        targetSpeed = 0.7;
        // hunts swimmers, and ambushes anyone at the water's edge
        if (playing && ((playerWet && dist < 15) || dist < 4.5)) {
          setMode('hunt');
          sfxSplash();
        }
        break;
      }
      case 'hunt': {
        face = Math.atan2(dx, dz);
        targetSpeed = 4.4;
        if (dist < 2.1) {
          setMode('windup');
          sfxGrowl(0.8);
        } else if ((!playerWet && dist > 7) || dist > 24) setMode('lurk');
        break;
      }
      case 'windup': {
        face = Math.atan2(dx, dz);
        targetSpeed = 0;
        if (a.t > 0.5) {
          setMode('snap');
          a.bit = false;
        }
        break;
      }
      case 'snap': {
        if (!a.bit) {
          a.bit = true;
          sfxSnap();
          if (dist < 2.5 && combat.invuln <= 0 && playing) {
            damage(20, 'gator');
            // drag toward the water
            combat.knockX = -dx / (dist || 1) * 4;
            combat.knockZ = -dz / (dist || 1) * 4;
          }
        }
        if (a.t > 0.4) setMode('retreat');
        break;
      }
      case 'retreat': {
        face = Math.atan2(-dx, -dz);
        targetSpeed = 3;
        if (a.t > 4.5) setMode(playerWet && dist < 15 ? 'hunt' : 'lurk');
        break;
      }
      case 'dead':
        break;
    }

    if (a.mode !== 'dead') {
      let d = face - a.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a.heading += d * Math.min(1, dt * 4);
      a.speed += (targetSpeed - a.speed) * Math.min(1, dt * 3);
      const nx = a.x + Math.sin(a.heading) * a.speed * dt;
      const nz = a.z + Math.cos(a.heading) * a.speed * dt;
      if (inWater(nx, nz)) {
        a.x = nx;
        a.z = nz;
      } else a.speed *= 0.5;
    }
    me.x = a.x;
    me.z = a.z;
    me.windup = a.mode === 'windup';
    me.danger = a.mode === 'windup' || a.mode === 'snap' ? 1 : a.mode === 'hunt' ? 0.75 : a.mode === 'lurk' && playerWet && dist < 20 ? 0.3 : 0;

    // surfaced when attacking, only eyes above water while lurking
    const subTarget = a.mode === 'lurk' || a.mode === 'retreat' ? 0.75 : a.mode === 'dead' ? 1.6 : -0.4;
    a.sub += (subTarget - a.sub) * Math.min(1, dt * 3);
    a.swim += dt * (1.5 + a.speed * 1.6);
    const t = state.clock.elapsedTime;
    g.position.set(a.x, WATER_LEVEL - 0.05 - a.sub * 0.16 + Math.sin(t * 0.8 + seed) * 0.015, a.z);
    g.rotation.y = a.heading;
    g.rotation.z = a.mode === 'dead' ? Math.min(Math.PI, g.rotation.z + dt * 3) : 0;
    if (jaw.current) {
      const open = a.mode === 'windup' ? 0.7 : a.mode === 'snap' ? Math.max(0, 0.7 - a.t * 6) : a.mode === 'hunt' ? 0.08 : 0;
      jaw.current.rotation.x += (open - jaw.current.rotation.x) * Math.min(1, dt * 18);
    }
    const wag = Math.sin(a.swim) * (0.25 + Math.min(0.35, a.speed * 0.06));
    if (tail.current) tail.current.rotation.y = wag;
    if (tail2.current) tail2.current.rotation.y = wag * 1.4;
    legs.current.forEach((leg, i) => {
      if (!leg) return;
      // tuck legs while swimming fast
      leg.rotation.y = (i % 2 ? -1 : 1) * (a.speed > 2 ? 0.9 : 0.3 + Math.sin(a.swim + i) * 0.2);
    });
  });

  const legPos: [number, number, number, number][] = [
    [0.22, 0, 0.45, 1],
    [-0.22, 0, 0.45, -1],
    [0.22, 0, -0.45, 1],
    [-0.22, 0, -0.45, -1],
  ];

  return (
    <group ref={root} visible={false}>
      <mesh geometry={geo.body} material={mats.hide} />
      {legPos.map(([x, y, z, side], i) => (
        <group key={i} ref={(el) => void (legs.current[i] = el)} position={[x, y, z]} scale={[side, 1, 1]}>
          <mesh geometry={geo.legG} material={mats.hide} />
        </group>
      ))}
      <group position={[0, 0.02, 0.85]}>
        <mesh geometry={geo.upper} material={mats.hide} />
        <mesh geometry={geo.teeth} material={mats.teeth} />
        <mesh position={[0.08, 0.12, 0.07]} material={mats.eye}>
          <sphereGeometry args={[0.028, 6, 5]} />
        </mesh>
        <mesh position={[-0.08, 0.12, 0.07]} material={mats.eye}>
          <sphereGeometry args={[0.028, 6, 5]} />
        </mesh>
        <group ref={jaw} position={[0, -0.07, 0.05]}>
          <mesh geometry={geo.lower} material={mats.hide} />
        </group>
      </group>
      <group ref={tail} position={[0, -0.01, -0.85]}>
        <mesh geometry={geo.tail} material={mats.hide} />
        <group ref={tail2} position={[0, 0, -0.65]} scale={[0.7, 0.75, 1]}>
          <mesh geometry={geo.tail} material={mats.hide} />
        </group>
      </group>
    </group>
  );
}

function gatorMats() {
  return {
    hide: new MeshLambertMaterial({ vertexColors: true }),
    teeth: new MeshLambertMaterial({ color: '#ece4cc' }),
    eye: new MeshBasicMaterial({ color: '#c8b23a' }),
  };
}

type GatorMats = ReturnType<typeof gatorMats>;

export function Gators({ world }: { world: World }) {
  const spots = useMemo(() => placeGators(world), [world]);
  const geo = useMemo(gatorGeos, []);
  const mats = useMemo(gatorMats, []);
  return (
    <>
      {spots.map((s, i) => (
        <Gator key={i} home={s} seed={(world.seed ^ (i * 2654435761)) >>> 0} world={world} geo={geo} mats={mats} />
      ))}
    </>
  );
}
