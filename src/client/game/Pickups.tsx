import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  type Mesh,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pickup } from './loot';
import type { ItemKind } from './state';

const dummy = new Object3D();
const hidden = new Matrix4().makeScale(0, 0, 0);

function strip(g: BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  return n;
}

function colored(g: BufferGeometry, hex: string) {
  const n = strip(g);
  const c = new Color(hex);
  const cols = new Float32Array(n.attributes.position!.count * 3);
  for (let i = 0; i < cols.length; i += 3) {
    cols[i] = c.r;
    cols[i + 1] = c.g;
    cols[i + 2] = c.b;
  }
  n.setAttribute('color', new BufferAttribute(cols, 3));
  return n;
}

function buildGeometries(): Record<ItemKind, BufferGeometry> {
  // bundle of three branches
  const sticks: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new CylinderGeometry(0.05, 0.065, 1.3, 5);
    s.rotateZ(Math.PI / 2);
    s.rotateY(i * 0.5 - 0.5);
    s.translate(0, 0.07 + i * 0.07, (i - 1) * 0.1);
    sticks.push(colored(s, i === 1 ? '#7a5a3a' : '#5e4129'));
  }
  const wood = mergeGeometries(sticks)!;

  const stoneA = new DodecahedronGeometry(0.2, 0);
  stoneA.scale(1.2, 0.7, 1);
  stoneA.translate(0, 0.12, 0);
  const stoneB = new DodecahedronGeometry(0.14, 0);
  stoneB.translate(0.22, 0.08, 0.1);
  const stone = mergeGeometries([colored(stoneA, '#8a877c'), colored(stoneB, '#9c9688')])!;

  // berry bush: green mound + red berries
  const bushBody = new IcosahedronGeometry(0.55, 0);
  bushBody.scale(1, 0.7, 1);
  bushBody.translate(0, 0.32, 0);
  const berryParts: BufferGeometry[] = [colored(bushBody, '#3f6e33')];
  for (let i = 0; i < 9; i++) {
    const b = new SphereGeometry(0.07, 6, 4);
    const a = (i / 9) * Math.PI * 2;
    b.translate(Math.cos(a) * 0.45, 0.3 + (i % 3) * 0.12, Math.sin(a) * 0.45);
    berryParts.push(colored(b, i % 2 ? '#c2223a' : '#9c1630'));
  }
  const berries = mergeGeometries(berryParts)!;

  // plastic water bottle lying on its side
  const body = new CylinderGeometry(0.08, 0.08, 0.34, 10);
  const neck = new CylinderGeometry(0.035, 0.07, 0.08, 10);
  neck.translate(0, 0.21, 0);
  const cap = new CylinderGeometry(0.035, 0.035, 0.04, 8);
  cap.translate(0, 0.27, 0);
  const label = new CylinderGeometry(0.083, 0.083, 0.12, 10, 1, true);
  const bottleParts = [colored(body, '#9fd2e6'), colored(neck, '#9fd2e6'), colored(cap, '#2f6fb0'), colored(label, '#e6eef2')];
  const water = mergeGeometries(bottleParts)!;
  water.rotateZ(Math.PI / 2);
  water.translate(0, 0.08, 0);

  // herb: small leafy plant with purple flowers
  const herbParts: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const leaf = new ConeGeometry(0.06, 0.45, 4);
    leaf.rotateZ((i - 2) * 0.3);
    leaf.rotateY(i * 1.3);
    leaf.translate(0, 0.22, 0);
    herbParts.push(colored(leaf, '#4f8a3a'));
    const flower = new SphereGeometry(0.05, 5, 4);
    flower.translate(Math.sin(i * 1.3) * 0.12, 0.45 + (i % 2) * 0.06, Math.cos(i * 1.3) * 0.12);
    herbParts.push(colored(flower, '#a46ad6'));
  }
  const herb = mergeGeometries(herbParts)!;

  // med kit: red case with white cross
  const box = new BoxGeometry(0.42, 0.2, 0.3);
  box.translate(0, 0.1, 0);
  const crossA = new BoxGeometry(0.16, 0.012, 0.05);
  crossA.translate(0, 0.206, 0);
  const crossB = new BoxGeometry(0.05, 0.012, 0.16);
  crossB.translate(0, 0.206, 0);
  const handle = new BoxGeometry(0.16, 0.04, 0.03);
  handle.translate(0, 0.22, -0.11);
  const medkit = mergeGeometries([colored(box, '#c8362f'), colored(crossA, '#f4f1ea'), colored(crossB, '#f4f1ea'), colored(handle, '#2a2a2a')])!;

  const flareBody = new CylinderGeometry(0.04, 0.04, 0.3, 8);
  flareBody.rotateZ(Math.PI / 2);
  flareBody.translate(0, 0.05, 0);
  const flare = colored(flareBody, '#e0522a');

  const meatBody = new SphereGeometry(0.16, 8, 6);
  meatBody.scale(1.4, 0.7, 1);
  meatBody.translate(0, 0.1, 0);
  const meat = colored(meatBody, '#9a3b30');

  for (const g of [wood, stone, berries, water, herb, medkit, flare, meat]) g.computeVertexNormals();
  return { wood, stone, berries, water, herb, medkit, flare, meat };
}

const KINDS: ItemKind[] = ['wood', 'stone', 'berries', 'water', 'herb', 'medkit', 'flare', 'meat'];

export function Pickups({ pickups, version }: { pickups: Pickup[]; version: number }) {
  const geos = useMemo(buildGeometries, []);
  const mat = useMemo(() => new MeshLambertMaterial({ vertexColors: true }), []);
  const refs = useRef<Partial<Record<ItemKind, InstancedMesh | null>>>({});
  const marker = useRef<Mesh>(null);

  const byKind = useMemo(() => {
    const m: Record<ItemKind, Pickup[]> = { wood: [], stone: [], berries: [], water: [], herb: [], medkit: [], flare: [], meat: [] };
    for (const p of pickups) m[p.kind].push(p);
    return m;
  }, [pickups]);

  // re-apply matrices whenever something is collected (version bumps)
  useLayoutEffect(() => {
    for (const kind of KINDS) {
      const mesh = refs.current[kind];
      if (!mesh) continue;
      byKind[kind].forEach((p, i) => {
        if (p.taken) {
          mesh.setMatrixAt(i, hidden);
          return;
        }
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.r, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [byKind, version]);

  // pulsing ring under the nearest item the player can pick up
  useFrame((state) => {
    const m = marker.current;
    if (!m) return;
    const target = nearestRef.current;
    m.visible = !!target;
    if (target) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 5) * 0.08;
      m.position.set(target.x, target.y + 0.15, target.z);
      m.scale.set(s, s, s);
    }
  });

  return (
    <>
      {KINDS.map((kind) =>
        byKind[kind].length ? (
          <instancedMesh
            key={kind}
            ref={(el) => void (refs.current[kind] = el)}
            args={[geos[kind], mat, byKind[kind].length]}
          />
        ) : null
      )}
      <mesh ref={marker} rotation-x={-Math.PI / 2} visible={false} renderOrder={2}>
        <ringGeometry args={[0.55, 0.68, 28]} />
        <meshBasicMaterial color="#ffe7a8" transparent opacity={0.85} depthWrite={false} depthTest={false} />
      </mesh>
    </>
  );
}

// Player writes the current target here; the marker reads it.
export const nearestRef: { current: Pickup | null } = { current: null };
