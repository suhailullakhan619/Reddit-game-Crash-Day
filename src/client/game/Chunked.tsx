import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Fog, InstancedMesh, Matrix4, type BufferGeometry, type Material } from 'three';
import { playerPos } from './shared';
import { run } from './state';
import { WORLD_HALF } from './world';

// Instances split into a grid of chunks. Each chunk is its own InstancedMesh with a tight
// bounding sphere, so three.js frustum-culls chunks behind the camera, and chunks past
// the fog (or the per-type view distance) are hidden. Only chunks near the player cast
// shadows, so the small shadow frustum is not filled with whole far-away chunks.

export type Inst = { m: Matrix4; c?: Color };

// 240 m / 6 = 40 m chunks: small enough to cull well, few enough to keep draw calls low.
const GRID = 6;
// fog ends at 105 m during play; nothing past it is visible
const FOG_FAR = 105;
// the aerial crash cinematic pushes fog out (up to 250 m); used when the scene has no fog
const AERIAL_DIST = 260;
// shadow camera covers +-22 m around the player
const SHADOW_DIST = 26;

// During the cinematic the view distance follows the live fog distance, and each type keeps
// its play-time share of it: grass that hides at 38 m in play hides at ~95 m from the air,
// instead of drawing every grass/fern/bush chunk of the island out to 260 m.
export function introLimit(maxDist: number, fogFar: number | null): number {
  const far = fogFar === null ? AERIAL_DIST : fogFar + 10;
  return Math.max(FOG_FAR, far) * (Math.min(maxDist, FOG_FAR) / FOG_FAR);
}

type Chunk = { list: Inst[]; cx: number; cz: number; radius: number };

export function Chunked({
  geometry,
  material,
  items,
  castShadow = false,
  receiveShadow = false,
  maxDist = FOG_FAR,
}: {
  geometry: BufferGeometry;
  material: Material;
  items: Inst[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  maxDist?: number;
}) {
  const chunks = useMemo(() => {
    const size = (WORLD_HALF * 2) / GRID;
    const buckets: Inst[][] = Array.from({ length: GRID * GRID }, () => []);
    for (const it of items) {
      const x = it.m.elements[12]!;
      const z = it.m.elements[14]!;
      const cx = Math.min(GRID - 1, Math.max(0, Math.floor((x + WORLD_HALF) / size)));
      const cz = Math.min(GRID - 1, Math.max(0, Math.floor((z + WORLD_HALF) / size)));
      buckets[cz * GRID + cx]!.push(it);
    }
    const out: Chunk[] = [];
    buckets.forEach((list, i) => {
      if (list.length === 0) return;
      out.push({
        list,
        cx: -WORLD_HALF + ((i % GRID) + 0.5) * size,
        cz: -WORLD_HALF + (Math.floor(i / GRID) + 0.5) * size,
        radius: size * 0.75,
      });
    });
    return out;
  }, [items]);

  const refs = useRef<(InstancedMesh | null)[]>([]);

  useLayoutEffect(() => {
    chunks.forEach((ch, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      ch.list.forEach((it, j) => {
        mesh.setMatrixAt(j, it.m);
        if (it.c) mesh.setColorAt(j, it.c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      // use the real bounds (includes tree height) for the distance tests
      const bs = mesh.boundingSphere;
      if (bs) {
        ch.cx = bs.center.x;
        ch.cz = bs.center.z;
        ch.radius = bs.radius;
      }
    });
  }, [chunks]);

  // hide whole chunks that sit beyond the view distance; cast shadows only near the player
  useFrame(({ camera, scene }) => {
    const px = camera.position.x;
    const pz = camera.position.z;
    const fog = scene.fog;
    const limit =
      run.phase === 'intro' ? introLimit(maxDist, fog instanceof Fog ? fog.far : null) : Math.min(maxDist, FOG_FAR);
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i]!;
      const mesh = refs.current[i];
      if (!mesh) continue;
      mesh.visible = Math.hypot(ch.cx - px, ch.cz - pz) - ch.radius < limit;
      if (castShadow) {
        mesh.castShadow = mesh.visible && Math.hypot(ch.cx - playerPos.x, ch.cz - playerPos.z) - ch.radius < SHADOW_DIST;
      }
    }
  });

  return (
    <>
      {chunks.map((ch, i) => (
        <instancedMesh
          key={i}
          ref={(el) => void (refs.current[i] = el)}
          args={[geometry, material, ch.list.length]}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      ))}
    </>
  );
}
