import { useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Chunked, type Inst } from './Chunked';
import { addWind } from './fx';
import { PALETTE } from './shared';
import { mulberry32, WATER_LEVEL, WORLD_HALF, type World } from './world';

const dummy = new Object3D();
const tmp = new Color();

// Paint a vertical gradient (dark underside -> lit top) plus per-vertex jitter.
function shade(geo: BufferGeometry, bottom: number, top: number, low: number, high: number, seed: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position!;
  const rng = mulberry32(seed);
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - bottom) / (top - bottom)));
    const v = low + (high - low) * t + (rng() - 0.5) * 0.12;
    cols[i * 3] = v;
    cols[i * 3 + 1] = v;
    cols[i * 3 + 2] = v;
  }
  g.setAttribute('color', new BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  return g;
}

// Duplicate every triangle with reversed winding. Lets thin leaves render both sides with
// FrontSide materials, avoiding the dark backface lighting of DoubleSide.
function twoSided(geo: BufferGeometry, keepNormals: boolean) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(g.attributes);
  const out = new BufferGeometry();
  for (const name of names) {
    const a = g.attributes[name]!;
    const n = a.count;
    const size = a.itemSize;
    const arr = new Float32Array(n * size * 2);
    arr.set(a.array as ArrayLike<number>);
    for (let t = 0; t < n; t += 3) {
      const order = [0, 2, 1];
      for (let k = 0; k < 3; k++) {
        for (let c = 0; c < size; c++) {
          let val = a.getComponent(t + order[k]!, c);
          if (name === "normal" && !keepNormals) val = -val;
          arr[(n + t + k) * size + c] = val;
        }
      }
    }
    out.setAttribute(name, new BufferAttribute(arr, size));
  }
  return out;
}

function crownGeometry() {
  const a = new IcosahedronGeometry(1.5, 0);
  a.scale(1.15, 0.8, 1.15);
  const b = new IcosahedronGeometry(1.1, 0);
  b.translate(0.8, 0.7, 0.3);
  const c = new IcosahedronGeometry(1.0, 0);
  c.translate(-0.7, 0.5, -0.5);
  const d = new IcosahedronGeometry(0.85, 0);
  d.translate(0.1, 1.35, -0.1);
  const parts = [a, b, c, d].map((g) => shade(g, -1.2, 2.2, 0.55, 1.15, 7));
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return merged;
}

// Palm: 8 drooping fronds made from bent strips.
function palmCrownGeometry() {
  const fronds: BufferGeometry[] = [];
  const LEN = 6;
  for (let f = 0; f < 8; f++) {
    const pos: number[] = [];
    const ang = (f / 8) * Math.PI * 2 + (f % 2) * 0.2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let s = 0; s < LEN; s++) {
      const r0 = (s / LEN) * 3.2;
      const r1 = ((s + 1) / LEN) * 3.2;
      const y0 = 0.4 * r0 - 0.16 * r0 * r0;
      const y1 = 0.4 * r1 - 0.16 * r1 * r1;
      const w0 = Math.sin((s / LEN) * Math.PI) * 0.55 + 0.05;
      const w1 = Math.sin(((s + 1) / LEN) * Math.PI) * 0.55 + 0.05;
      // quad in frond-local space (x along frond, z across)
      const q = [
        [r0, y0, -w0],
        [r1, y1, -w1],
        [r1, y1 - 0.08, w1],
        [r0, y0 - 0.08, w0],
      ].map(([x, y, z]) => [x! * ca - z! * sa, y!, x! * sa + z! * ca]);
      const [A, B, C, D] = q as [number[], number[], number[], number[]];
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    fronds.push(shade(g, -1.6, 0.4, 0.6, 1.1, f + 11));
  }
  const merged = mergeGeometries(fronds)!;
  merged.computeVertexNormals();
  return twoSided(merged, false);
}

function palmTrunkGeometry() {
  const g = new CylinderGeometry(0.13, 0.24, 1, 6, 6);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + y * y * 0.55); // gentle lean/curve
  }
  g.computeVertexNormals();
  return shade(g, 0, 1, 0.75, 1.05, 3);
}

function trunkGeometry() {
  const g = new CylinderGeometry(0.17, 0.32, 1, 6, 2);
  g.translate(0, 0.5, 0);
  // flared roots
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < 0.01) {
      p.setX(i, p.getX(i) * 1.6);
      p.setZ(i, p.getZ(i) * 1.6);
    }
  }
  g.computeVertexNormals();
  return shade(g, 0, 1, 0.7, 1.0, 5);
}

