import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Bone,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
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
import { sfxHiss, sfxHit } from './audio';
import { playerPos } from './shared';
import { hard } from './difficulty';
import { combat, createCreature, creatureSlot, damage, emit, run, toast } from './state';
import { mulberry32, WATER_LEVEL, WORLD_HALF, type World } from './world';

// Pit vipers: one skinned mesh each (body + head share a 14-bone spine), PBR scales
// with a procedural diamond-back texture and bump map. They coil, rear up and strike.
// A bite poisons you until you use a med kit or poultice. One weapon hit kills.

const COUNT = 18;
const VISIBLE = 32;
const LENGTH = 1.75;
const BONES = 14;
// spine bones run from the tail tip to the base of the head; the head rides the last bone
const HEAD_START = 0.86;
const SEG = (LENGTH * HEAD_START) / (BONES - 1);
const RINGS = 84;
const RADIAL = 12;

// --- textures -------------------------------------------------------------
function scaleTextures() {
  const W = 128;
  const H = 512;
  const col = document.createElement('canvas');
  col.width = W;
  col.height = H;
  const g = col.getContext('2d')!;
  // base: olive-brown back, cream belly (u=0.25 is the top of the body, u=0.75 the belly)
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#5e5a2c');
  grad.addColorStop(0.25, '#6f6a33');
  grad.addColorStop(0.55, '#7d7445');
  grad.addColorStop(0.68, '#cfc28c');
  grad.addColorStop(0.82, '#d8cc96');
  grad.addColorStop(0.95, '#7d7445');
  grad.addColorStop(1, '#5e5a2c');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // dark diamond saddles down the spine
  const rng = mulberry32(7);
  for (let y = 0; y < H; y += 48) {
    const cx = W * 0.25;
    const w = W * 0.22;
    const h = 26;
    g.fillStyle = '#26220f';
    g.beginPath();
    g.moveTo(cx, y);
    g.lineTo(cx + w, y + h);
    g.lineTo(cx, y + h * 2);
    g.lineTo(cx - w, y + h);
    g.closePath();
    g.fill();
    g.fillStyle = '#8b7f40';
    g.beginPath();
    g.moveTo(cx, y + 8);
    g.lineTo(cx + w * 0.55, y + h);
    g.lineTo(cx, y + h * 2 - 8);
    g.lineTo(cx - w * 0.55, y + h);
    g.closePath();
    g.fill();
    // flank blotches
    g.fillStyle = 'rgba(38, 34, 15, 0.8)';
    for (const fx of [W * 0.52, W * 0.98]) {
      g.beginPath();
      g.ellipse(fx, y + h + (rng() - 0.5) * 8, 7, 9, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // scales bump: a grid of small overlapping ellipses
  const bump = document.createElement('canvas');
  bump.width = W;
  bump.height = H;
  const b = bump.getContext('2d')!;
  b.fillStyle = '#404040';
  b.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 8) {
    for (let x = (y / 8) % 2 ? 4 : 0; x < W; x += 8) {
      const r = b.createRadialGradient(x, y, 0, x, y, 5);
      r.addColorStop(0, '#d0d0d0');
      r.addColorStop(1, '#404040');
      b.fillStyle = r;
      b.beginPath();
      b.ellipse(x, y, 4.5, 5.5, 0, 0, Math.PI * 2);
      b.fill();
    }
  }
  const map = new CanvasTexture(col);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  const bumpMap = new CanvasTexture(bump);
  bumpMap.wrapS = bumpMap.wrapT = RepeatWrapping;
  return { map, bumpMap };
}

// --- skinned body ---------------------------------------------------------
// Built straight along +Z from tail tip (z=0) to snout (z=LENGTH).
function bodyGeometry() {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const skinI: number[] = [];
  const skinW: number[] = [];
  for (let r = 0; r <= RINGS; r++) {
    const u = r / RINGS;
    const z = u * LENGTH;
    let rad: number;
    let wx = 1;
    let hy = 0.85;
    if (u < 0.3) rad = 0.008 + (u / 0.3) * 0.05;
    else if (u < 0.74) rad = 0.058 + Math.sin(((u - 0.3) / 0.44) * Math.PI) * 0.012;
    else if (u < 0.85) rad = 0.058 - ((u - 0.74) / 0.11) * 0.022; // neck
    else {
      // triangular viper head: wide jowls, flat top, tapering snout
      const k = (u - 0.85) / 0.15;
      rad = 0.036 + Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * 0.03 - Math.max(0, k - 0.55) * 0.12;
      rad = Math.max(0.01, rad);
      wx = 1.25;
      hy = 0.55;
    }
    for (let a = 0; a <= RADIAL; a++) {
      const ang = (a / RADIAL) * Math.PI * 2;
      const s = Math.sin(ang);
      const x = Math.cos(ang) * rad * wx;
      const y = s * rad * hy * (s < 0 ? 0.75 : 1); // flatter belly
      pos.push(x, y + rad * 0.6, z);
      uv.push(a / RADIAL, u * 6);
      // two-bone weights along the spine; head rides the last bone
      const f = Math.min(BONES - 1, z / SEG);
      const i0 = Math.min(BONES - 1, Math.floor(f));
      const i1 = Math.min(BONES - 1, i0 + 1);
      const w = f - i0;
      skinI.push(i0, i1, 0, 0);
      skinW.push(1 - w, w, 0, 0);
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
  // the coiled pose is much more compact than the bind pose; keep culling generous
  geo.boundingSphere!.radius = LENGTH;
  return geo;
}

type Spot = { x: number; z: number; r: number };

function placeSnakes(world: World): Spot[] {
  const rng = mulberry32(world.seed ^ 0x2c1b3c6d);
  const out: Spot[] = [];
  for (let i = 0; i < 4000 && out.length < COUNT; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 12);
    const z = (rng() * 2 - 1) * (WORLD_HALF - 12);
    const h = world.heightAt(x, z);
    if (h < WATER_LEVEL + 0.4 || h > 8) continue;
    if (Math.hypot(x - world.wreck.x, z - world.wreck.z) < 20) continue;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 14)) continue;
    if (world.detail(x, z) < 0.35 && rng() < 0.6) continue;
    out.push({ x, z, r: rng() * Math.PI * 2 });
  }
  return out;
}

type Shared = {
  geo: BufferGeometry;
  mat: MeshLambertMaterial;
  eyeGeo: SphereGeometry;
  eyeMat: MeshLambertMaterial;
  pupilGeo: BoxGeometry;
  dark: MeshBasicMaterial;
  tongueGeo: ConeGeometry;
  tongueMat: MeshBasicMaterial;
};

type Mode = 'coiled' | 'alert' | 'strike' | 'cooldown' | 'dead';

function Snake({ spot, world, shared }: { spot: Spot; world: World; shared: Shared }) {
  const root = useRef<Group>(null);
  const me = useMemo(() => createCreature('snake', spot.x, spot.z), [spot]);
  useEffect(creatureSlot(me), [me]);
  const y = useMemo(() => world.heightAt(spot.x, spot.z), [world, spot]);

  // one skeleton per snake; geometry + materials are shared
  const rig = useMemo(() => {
    const bones: Bone[] = [];
    for (let i = 0; i < BONES; i++) {
      const b = new Bone();
      b.position.set(0, 0, i === 0 ? 0 : SEG);
      if (i > 0) bones[i - 1]!.add(b);
      bones.push(b);
    }
    const mesh = new SkinnedMesh(shared.geo, shared.mat);
    mesh.add(bones[0]!);
    mesh.updateMatrixWorld(true); // bones need world matrices before bind() computes inverses
    mesh.bind(new Skeleton(bones));
    // fixed generous bounds around the rig so snakes off-screen skip skinning + draw
    mesh.boundingSphere = new Sphere(shared.geo.boundingSphere?.center.clone(), LENGTH * 1.5);
    // eyes, slit pupils and tongue ride the head bone
    const head = bones[BONES - 1]!;
    for (const side of [1, -1]) head.add(makeEye(shared, side));
    const tongue = makeTongue(shared);
    head.add(tongue);
    return { mesh, bones, tongue };
  }, [shared]);

  const st = useRef({ mode: 'coiled' as Mode, t: 0, rear: 0, lunge: 0, facing: spot.r, bit: false, roll: 0 });

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    const g = root.current;
    if (!g) return;
    const dx = playerPos.x - spot.x;
    const dz = playerPos.z - spot.z;
    const dist = Math.hypot(dx, dz);
    g.visible = dist < VISIBLE && run.phase !== 'intro';
    if (!g.visible) {
      me.danger = 0;
      me.windup = false;
      return;
    }
    s.t += dt;
    const playing = run.phase === 'play';

    if (me.pendingHit > 0 && s.mode !== 'dead') {
      me.pendingHit = 0;
      s.mode = 'dead';
      s.t = 0;
      me.alive = false;
      run.kills.snake++;
      sfxHit();
      toast('Viper killed.');
      emit();
    }

    switch (s.mode) {
      case 'coiled':
        if (playing && dist < 4.6 * hard.sense()) {
          s.mode = 'alert';
          s.t = 0;
          sfxHiss();
        }
        break;
      case 'alert':
        s.facing = Math.atan2(dx, dz);
        if (dist > 6.5) s.mode = 'coiled';
        else if (s.t > 0.75 * hard.windup() && dist < 2.7) {
          s.mode = 'strike';
          s.t = 0;
          s.bit = false;
        }
        break;
      case 'strike':
        if (!s.bit && s.t > 0.09) {
          s.bit = true;
          if (dist < 2.8 && combat.invuln <= 0 && playing) {
            damage(10 * hard.dmg(), 'snake');
            if (!run.poisoned) {
              run.poisoned = true;
              toast('Venom! Use a med kit or make a poultice from herbs.');
              emit();
            }
          }
        }
        if (s.t > 0.35) {
          s.mode = 'cooldown';
          s.t = 0;
        }
        break;
      case 'cooldown':
        if (s.t > 2.2) {
          s.mode = dist < 4.6 ? 'alert' : 'coiled';
          s.t = 0;
          if (s.mode === 'alert') sfxHiss();
        }
        break;
      case 'dead':
        break;
    }

    me.windup = s.mode === 'alert' && s.t > 0.25 && dist < 3.5;
    me.danger = s.mode === 'dead' || s.mode === 'coiled' ? 0 : 0.55 + (me.windup ? 0.4 : 0);

    // --- pose the spine -------------------------------------------------
    const t = state.clock.elapsedTime;
    const rearT = s.mode === 'alert' || s.mode === 'strike' ? 1 : 0;
    s.rear += (rearT - s.rear) * Math.min(1, dt * 7);
    s.lunge = s.mode === 'strike' ? Math.sin(Math.min(1, s.t / 0.35) * Math.PI) : 0;
    const dead = s.mode === 'dead';
    const breathe = Math.sin(t * 1.4 + spot.r) * 0.03;
    let heading = 0;
    rig.bones.forEach((b, i) => {
      let by: number;
      let bx = 0;
      if (dead) {
        by = i < BONES - 1 ? 0.18 * Math.sin(i * 0.9) : 0;
      } else if (i < BONES - 4) {
        // the coil: tighter toward the tail
        by = 0.78 - i * 0.035 + breathe;
        bx = -0.035;
      } else if (i < BONES - 1) {
        // neck: S-curve that rears up when alarmed, straightens to strike
        const k = i - (BONES - 4);
        by = (0.35 - k * 0.15) * (1 - s.lunge);
        bx = -0.15 - s.rear * (0.55 - k * 0.12) + s.lunge * 0.5;
      } else {
        // head stays level with the ground
        bx = 0.25 + s.rear * 0.95 - s.lunge * 0.3;
        by = Math.sin(t * (s.mode === 'alert' ? 5 : 1.2)) * (s.mode === 'alert' ? 0.12 : 0.04);
      }
      b.rotation.set(bx, by, 0);
      heading += by;
    });
    rig.tongue.visible = !dead && Math.sin(t * (s.mode === 'alert' ? 16 : 6) + spot.r) > 0.6;

    // rotate the whole coil so the head points where the snake is looking
    let d = s.facing - heading - g.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g.rotation.y += d * Math.min(1, dt * 6);
    s.roll = dead ? Math.min(Math.PI, s.roll + dt * 6) : 0;
    g.rotation.z = s.roll;
    g.position.set(spot.x + Math.sin(s.facing) * s.lunge * 0.4, y + 0.01, spot.z + Math.cos(s.facing) * s.lunge * 0.4);
  });

  return (
    <group ref={root} visible={false}>
      {/* center the coil roughly on the spot */}
      <group position={[-0.3, 0, -0.12]} scale={1.25}>
        <primitive object={rig.mesh} />
      </group>
    </group>
  );
}

