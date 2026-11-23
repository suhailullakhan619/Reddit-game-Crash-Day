import type { ItemKind } from './state';
import { mulberry32, WATER_LEVEL, WORLD_HALF, type World } from './world';

export type Pickup = { id: number; kind: ItemKind; x: number; y: number; z: number; r: number; taken: boolean; amount: number };

export const PICKUP_RADIUS = 1.9;

// Seeded loot layout: the same for every player today.
export function createPickups(world: World, generous: boolean): Pickup[] {
  const rng = mulberry32(world.seed ^ 0x5bd1e995);
  const out: Pickup[] = [];
  const add = (kind: ItemKind, x: number, z: number, amount = 1) => {
    out.push({ id: out.length, kind, x, z, y: world.heightAt(x, z), r: rng() * Math.PI * 2, taken: false, amount });
  };

  const okLand = (x: number, z: number) => {
    const h = world.heightAt(x, z);
    return h > WATER_LEVEL + 0.25 && h < 9 && Math.abs(x) < WORLD_HALF - 8 && Math.abs(z) < WORLD_HALF - 8;
  };

  const scatter = (kind: ItemKind, count: number, accept: (x: number, z: number) => boolean, amount = 1) => {
    let placed = 0;
    for (let i = 0; i < count * 40 && placed < count; i++) {
      const x = (rng() * 2 - 1) * (WORLD_HALF - 10);
      const z = (rng() * 2 - 1) * (WORLD_HALF - 10);
      if (!okLand(x, z) || !accept(x, z)) continue;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 2.5)) continue;
      add(kind, x, z, amount);
      placed++;
    }
  };

  const riverDist = (x: number, z: number) => Math.abs(x - world.riverX(z));
  const wreckDist = (x: number, z: number) => Math.hypot(x - world.wreck.x, z - world.wreck.z);
  const nearTree = (x: number, z: number) => world.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.5);

  // Crash debris: guaranteed starter loot around the wreck
  const ring = (kind: ItemKind, n: number, r0: number, r1: number, amount = 1) => {
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const a = rng() * Math.PI * 2;
        const r = r0 + rng() * (r1 - r0);
        const x = world.wreck.x + Math.cos(a) * r;
        const z = world.wreck.z + Math.sin(a) * r;
        if (!okLand(x, z) || out.some((p) => Math.hypot(p.x - x, p.z - z) < 1.6)) continue;
        add(kind, x, z, amount);
        break;
      }
    }
  };

  ring('water', generous ? 3 : 2, 5, 9);
  ring('medkit', 1, 6, 10);
  ring('wood', 2, 6, 11, 2); // broken crates = planks
  if (generous) ring('berries', 2, 7, 12, 2);

  scatter('wood', 90, (x, z) => nearTree(x, z) || rng() < 0.15);
  scatter('stone', 70, (x, z) => riverDist(x, z) < 12 || rng() < 0.3);
  scatter('berries', 46, (x, z) => riverDist(x, z) > 7 && wreckDist(x, z) > 12, 2);
  scatter('herb', 32, (x, z) => nearTree(x, z) && riverDist(x, z) > 9);
  scatter('water', 9, (x, z) => wreckDist(x, z) < 70);
  scatter('medkit', 2, (x, z) => wreckDist(x, z) > 35);
  return out;
}
