// Deterministic jungle world: terrain height, river, scatter and collision.
// Everything derives from the daily seed so all players share the same map today.

export const WORLD_HALF = 120; // map spans -120..120 on X and Z
export const WATER_LEVEL = -0.6;

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return smooth(t);
}

export type Tree = { x: number; z: number; s: number; kind: 0 | 1; hue: number };
export type Prop = { x: number; z: number; s: number; r: number; hue: number };

export type World = {
  seed: number;
  heightAt: (x: number, z: number) => number;
  riverX: (z: number) => number;
  river: { offset: number; phase: number };
  detail: (x: number, z: number) => number; // 0..1 color-variation noise
  wreck: { x: number; z: number; yaw: number };
  spawn: { x: number; z: number };
  trees: Tree[];
  bushes: Prop[];
  rocks: Prop[];
  collide: (x: number, z: number, r: number) => { x: number; z: number };
};

export function createWorld(seed: number): World {
  const rng = mulberry32(seed);

  // Value-noise lattice
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = rng();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]!;

  const lattice = (ix: number, iz: number) => vals[perm[(perm[ix & 255]! + iz) & 511]!]!;

  const noise = (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = smooth(x - ix);
    const fz = smooth(z - iz);
    const a = lattice(ix, iz);
    const b = lattice(ix + 1, iz);
    const c = lattice(ix, iz + 1);
    const d = lattice(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };

  const fbm = (x: number, z: number) =>
    noise(x, z) * 0.6 + noise(x * 2.1, z * 2.1) * 0.28 + noise(x * 4.3, z * 4.3) * 0.12;

  // River snakes north-south
  const rPhase = rng() * Math.PI * 2;
  const rOffset = (rng() - 0.5) * 30;
  const riverX = (z: number) => rOffset + Math.sin(z * 0.045 + rPhase) * 18 + Math.sin(z * 0.11) * 4;

  // Crash site: a clearing on one side of the river
  const side = rng() < 0.5 ? -1 : 1;
  const wz = (rng() - 0.5) * 110;
  const wx = riverX(wz) + side * (18 + rng() * 14);
  const wreck = { x: wx, z: wz, yaw: rng() * Math.PI * 2 };

  const baseHeight = (x: number, z: number) => {
    let h = (fbm(x * 0.035 + 100, z * 0.035 + 100) - 0.5) * 9;
    // mountains ring the map so the edge reads as a natural wall
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(WORLD_HALF - 22, WORLD_HALF, edge) * 22;
    return h;
  };

  const wreckBase = baseHeight(wx, wz);

  const heightAt = (x: number, z: number) => {
    let h = baseHeight(x, z);
    // carve river channel
    const d = Math.abs(x - riverX(z));
    const carve = 1 - smoothstep(3, 9, d);
    h = h * (1 - carve) + -1.8 * carve;
    // flatten the crash clearing
    const wd = Math.hypot(x - wx, z - wz);
    const flat = 1 - smoothstep(8, 16, wd);
    h = h * (1 - flat) + Math.max(wreckBase, 0.4) * flat;
    return h;
  };

  // Spawn near the wreck, toward the river (first hint: find water)
  const toRiver = Math.sign(riverX(wz) - wx) || 1;
  const spawn = { x: wx + toRiver * 6, z: wz + 3 };

  // Scatter with rejection on a coarse grid
  const cell = 4;
  const gridN = Math.ceil((WORLD_HALF * 2) / cell);
  const colliders: number[][] = Array.from({ length: gridN * gridN }, () => []);
  const colX: number[] = [];
  const colZ: number[] = [];
  const colR: number[] = [];
  const cellIndex = (x: number, z: number) => {
    const cx = Math.min(gridN - 1, Math.max(0, Math.floor((x + WORLD_HALF) / cell)));
    const cz = Math.min(gridN - 1, Math.max(0, Math.floor((z + WORLD_HALF) / cell)));
    return cz * gridN + cx;
  };
  const addCollider = (x: number, z: number, r: number) => {
    const id = colX.length;
    colX.push(x);
    colZ.push(z);
    colR.push(r);
    colliders[cellIndex(x, z)]!.push(id);
  };

  const blocked = (x: number, z: number, minGap: number) => {
    const cx = Math.floor((x + WORLD_HALF) / cell);
    const cz = Math.floor((z + WORLD_HALF) / cell);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= gridN || gz >= gridN) continue;
        for (const id of colliders[gz * gridN + gx]!) {
          if (Math.hypot(colX[id]! - x, colZ[id]! - z) < minGap) return true;
        }
      }
    return false;
  };

  const okGround = (x: number, z: number, clearing: number) => {
    if (Math.abs(x - riverX(z)) < 8) return false;
    if (Math.hypot(x - wx, z - wz) < clearing) return false;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 4) return false;
    return heightAt(x, z) > WATER_LEVEL + 0.4;
  };

  const trees: Tree[] = [];
  for (let i = 0; i < 9000 && trees.length < 1100; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 4);
    const z = (rng() * 2 - 1) * (WORLD_HALF - 4);
    if (!okGround(x, z, 15)) continue;
    // denser forest away from the river
    if (rng() > 0.35 + smoothstep(8, 26, Math.abs(x - riverX(z))) * 0.65) continue;
    if (blocked(x, z, 3.2)) continue;
    const kind: 0 | 1 = rng() < 0.3 ? 1 : 0;
    trees.push({ x, z, s: 0.8 + rng() * 0.7, kind, hue: rng() });
    addCollider(x, z, 0.45);
  }

  const rocks: Prop[] = [];
  for (let i = 0; i < 1800 && rocks.length < 190; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 4);
    const z = (rng() * 2 - 1) * (WORLD_HALF - 4);
    if (Math.hypot(x - wx, z - wz) < 10) continue;
    if (Math.abs(x - riverX(z)) < 3) continue;
    if (blocked(x, z, 2)) continue;
    const s = 0.4 + rng() * 1.2;
    rocks.push({ x, z, s, r: rng() * Math.PI * 2, hue: rng() });
    if (s > 0.8) addCollider(x, z, s * 0.8);
  }

  // bushes are decoration only (no collision) so the player can push through
  const bushes: Prop[] = [];
  for (let i = 0; i < 13000 && bushes.length < 1900; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 2);
    const z = (rng() * 2 - 1) * (WORLD_HALF - 2);
    if (!okGround(x, z, 9)) continue;
    bushes.push({ x, z, s: 0.5 + rng() * 0.9, r: rng() * Math.PI * 2, hue: rng() });
  }

  const collide = (x: number, z: number, r: number) => {
    let px = x;
    let pz = z;
    const cx = Math.floor((px + WORLD_HALF) / cell);
    const cz = Math.floor((pz + WORLD_HALF) / cell);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= gridN || gz >= gridN) continue;
        for (const id of colliders[gz * gridN + gx]!) {
          const ox = px - colX[id]!;
          const oz = pz - colZ[id]!;
          const min = r + colR[id]!;
          const d2 = ox * ox + oz * oz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            px = colX[id]! + (ox / d) * min;
            pz = colZ[id]! + (oz / d) * min;
          }
        }
      }
    // wreck fuselage as a long capsule-ish blocker (approximate with 3 circles)
    for (let k = -1; k <= 1; k++) {
      const fx = wx + Math.cos(wreck.yaw) * k * 3;
      const fz = wz - Math.sin(wreck.yaw) * k * 3;
      const ox = px - fx;
      const oz = pz - fz;
      const min = r + 1.4;
      const d2 = ox * ox + oz * oz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        px = fx + (ox / d) * min;
        pz = fz + (oz / d) * min;
      }
    }
    const lim = WORLD_HALF - 6;
    px = Math.max(-lim, Math.min(lim, px));
    pz = Math.max(-lim, Math.min(lim, pz));
    return { x: px, z: pz };
  };

  const detail = (x: number, z: number) => fbm(x * 0.09 + 300, z * 0.09 + 300);
  const river = { offset: rOffset, phase: rPhase };
  return { seed, heightAt, riverX, river, detail, wreck, spawn, trees, bushes, rocks, collide };
}
