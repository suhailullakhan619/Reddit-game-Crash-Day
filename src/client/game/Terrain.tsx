import { useMemo, useRef, type RefObject } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  MeshLambertMaterial,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type Mesh,
} from 'three';
import { useFrame } from '@react-three/fiber';
import { atmo, fxTime } from './fx';
import { PALETTE } from './shared';
import { run } from './state';
import { WATER_LEVEL, WORLD_HALF, type World } from './world';

const SEGMENTS = 160;
// The terrain is split into TILES x TILES sub-meshes (copied from the one full grid, so
// normals and colors match across seams). Each tile frustum-culls on its own and tiles past
// the fog are hidden, instead of drawing the whole 240 m map every frame.
const TILES = 4;
// water tiles are smaller; only tiles that actually hold water are built
const WATER_TILES = 8;
const FOG_FAR = 105;
const AERIAL_DIST = 260;

// Copy one rectangular block of grid vertices out of the full plane into its own geometry.
function extractTile(full: BufferGeometry, tx: number, tz: number) {
  const seg = SEGMENTS / TILES;
  const row = SEGMENTS + 1;
  const n = seg + 1;
  const out = new BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const src = full.getAttribute(name);
    if (!src) continue;
    const size = src.itemSize;
    const arr = new Float32Array(n * n * size);
    for (let iy = 0; iy < n; iy++)
      for (let ix = 0; ix < n; ix++) {
        const si = (tz * seg + iy) * row + (tx * seg + ix);
        const di = iy * n + ix;
        for (let c = 0; c < size; c++) arr[di * size + c] = src.getComponent(si, c);
      }
    out.setAttribute(name, new BufferAttribute(arr, size));
  }
  // same winding as PlaneGeometry
  const idx: number[] = [];
  for (let iy = 0; iy < seg; iy++)
    for (let ix = 0; ix < seg; ix++) {
      const a = ix + n * iy;
      const b = ix + n * (iy + 1);
      const c = ix + 1 + n * (iy + 1);
      const d = ix + 1 + n * iy;
      idx.push(a, b, d, b, c, d);
    }
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

type Tile = { geo: BufferGeometry; cx: number; cz: number; radius: number };

function toTile(geo: BufferGeometry, cx: number, cz: number, radius: number): Tile {
  const bs = geo.boundingSphere;
  return bs ? { geo, cx: bs.center.x, cz: bs.center.z, radius: bs.radius } : { geo, cx, cz, radius };
}

// Hide tiles beyond the view distance (the aerial intro sees much further).
function useDistanceHide(tiles: Tile[], refs: RefObject<(Mesh | null)[]>) {
  useFrame(({ camera, scene }) => {
    // the cinematic follows the live fog distance (it closes in during the dive)
    const fog = scene.fog;
    const limit = run.phase === 'intro' ? (fog instanceof Fog ? Math.max(FOG_FAR, fog.far + 10) : AERIAL_DIST) : FOG_FAR;
    const px = camera.position.x;
    const pz = camera.position.z;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]!;
      const m = refs.current[i];
      if (m) m.visible = Math.hypot(t.cx - px, t.cz - pz) - t.radius < limit;
    }
  });
}

export function Terrain({ world }: { world: World }) {
  const geometry = useMemo(() => {
    const geo = new PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) pos.setY(i, world.heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();

    // canopy density grid for fake ambient occlusion under the forest
    const cell = 2;
    const n = Math.ceil((WORLD_HALF * 2) / cell);
    const density = new Float32Array(n * n);
    for (const t of world.trees) {
      const cx = Math.floor((t.x + WORLD_HALF) / cell);
      const cz = Math.floor((t.z + WORLD_HALF) / cell);
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const gx = cx + dx;
          const gz = cz + dz;
          if (gx < 0 || gz < 0 || gx >= n || gz >= n) continue;
          const w = 1 - Math.hypot(dx, dz) / 3;
          if (w > 0) density[gz * n + gx]! += w;
        }
    }

    const nrm = geo.attributes.normal!;
    const colors = new Float32Array(pos.count * 3);
    const grassDark = new Color(PALETTE.grassDark);
    const grass = new Color(PALETTE.grass);
    const grassLight = new Color(PALETTE.grassLight);
    const forestFloor = new Color('#3b4a26');
    const mud = new Color(PALETTE.mud);
    const sand = new Color(PALETTE.sand);
    const rock = new Color(PALETTE.rock);
    const cliff = new Color(PALETTE.cliff);
    const c = new Color();
    const tmp = new Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const slope = 1 - nrm.getY(i);
      const riverDist = Math.abs(x - world.riverX(z));
      const d = world.detail(x, z);

      c.copy(grassDark).lerp(grass, Math.min(1, d * 1.4)).lerp(grassLight, Math.max(0, d - 0.55) * 1.6);
      const gx = Math.min(n - 1, Math.max(0, Math.floor((x + WORLD_HALF) / cell)));
      const gz = Math.min(n - 1, Math.max(0, Math.floor((z + WORLD_HALF) / cell)));
      const dens = Math.min(1, density[gz * n + gx]! / 3);
      c.lerp(forestFloor, dens * 0.55);

      if (slope > 0.25) c.lerp(tmp.copy(rock).lerp(cliff, d), Math.min(1, (slope - 0.25) * 5));
      if (y > 8) c.lerp(cliff, Math.min(1, (y - 8) / 5));
      if (riverDist < 9) c.lerp(sand, Math.max(0, 1 - (riverDist - 5) / 4) * 0.8);
      if (y < WATER_LEVEL + 0.6) c.lerp(mud, Math.min(1, (WATER_LEVEL + 0.6 - y) / 0.8));

      // darken under canopy so the forest reads as shaded
      c.multiplyScalar(1 - dens * 0.32);

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));

    const tiles: Tile[] = [];
    const size = (WORLD_HALF * 2) / TILES;
    for (let tz = 0; tz < TILES; tz++)
      for (let tx = 0; tx < TILES; tx++) {
        const t = extractTile(geo, tx, tz);
        tiles.push(toTile(t, -WORLD_HALF + (tx + 0.5) * size, -WORLD_HALF + (tz + 0.5) * size, size * 0.75));
      }
    geo.dispose();
    return tiles;
  }, [world]);

  const material = useMemo(() => new MeshLambertMaterial({ vertexColors: true }), []);
  const refs = useRef<(Mesh | null)[]>([]);
  useDistanceHide(geometry, refs);

  return (
    <>
      {geometry.map((t, i) => (
        <mesh key={i} ref={(el) => void (refs.current[i] = el)} geometry={t.geo} material={material} receiveShadow />
      ))}
      <Water world={world} />
    </>
  );
}

