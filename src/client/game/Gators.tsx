import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Bone,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Sphere,
  RepeatWrapping,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  SRGBColorSpace,
  Uint16BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfxGrowl, sfxHit, sfxSnap, sfxSplash } from './audio';
import { playerPos } from './shared';
import { hard } from './difficulty';
import { combat, createCreature, creatureSlot, damage, emit, run, toast } from './state';
import { mulberry32, WATER_LEVEL, WORLD_HALF, type World } from './world';

// Alligators: one skinned mesh per animal (tail, body, neck and skull on a 10-bone spine)
// with a procedural scute texture + bump map and a wet PBR finish. They lurk with only
// eyes and back ridges above the surface, swim with an S-wave down the spine, and open
// their jaws before a bite (dodge window). They never leave the water.

const COUNT = 7;
const VISIBLE = 40;
const LENGTH = 3.1; // tail tip (z=0) to snout (z=LENGTH)
const BONES = 10;
const HEAD_START = 0.8;
const SEG = (LENGTH * HEAD_START) / (BONES - 1);
const RINGS = 96;
const RADIAL = 16;

// width / height of the cross-section along the body (u: 0 tail tip .. 1 snout)
function profile(u: number) {
  if (u < 0.5) {
    const k = u / 0.5;
    // tail: flattened side to side, taller than wide near the tip
    return { w: 0.035 + k * 0.24, h: 0.07 + k * 0.14 };
  }
  if (u < 0.76) {
    const k = (u - 0.5) / 0.26;
    return { w: 0.27 + Math.sin(k * Math.PI) * 0.07, h: 0.21 + Math.sin(k * Math.PI) * 0.02 };
  }
  if (u < HEAD_START + 0.02) return { w: 0.23, h: 0.17 };
  // skull widens at the jaw hinge, then a long flat tapering snout
  const k = (u - HEAD_START - 0.02) / (1 - HEAD_START - 0.02);
  const w = k < 0.2 ? 0.23 - k * 0.1 : 0.21 - (k - 0.2) * 0.17;
  const h = 0.15 - k * 0.09;
  return { w: Math.max(0.05, w), h: Math.max(0.045, h) };
}