function fernGeometry() {
  const leaves: BufferGeometry[] = [];
  for (let f = 0; f < 7; f++) {
    const ang = (f / 7) * Math.PI * 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const L = 1.1;
    const pts = [
      [0, 0, -0.06],
      [L * 0.5, 0.45, -0.16],
      [L, 0.25, 0],
      [L * 0.5, 0.45, 0.16],
      [0, 0, 0.06],
    ].map(([x, y, z]) => [x! * ca - z! * sa, y!, x! * sa + z! * ca]);
    const [a, b, c, d, e] = pts as [number[], number[], number[], number[], number[]];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([...a, ...b, ...d, ...a, ...d, ...e, ...b, ...c, ...d]), 3));
    leaves.push(shade(g, 0, 0.45, 0.55, 1.1, f + 21));
  }
  const merged = mergeGeometries(leaves)!;
  merged.computeVertexNormals();
  return twoSided(merged, false);
}

function grassTuftGeometry() {
  const blades: BufferGeometry[] = [];
  for (let b = 0; b < 4; b++) {
    const ang = (b / 4) * Math.PI + b * 0.3;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const h = 0.45 + (b % 2) * 0.2;
    const w = 0.07;
    const lean = 0.12 * (b % 2 ? 1 : -1);
    const pts = [
      [-w, 0, 0],
      [w, 0, 0],
      [lean, h, 0],
    ].map(([x, y, z]) => [x! * ca - z! * sa + (b - 1.5) * 0.06, y!, x! * sa + z! * ca]);
    const [a, c, d] = pts as [number[], number[], number[]];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([...a, ...c, ...d]), 3));
    const cols = new Float32Array([0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 1.15, 1.15, 1.15]);
    g.setAttribute('color', new BufferAttribute(cols, 3));
    blades.push(g);
  }
  const merged = mergeGeometries(blades)!;
  // point normals up so blades light like the ground they sit on
  const n = new Float32Array(merged.attributes.position!.count * 3);
  for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
  merged.setAttribute('normal', new BufferAttribute(n, 3));
  return twoSided(merged, true);
}

