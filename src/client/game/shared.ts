import {
  BufferAttribute,
  FrontSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type Color,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Live game state shared across components without React re-renders.
export const playerPos = new Vector3();
import type { Camera } from 'three';

// The gameplay camera, set by Player each frame; DOM overlays use it to project positions.
export const view: { camera: Camera | null } = { camera: null };

export const gameClock = { elapsed: 0, dayLength: 60, startPhase: 0.22 };

// Color palette. One unified set used everywhere.
export const PALETTE = {
  grassDark: '#355f33',
  grass: '#4f7f3a',
  grassLight: '#78964a',
  mud: '#8f7a52',
  sand: '#b8a274',
  rock: '#6f6b60',
  cliff: '#837f6c',
  water: '#2c6c6a',
  trunk: '#5b4330',
  leafA: '#2e5b33',
  leafB: '#3f7a3a',
  leafC: '#5f8f3c',
  palm: '#6f9a40',
  bush: '#3a6b35',
  shirt: '#e07a3c',
  pants: '#34465a',
  skin: '#c99a72',
  pack: '#6d5a3a',
  hull: '#d8d2c3',
  stripe: '#b5432f',
  metal: '#8b8f93',
};

export type Quality = 'low' | 'medium' | 'high';

export const QUALITY: Record<Quality, { dpr: number; shadows: boolean; shadowMap: number; aa: boolean; density: number }> = {
  low: { dpr: 1, shadows: false, shadowMap: 512, aa: false, density: 0.35 },
  medium: { dpr: 1.25, shadows: true, shadowMap: 1024, aa: false, density: 0.6 },
  high: { dpr: 1.75, shadows: true, shadowMap: 2048, aa: true, density: 1 },
};

// ---------------------------------------------------------------------------------------
// Near-camera fade for foliage: fragments closer than ~3 m to the camera dissolve with a
// screen-space dither, so the follow camera can stay at a fixed distance in dense jungle
// without the view filling with leaves (and without zooming in and out to avoid them).
export function nearFade(m: MeshLambertMaterial) {
  // chains onto an existing hook (e.g. addWind) instead of replacing it
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      {
        float camD = length(vViewPosition);
        if (camD < 3.4) {
          float keep = clamp((camD - 1.4) / 2.0, 0.0, 1.0);
          float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
          if (n > keep) discard;
        }
      }`
    );
  };
  m.customProgramCacheKey = () => `${prevKey()}|near-fade`;
  return m;
}

// ---------------------------------------------------------------------------------------
// Static mesh merging: cuts draw calls on characters and props built from many small meshes.
// Meshes are grouped per container (direct children of each group, or the whole subtree in
// `deep` mode) and merged per material. Plain-colour Lambert meshes are baked into vertex
// colours and share one material, so a limb with skin + cuff + boot becomes one draw.
// The originals stay in the scene graph (hidden), so React can still mount/unmount them;
// the returned cleanup restores them.

// shared by every merged prop; dissolves near the lens like foliage (camera never sits inside the wreck)
const flatMaterial = nearFade(new MeshLambertMaterial({ vertexColors: true }));
const mergeInv = new Matrix4();
const mergeTmp = new Matrix4();

function isFlat(m: Material): m is MeshLambertMaterial {
  return (
    m instanceof MeshLambertMaterial &&
    !m.map &&
    !m.vertexColors &&
    !m.transparent &&
    m.opacity === 1 &&
    m.side === FrontSide &&
    !m.flatShading &&
    !m.alphaMap &&
    !m.emissiveMap &&
    m.emissive.getHex() === 0
  );
}

function hasMap(m: Material) {
  return (m instanceof MeshLambertMaterial || m instanceof MeshBasicMaterial) && m.map !== null;
}

function mergeable(o: Object3D): o is Mesh {
  if (!(o instanceof Mesh) || o instanceof SkinnedMesh || o instanceof InstancedMesh) return false;
  if (!o.visible || o.userData.noMerge === true || o.name === 'merged') return false;
  const m: unknown = o.material;
  if (!(m instanceof MeshLambertMaterial || m instanceof MeshBasicMaterial)) return false;
  const g: BufferGeometry = o.geometry;
  if (!g.getAttribute('position') || Object.keys(g.morphAttributes).length > 0) return false;
  if (m.map && !g.getAttribute('uv')) return false;
  if (m.vertexColors && !g.getAttribute('color')) return false;
  return true;
}

function flipWinding(g: BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name);
    if (!(a instanceof BufferAttribute)) continue;
    const s = a.itemSize;
    for (let t = 0; t + 2 < a.count; t += 3)
      for (let c = 0; c < s; c++) {
        const v1 = a.getComponent(t + 1, c);
        a.setComponent(t + 1, c, a.getComponent(t + 2, c));
        a.setComponent(t + 2, c, v1);
      }
  }
}

function prepGeometry(src: BufferGeometry, m: Matrix4, keep: string[], color: Color | null) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  g.clearGroups();
  g.applyMatrix4(m);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
  if (m.determinant() < 0) flipWinding(g);
  if (color) {
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new BufferAttribute(arr, 3));
  }
  return g;
}

type Bucket = { material: Material; flat: boolean; geos: BufferGeometry[]; meshes: Mesh[]; cast: boolean; recv: boolean };

export function mergeStatic(root: Object3D, opts: { deep?: boolean; exclude?: (Object3D | null)[] } = {}): () => void {
  const deep = opts.deep ?? false;
  const exclude = new Set<Object3D>();
  for (const e of opts.exclude ?? []) if (e) exclude.add(e);
  const isExcluded = (o: Object3D) => {
    for (let p: Object3D | null = o; p && p !== root.parent; p = p.parent) if (exclude.has(p)) return true;
    return false;
  };

  const containers: Object3D[] = [];
  if (deep) containers.push(root);
  else root.traverse((o) => void (!(o instanceof Mesh) && !isExcluded(o) && containers.push(o)));

  if (deep) {
    root.updateWorldMatrix(true, true);
    mergeInv.copy(root.matrixWorld).invert();
  }

  const added: Mesh[] = [];
  const hidden: Mesh[] = [];

  for (const container of containers) {
    const buckets = new Map<string, Bucket>();
    const list: Mesh[] = [];
    if (deep) container.traverse((o) => void (mergeable(o) && !isExcluded(o) && list.push(o)));
    else for (const o of container.children) if (mergeable(o) && !isExcluded(o)) list.push(o);

    for (const mesh of list) {
      const mat: unknown = mesh.material;
      if (!(mat instanceof MeshLambertMaterial || mat instanceof MeshBasicMaterial)) continue;
      const flat = isFlat(mat);
      const key = flat ? 'flat' : mat.uuid;
      let b = buckets.get(key);
      if (!b) {
        b = { material: flat ? flatMaterial : mat, flat, geos: [], meshes: [], cast: false, recv: false };
        buckets.set(key, b);
      }
      b.meshes.push(mesh);
      b.cast ||= mesh.castShadow;
      b.recv ||= mesh.receiveShadow;
    }

    for (const b of buckets.values()) {
      if (b.meshes.length < 2) continue;
      const keep = ['position', 'normal'];
      if (!b.flat && hasMap(b.material)) keep.push('uv');
      if (!b.flat && b.material.vertexColors) keep.push('color');
      for (const mesh of b.meshes) {
        let m: Matrix4;
        if (deep) {
          mesh.updateWorldMatrix(true, false);
          m = mergeTmp.multiplyMatrices(mergeInv, mesh.matrixWorld);
        } else {
          mesh.updateMatrix();
          m = mesh.matrix;
        }
        const mat: unknown = mesh.material;
        const color = b.flat && mat instanceof MeshLambertMaterial ? mat.color : null;
        b.geos.push(prepGeometry(mesh.geometry, m, keep, color));
      }
      const merged = mergeGeometries(b.geos);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      const out = new Mesh(merged, b.material);
      out.name = 'merged';
      out.castShadow = b.cast;
      out.receiveShadow = b.recv;
      container.add(out);
      added.push(out);
      for (const mesh of b.meshes) {
        mesh.visible = false;
        hidden.push(mesh);
      }
    }
  }

  return () => {
    for (const m of added) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    for (const m of hidden) m.visible = true;
  };
}