// Amber eye with a vertical slit pupil, mounted on the head bone.
function makeEye(shared: Shared, side: number) {
  const g = new Group();
  const eye = new Mesh(shared.eyeGeo, shared.eyeMat);
  eye.position.set(side * 0.048, 0.062, 0.1);
  const pupil = new Mesh(shared.pupilGeo, shared.dark);
  pupil.position.set(side * 0.06, 0.062, 0.102);
  g.add(eye, pupil);
  return g;
}

// Forked tongue that flicks out of the snout.
function makeTongue(shared: Shared) {
  const g = new Group();
  for (const side of [1, -1]) {
    const m = new Mesh(shared.tongueGeo, shared.tongueMat);
    m.position.set(0, 0.03, 0.22);
    m.rotation.y = side * 0.22;
    g.add(m);
  }
  return g;
}


export function Snakes({ world }: { world: World }) {
  const spots = useMemo(() => placeSnakes(world), [world]);
  const shared = useMemo<Shared>(() => {
    const tex = scaleTextures();
    const tongueGeo = new ConeGeometry(0.005, 0.08, 3);
    tongueGeo.rotateX(Math.PI / 2);
    tongueGeo.translate(0, 0, 0.04);
    return {
      geo: bodyGeometry(),
      mat: new MeshLambertMaterial({ map: tex.map }),
      eyeGeo: new SphereGeometry(0.016, 10, 8),
      eyeMat: new MeshLambertMaterial({ color: '#d8a826', emissive: '#3a2a00' }),
      pupilGeo: new BoxGeometry(0.004, 0.022, 0.006),
      dark: new MeshBasicMaterial({ color: '#0a0806' }),
      tongueGeo,
      tongueMat: new MeshBasicMaterial({ color: '#a51d2a' }),
    };
  }, []);
  return (
    <>
      {spots.map((s, i) => (
        <Snake key={i} spot={s} world={world} shared={shared} />
      ))}
    </>
  );
}