export function Vegetation({ world, shadows, density }: { world: World; shadows: boolean; density: number }) {

  const geos = useMemo(() => {
    const bush = new IcosahedronGeometry(0.75, 0);
    bush.scale(1, 0.62, 1);
    const rock = new DodecahedronGeometry(0.6, 1);
    rock.scale(1, 0.62, 1);
    const rp = rock.attributes.position!;
    const rr = mulberry32(5);
    for (let i = 0; i < rp.count; i++) {
      const k = 0.85 + rr() * 0.3;
      rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k, rp.getZ(i) * k);
    }
    rock.computeVertexNormals();
    return {
      trunk: trunkGeometry(),
      crown: crownGeometry(),
      palmTrunk: palmTrunkGeometry(),
      palm: palmCrownGeometry(),
      bush: shade(bush, -0.5, 0.5, 0.55, 1.1, 9),
      fern: fernGeometry(),
      rock: shade(rock, -0.4, 0.4, 0.7, 1.05, 13),
      grass: grassTuftGeometry(),
    };
  }, []);

  const mats = useMemo(() => {
    const crown = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    addWind(crown, 0.18, 2.5, 'crown');
    const palm = new MeshLambertMaterial({ vertexColors: true });
    addWind(palm, 0.35, 1.0, 'palm');
    const fern = new MeshLambertMaterial({ vertexColors: true });
    addWind(fern, 0.08, 0.5, 'fern');
    const grassM = new MeshLambertMaterial({ vertexColors: true });
    addWind(grassM, 0.12, 0.6, 'grass');
    const bush = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const trunk = new MeshLambertMaterial({ vertexColors: true, color: PALETTE.trunk });
    const palmTrunk = new MeshLambertMaterial({ vertexColors: true, color: '#7a6248' });
    const rock = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    return { crown, palm, fern, grass: grassM, bush, trunk, palmTrunk, rock };
  }, []);

  const broad = useMemo(() => world.trees.filter((t) => t.kind === 0), [world]);
  const palmTrees = useMemo(() => world.trees.filter((t) => t.kind === 1), [world]);
  const fernList = useMemo(() => world.bushes.filter((_, i) => i % 3 === 0), [world]);
  const bushList = useMemo(() => world.bushes.filter((_, i) => i % 3 !== 0), [world]);

  const grassSpots = useMemo(() => {
    const rng = mulberry32(world.seed ^ 0x9e3779b9);
    const target = Math.round(14000 * density);
    const out: { x: number; z: number; y: number; s: number; r: number; h: number }[] = [];
    for (let i = 0; i < target * 4 && out.length < target; i++) {
      const x = (rng() * 2 - 1) * (WORLD_HALF - 8);
      const z = (rng() * 2 - 1) * (WORLD_HALF - 8);
      const y = world.heightAt(x, z);
      if (y < WATER_LEVEL + 0.3 || y > 8) continue;
      if (Math.abs(x - world.riverX(z)) < 4.5) continue;
      if (Math.hypot(x - world.wreck.x, z - world.wreck.z) < 4) continue;
      // clumps: favour patches of the detail noise
      if (world.detail(x, z) < 0.38 && rng() > 0.25) continue;
      out.push({ x, z, y, s: 0.7 + rng() * 0.8, r: rng() * Math.PI * 2, h: rng() });
    }
    return out;
  }, [world, density]);

  const inst = useMemo(() => {
    const out = { trunks: [] as Inst[], crowns: [] as Inst[], palmTrunks: [] as Inst[], palms: [] as Inst[], bushes: [] as Inst[], ferns: [] as Inst[], rocks: [] as Inst[], grass: [] as Inst[] };
    const push = (list: Inst[], c?: Color) => {
      dummy.updateMatrix();
      list.push(c ? { m: dummy.matrix.clone(), c: c.clone() } : { m: dummy.matrix.clone() });
    };
    const leafA = new Color(PALETTE.leafA);
    const leafB = new Color(PALETTE.leafB);
    const leafC = new Color(PALETTE.leafC);

    broad.forEach((t) => {
      const y = world.heightAt(t.x, t.z) - 0.15;
      const h = 4.4 * t.s;
      dummy.position.set(t.x, y, t.z);
      dummy.rotation.set(0, t.hue * 6, 0);
      dummy.scale.set(t.s, h, t.s);
      push(out.trunks);

      dummy.position.set(t.x, y + h + 0.5 * t.s, t.z);
      dummy.scale.set(t.s * 1.1, t.s, t.s * 1.1);
      tmp.copy(leafA).lerp(leafB, t.hue).lerp(leafC, Math.max(0, t.hue - 0.7));
      push(out.crowns, tmp);
    });

    const palmCol = new Color(PALETTE.palm);
    palmTrees.forEach((t) => {
      const y = world.heightAt(t.x, t.z) - 0.15;
      const h = 7 * t.s;
      dummy.position.set(t.x, y, t.z);
      dummy.rotation.set(0, t.hue * 6, 0);
      dummy.scale.set(t.s, h, t.s);
      push(out.palmTrunks);
      // top of curved trunk: local x offset 0.55 at y=1, scaled by height & rotated
      const off = 0.55 * t.s;
      dummy.position.set(t.x + Math.cos(t.hue * 6) * off, y + h, t.z - Math.sin(t.hue * 6) * off);
      dummy.scale.set(t.s, t.s, t.s);
      tmp.copy(palmCol).lerp(leafB, t.hue * 0.5);
      push(out.palms, tmp);
    });

    const bushCol = new Color(PALETTE.bush);
    bushList.forEach((b) => {
      dummy.position.set(b.x, world.heightAt(b.x, b.z), b.z);
      dummy.rotation.set(0, b.r, 0);
      dummy.scale.set(b.s, b.s, b.s);
      tmp.copy(bushCol).lerp(leafC, b.hue * 0.6);
      push(out.bushes, tmp);
    });

    fernList.forEach((b) => {
      dummy.position.set(b.x, world.heightAt(b.x, b.z) - 0.05, b.z);
      dummy.rotation.set(0, b.r, 0);
      dummy.scale.set(b.s * 1.2, b.s, b.s * 1.2);
      tmp.copy(leafB).lerp(leafC, b.hue);
      push(out.ferns, tmp);
    });

    const rockCol = new Color(PALETTE.rock);
    const rockLight = new Color(PALETTE.cliff);
    const moss = new Color('#56693a');
    world.rocks.forEach((r) => {
      dummy.position.set(r.x, world.heightAt(r.x, r.z) + r.s * 0.05, r.z);
      dummy.rotation.set(r.hue * 0.6, r.r, 0);
      dummy.scale.set(r.s, r.s, r.s);
      tmp.copy(rockCol).lerp(rockLight, r.hue).lerp(moss, r.hue > 0.6 ? 0.35 : 0);
      push(out.rocks, tmp);
    });

    const gA = new Color('#4d7a34');
    const gB = new Color('#7f9c48');
    grassSpots.forEach((g) => {
      dummy.position.set(g.x, g.y - 0.02, g.z);
      dummy.rotation.set(0, g.r, 0);
      dummy.scale.set(g.s, g.s, g.s);
      tmp.copy(gA).lerp(gB, g.h);
      push(out.grass, tmp);
    });

    return out;
  }, [world, broad, palmTrees, bushList, fernList, grassSpots]);


  return (
    <>
      <Chunked geometry={geos.trunk} material={mats.trunk} items={inst.trunks} castShadow={shadows} />
      <Chunked geometry={geos.crown} material={mats.crown} items={inst.crowns} castShadow={shadows} />
      <Chunked geometry={geos.palmTrunk} material={mats.palmTrunk} items={inst.palmTrunks} castShadow={shadows} />
      <Chunked geometry={geos.palm} material={mats.palm} items={inst.palms} castShadow={shadows} />
      <Chunked geometry={geos.bush} material={mats.bush} items={inst.bushes} maxDist={70} />
      <Chunked geometry={geos.fern} material={mats.fern} items={inst.ferns} maxDist={55} />
      <Chunked geometry={geos.rock} material={mats.rock} items={inst.rocks} castShadow={shadows} receiveShadow={shadows} maxDist={90} />
      <Chunked geometry={geos.grass} material={mats.grass} items={inst.grass} maxDist={38} />
    </>
  );
}