function bodyGeometry() {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const skinI: number[] = [];
  const skinW: number[] = [];
  for (let r = 0; r <= RINGS; r++) {
    const u = r / RINGS;
    const z = u * LENGTH;
    const { w, h } = profile(u);
    for (let a = 0; a <= RADIAL; a++) {
      const ang = (a / RADIAL) * Math.PI * 2;
      const s = Math.sin(ang);
      const c = Math.cos(ang);
      let x = c * w;
      let y = s * h * (s < 0 ? 0.55 : 1);
      // rows of armoured scutes (osteoderms) along the back and a double crest on the tail
      if (s > 0.35 && u < 0.8) {
        const rows = Math.abs(c) < 0.18 || (Math.abs(c) > 0.32 && Math.abs(c) < 0.55);
        const bumps = Math.pow(Math.max(0, Math.sin(z * 22)), 2);
        if (rows) y += h * 0.22 * bumps * (u < 0.5 ? 1.4 : 1);
      }
      // bulging eye sockets and nostril on the head
      if (u > 0.84 && u < 0.89 && s > 0.6 && Math.abs(c) > 0.25 && Math.abs(c) < 0.6) y += 0.035;
      if (u > 0.985 && s > 0.7) y += 0.015;
      // slight belly sag behind the front legs
      if (s < 0 && u > 0.5 && u < 0.76) y -= 0.03;
      x *= 1;
      pos.push(x, y, z);
      uv.push(a / RADIAL, u * 10);
      const f = Math.min(BONES - 1, z / SEG);
      const i0 = Math.min(BONES - 1, Math.floor(f));
      const i1 = Math.min(BONES - 1, i0 + 1);
      const t = f - i0;
      skinI.push(i0, i1, 0, 0);
      skinW.push(1 - t, t, 0, 0);
    }
  }
  for (let r = 0; r < RINGS; r++) {
    for (let a = 0; a < RADIAL; a++) {
      const p0 = r * (RADIAL + 1) + a;
      const p1 = p0 + RADIAL + 1;
      idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(skinI, 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute(skinW, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function hideTextures() {
  const W = 128;
  const H = 512;
  const col = document.createElement('canvas');
  col.width = W;
  col.height = H;
  const g = col.getContext('2d')!;
  const rng = mulberry32(31);
  // u=0.25 is the spine, u=0.75 the belly
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#4d5330');
  grad.addColorStop(0.25, '#2f3420');
  grad.addColorStop(0.45, '#4f5532');
  grad.addColorStop(0.62, '#a39a6c');
  grad.addColorStop(0.75, '#cdc39a');
  grad.addColorStop(0.88, '#a39a6c');
  grad.addColorStop(1, '#4d5330');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // mottled dark bands across the back
  for (let y = 0; y < H; y += 40) {
    g.fillStyle = `rgba(20, 22, 12, ${0.35 + rng() * 0.25})`;
    g.fillRect(0, y + rng() * 8, W * 0.5, 14 + rng() * 8);
  }
  // scale plates: grid on back + flanks, larger rectangles on the belly
  const bump = document.createElement('canvas');
  bump.width = W;
  bump.height = H;
  const b = bump.getContext('2d')!;
  b.fillStyle = '#303030';
  b.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 12) {
    for (let x = 0; x < W; x += 10) {
      const belly = x > W * 0.6 && x < W * 0.9;
      const shade = 150 + Math.floor(rng() * 70);
      b.fillStyle = `rgb(${shade},${shade},${shade})`;
      b.fillRect(x + 1, y + 1, belly ? 9 : 8, belly ? 11 : 10);
      g.strokeStyle = 'rgba(15, 16, 9, 0.35)';
      g.strokeRect(x + 0.5, y + 0.5, 10, 12);
    }
  }
  const map = new CanvasTexture(col);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  const bumpMap = new CanvasTexture(bump);
  bumpMap.wrapS = bumpMap.wrapT = RepeatWrapping;
  return { map, bumpMap };
}

function partGeos() {
  // lower jaw: long flat wedge hinged at the back of the skull
  const jaw = new CapsuleGeometry(0.07, 0.48, 4, 10);
  jaw.rotateX(Math.PI / 2);
  jaw.scale(1.35, 0.42, 1);
  jaw.translate(0, 0, 0.3);
  const teeth: BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    for (const side of [-1, 1]) {
      const t = new ConeGeometry(0.011, 0.045, 4);
      t.rotateX(Math.PI);
      t.translate(side * (0.085 - i * 0.004), -0.05, 0.06 + i * 0.058);
      teeth.push(t);
    }
  }
  const teethG = mergeGeometries(teeth.map((t) => {
    t.deleteAttribute('uv');
    return t;
  }))!;
  // sprawled legs: upper limb + webbed foot
  const thigh = new CapsuleGeometry(0.055, 0.2, 4, 8);
  thigh.rotateZ(Math.PI / 2 - 0.3);
  thigh.translate(0.13, -0.04, 0);
  const shin = new CapsuleGeometry(0.045, 0.16, 4, 8);
  shin.translate(0.26, -0.13, 0.02);
  const foot = new SphereGeometry(0.07, 8, 6);
  foot.scale(1.1, 0.3, 1.3);
  foot.translate(0.29, -0.22, 0.06);
  const leg = mergeGeometries([thigh, shin, foot])!;
  leg.computeVertexNormals();
  return { jaw, teethG, leg, eye: new SphereGeometry(0.032, 12, 10), pupil: new SphereGeometry(0.012, 6, 5) };
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

function Gator({ home, seed, world, shared }: { home: Spot; seed: number; world: World; shared: Shared }) {
  const root = useRef<Group>(null);
  const rig = useMemo(() => makeRig(shared), [shared]);
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
        if (playing && ((playerWet && dist < 15 * hard.sense()) || dist < 4.5)) {
          setMode('hunt');
          sfxSplash();
        }
        break;
      }
      case 'hunt': {
        face = Math.atan2(dx, dz);
        targetSpeed = 4.4 * hard.speed();
        if (dist < 2.1) {
          setMode('windup');
          sfxGrowl(0.8);
        } else if ((!playerWet && dist > 7) || dist > 24) setMode('lurk');
        break;
      }
      case 'windup': {
        face = Math.atan2(dx, dz);
        targetSpeed = 0;
        if (a.t > 0.5 * hard.windup()) {
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
            damage(20 * hard.dmg(), 'gator');
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

    // surfaced when attacking, only eyes and ridges above water while lurking
    const subTarget = a.mode === 'lurk' || a.mode === 'retreat' ? 0.75 : a.mode === 'dead' ? 1.6 : -0.4;
    a.sub += (subTarget - a.sub) * Math.min(1, dt * 3);
    a.swim += dt * (1.5 + a.speed * 1.6);
    const t = state.clock.elapsedTime;
    g.position.set(a.x, WATER_LEVEL + 0.08 - a.sub * 0.2 + Math.sin(t * 0.8 + seed) * 0.015, a.z);
    g.rotation.y = a.heading;
    g.rotation.z = a.mode === 'dead' ? Math.min(Math.PI, g.rotation.z + dt * 3) : 0;

    // S-wave down the spine: strongest at the tail, head stays steady
    const amp = 0.12 + Math.min(0.22, a.speed * 0.05);
    rig.bones.forEach((b, i) => {
      if (i === BONES - 1) {
        const open = a.mode === 'windup' ? -0.12 : 0;
        b.rotation.set(open, -Math.sin(a.swim - i * 0.55) * amp * 0.15, 0);
        return;
      }
      const k = 1 - i / (BONES - 1);
      b.rotation.set(0, Math.sin(a.swim - i * 0.55) * amp * (0.35 + k * 1.1), 0);
    });
    const open = a.mode === 'windup' ? 0.75 : a.mode === 'snap' ? Math.max(0, 0.75 - a.t * 6) : a.mode === 'hunt' ? 0.08 : 0;
    rig.jaw.rotation.x += (open - rig.jaw.rotation.x) * Math.min(1, dt * 18);
    rig.legs.forEach((leg, i) => {
      // tuck legs against the body while swimming fast, paddle slowly otherwise
      const side = i % 2 ? -1 : 1;
      leg.rotation.y = side * (a.speed > 2 ? -0.9 : -0.2 + Math.sin(a.swim + i) * 0.3);
    });
  });

  return (
    <group ref={root} visible={false}>
      {/* origin sits mid-body so bite distances measure from the shoulders */}
      <group position={[0, 0, -LENGTH * 0.62]}>
        <primitive object={rig.mesh} />
      </group>
    </group>
  );
}

function makeRig(shared: Shared) {
  const bones: Bone[] = [];
  for (let i = 0; i < BONES; i++) {
    const b = new Bone();
    b.position.set(0, 0, i === 0 ? 0 : SEG);
    if (i > 0) bones[i - 1]!.add(b);
    bones.push(b);
  }
  const mesh = new SkinnedMesh(shared.body, shared.hide);
  mesh.add(bones[0]!);
  mesh.updateMatrixWorld(true); // bones need world matrices before bind() computes inverses
  mesh.bind(new Skeleton(bones));
  // fixed generous bounds around the rig so animals off-screen skip skinning + draw
  mesh.boundingSphere = new Sphere(shared.body.boundingSphere?.center.clone(), LENGTH * 1.5);

  const head = bones[BONES - 1]!;
  // lower jaw + teeth hinge at the back of the skull
  const jaw = new Group();
  jaw.position.set(0, -0.06, 0.02);
  jaw.add(new Mesh(shared.parts.jaw, shared.hide));
  const lowerTeeth = new Mesh(shared.parts.teethG, shared.teeth);
  lowerTeeth.position.y = 0.1;
  lowerTeeth.scale.y = -1;
  jaw.add(lowerTeeth);
  head.add(jaw);
  head.add(new Mesh(shared.parts.teethG, shared.teeth));
  // raised eyes with vertical slit pupils
  for (const side of [1, -1]) {
    const eye = new Mesh(shared.parts.eye, shared.eye);
    eye.position.set(side * 0.085, 0.13, 0.11);
    const pupil = new Mesh(shared.parts.pupil, shared.pupil);
    pupil.scale.set(0.35, 1.4, 0.5);
    pupil.position.set(side * 0.1, 0.135, 0.125);
    head.add(eye, pupil);
  }
  // legs on the shoulder and hip bones
  const legs: Group[] = [];
  const shoulder = bones[Math.round((LENGTH * 0.72) / SEG)]!;
  const hip = bones[Math.round((LENGTH * 0.5) / SEG)]!;
  for (const [bone, z] of [
    [shoulder, 0.02],
    [hip, 0.0],
  ] as const) {
    for (const side of [1, -1]) {
      const g = new Group();
      g.position.set(side * 0.2, -0.04, z);
      g.scale.x = side;
      g.add(new Mesh(shared.parts.leg, shared.hide));
      bone.add(g);
      legs.push(g);
    }
  }
  return { mesh, bones, jaw, legs };
}

type Shared = {
  body: BufferGeometry;
  hide: MeshLambertMaterial;
  teeth: MeshLambertMaterial;
  eye: MeshLambertMaterial;
  pupil: MeshBasicMaterial;
  parts: ReturnType<typeof partGeos>;
};

export function Gators({ world }: { world: World }) {
  const spots = useMemo(() => placeGators(world), [world]);
  const shared = useMemo<Shared>(() => {
    const tex = hideTextures();
    return {
      body: bodyGeometry(),
      // wet, slightly glossy hide
      hide: new MeshLambertMaterial({ map: tex.map }),
      teeth: new MeshLambertMaterial({ color: '#efe7d0' }),
      eye: new MeshLambertMaterial({ color: '#c9a62a', emissive: '#2a1f00' }),
      pupil: new MeshBasicMaterial({ color: '#080604' }),
      parts: partGeos(),
    };
  }, []);
  return (
    <>
      {spots.map((s, i) => (
        <Gator key={i} home={s} seed={(world.seed ^ (i * 2654435761)) >>> 0} world={world} shared={shared} />
      ))}
    </>
  );
}
