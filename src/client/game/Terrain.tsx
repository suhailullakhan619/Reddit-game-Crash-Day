import { useMemo } from 'react';
import { BufferAttribute, Color, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import { useFrame } from '@react-three/fiber';
import { atmo, fxTime } from './fx';
import { PALETTE } from './shared';
import { WATER_LEVEL, WORLD_HALF, type World } from './world';

const SEGMENTS = 200;

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
    return geo;
  }, [world]);

  return (
    <>
      <mesh geometry={geometry} receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
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

  useFrame(() => {
    const u = mat.uniforms;
    u.uTime!.value = fxTime.value;
    u.uSky!.value.copy(atmo.horizon);
    u.uSunDir!.value = atmo.sunDir;
    u.uSunColor!.value.copy(atmo.sunColor);
    u.uNight!.value = atmo.night;
  });

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={WATER_LEVEL} material={mat} renderOrder={1}>
      <planeGeometry args={[WORLD_HALF * 2, WORLD_HALF * 2]} />
    </mesh>
  );
}
