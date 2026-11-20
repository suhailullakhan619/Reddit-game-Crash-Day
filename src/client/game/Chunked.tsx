import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, Matrix4, type BufferGeometry, type Material } from 'three';
import { WORLD_HALF } from './world';

// Instances split into a grid of chunks. Each chunk is its own InstancedMesh with a tight
// bounding sphere, so three.js frustum-culls chunks behind the camera, and chunks past
// the fog are hidden. Big win on a large map at the cost of a few extra draw calls.

export type Inst = { m: Matrix4; c?: Color };

const GRID = 3;

export function Chunked({
  geometry,
  material,
  items,
  castShadow = false,
  receiveShadow = false,
  maxDist = 115,
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
    return buckets
      .map((list, i) => ({
        list,
        cx: -WORLD_HALF + ((i % GRID) + 0.5) * size,
        cz: -WORLD_HALF + (Math.floor(i / GRID) + 0.5) * size,
        radius: size * 0.75,
      }))
      .filter((b) => b.list.length > 0);
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
    });
  }, [chunks]);

  // hide whole chunks that sit beyond the fog
  useFrame(({ camera }) => {
    const px = camera.position.x;
    const pz = camera.position.z;
    chunks.forEach((ch, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      mesh.visible = Math.hypot(ch.cx - px, ch.cz - pz) - ch.radius < maxDist;
    });
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