const WATER_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  uniform float uROffset;
  uniform float uRPhase;
  varying vec3 vWorld;

  float riverX(float z) {
    return uROffset + sin(z * 0.045 + uRPhase) * 18.0 + sin(z * 0.11) * 4.0;
  }

  void main() {
    vec2 p = vWorld.xz;
    // flowing ripples along the river (current runs +z)
    float t = uTime;
    vec2 g = vec2(
      cos(p.x * 1.3 + t * 1.1) * 0.5 + cos(p.x * 2.7 - p.y * 0.8 + t * 1.7) * 0.3 + cos((p.x + p.y) * 4.1 + t * 2.3) * 0.2,
      cos(p.y * 1.1 - t * 1.9) * 0.5 + cos(p.y * 2.3 + p.x * 0.9 - t * 2.4) * 0.3 + cos((p.y - p.x) * 3.7 - t * 2.9) * 0.2
    );
    vec3 n = normalize(vec3(g.x * 0.12, 1.0, g.y * 0.12));
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);

    float d = abs(p.x - riverX(p.y));
    float depth = smoothstep(2.0, 6.0, 6.5 - d); // 0 at banks, 1 mid-channel
    vec3 base = mix(uShallow, uDeep, depth);
    vec3 col = mix(base, uSky, 0.08 + fres * 0.35);
    col *= mix(1.0, 0.32, uNight);

    vec3 h = normalize(normalize(uSunDir) + v);
    float spec = pow(max(dot(n, h), 0.0), 120.0);
    col += uSunColor * spec * (1.4 - uNight);

    // bank foam
    float foam = smoothstep(0.35, 0.0, abs(d - 5.6 + g.x * 0.35)) * 0.55;
    col = mix(col, vec3(0.86, 0.88, 0.82), foam * (1.0 - uNight * 0.7));

    gl_FragColor = vec4(col, 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function Water({ world }: { world: World }) {
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: WATER_VERT,
        fragmentShader: WATER_FRAG,
        transparent: true,
        fog: true,
        depthWrite: false,
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uTime: { value: 0 },
            uDeep: { value: new Color('#1d4f52') },
            uShallow: { value: new Color('#5d8a6c') },
            uSky: { value: new Color() },
            uSunDir: { value: atmo.sunDir },
            uSunColor: { value: new Color() },
            uNight: { value: 0 },
            uROffset: { value: world.river.offset },
            uRPhase: { value: world.river.phase },
          },
        ]),
      }),
    [world]
  );

  // one plane per WATER_TILES cell, built only where the terrain dips below the water line
  const tiles = useMemo(() => {
    const size = (WORLD_HALF * 2) / WATER_TILES;
    const out: Tile[] = [];
    for (let tz = 0; tz < WATER_TILES; tz++)
      for (let tx = 0; tx < WATER_TILES; tx++) {
        const x0 = -WORLD_HALF + tx * size;
        const z0 = -WORLD_HALF + tz * size;
        let wet = false;
        for (let z = z0; z <= z0 + size && !wet; z += 1.5)
          for (let x = x0; x <= x0 + size && !wet; x += 1.5) if (world.heightAt(x, z) < WATER_LEVEL + 0.05) wet = true;
        if (!wet) continue;
        const g = new PlaneGeometry(size, size);
        g.rotateX(-Math.PI / 2);
        g.translate(x0 + size / 2, WATER_LEVEL, z0 + size / 2);
        g.computeBoundingSphere();
        out.push(toTile(g, x0 + size / 2, z0 + size / 2, size * 0.75));
      }
    return out;
  }, [world]);
  const refs = useRef<(Mesh | null)[]>([]);
  useDistanceHide(tiles, refs);

  useFrame(() => {
    const u = mat.uniforms;
    u.uTime!.value = fxTime.value;
    u.uSky!.value.copy(atmo.horizon);
    u.uSunDir!.value = atmo.sunDir;
    u.uSunColor!.value.copy(atmo.sunColor);
    u.uNight!.value = atmo.night;
  });

  return (
    <>
      {tiles.map((t, i) => (
        <mesh key={i} ref={(el) => void (refs.current[i] = el)} geometry={t.geo} material={mat} renderOrder={1} />
      ))}
    </>
  );
}
