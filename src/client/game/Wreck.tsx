import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  LatheGeometry,
  MeshLambertMaterial,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  type Group,
  type PointLight,
  type Points,
} from 'three';
import { mergeStatic, playerPos } from './shared';
import { mulberry32, type World } from './world';

// A crashed single-engine high-wing bush plane (generic, unbranded).
// Local frame: nose points +X, up +Y, left wing +Z. Length ~8.4 m, span ~10 m.

const SMOKE_COUNT = 40;
const FUSE_LEN = 8.2;

export function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

// Fictional registration painted on the fuselage side.
function registrationTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = '#1d2530';
  g.font = 'bold 46px Arial, Helvetica, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('JR-207K', 10, 34);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// Fuselage: lathe profile from tail (y=0) to nose (y=FUSE_LEN), turned to lie along +X.
// Vertex colours paint the livery, belly, soot and dirt.
export function fuselageGeometry(seed: number) {
  const prof: [number, number][] = [
    [0.0, 0.0],
    [0.12, 0.05],
    [0.22, 0.5],
    [0.42, 2.2],
    [0.66, 3.8],
    [0.86, 4.9],
    [0.93, 5.6],
    [0.92, 6.5],
    [0.82, 7.2],
    [0.64, 7.7],
    [0.42, 8.05],
    [0.0, FUSE_LEN],
  ];
  const geo = new LatheGeometry(
    prof.map(([r, y]) => new Vector2(r, y)),
    18
  );
  geo.rotateZ(-Math.PI / 2); // lathe Y -> +X
  geo.translate(-FUSE_LEN / 2, 0, 0);
  // boxier, taller cabin cross-section; crumple the nose a little
  const p = geo.attributes.position!;
  const rng = mulberry32(seed);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    z *= 0.86;
    if (y > 0) y *= 1.08;
    if (y < -0.2) y = -0.2 + (y + 0.2) * 0.85; // flatter belly
    if (x > 3.0) {
      const k = (x - 3.0) / 1.1;
      y += (rng() - 0.5) * 0.12 * k;
      z += (rng() - 0.5) * 0.12 * k;
    }
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();

  const white = new Color('#e9e6dd');
  const stripe = new Color('#c2452d');
  const stripe2 = new Color('#e3a23b');
  const belly = new Color('#a9aca8');
  const soot = new Color('#2b2724');
  const c = new Color();
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    c.copy(white);
    const band = y - (x * 0.04 - 0.05); // stripe rises slightly toward the tail
    if (Math.abs(band) < 0.09) c.copy(stripe);
    else if (Math.abs(band + 0.15) < 0.035) c.copy(stripe2);
    if (y < -0.35) c.lerp(belly, 0.8);
    // engine soot and grime near the nose and along the belly
    const sootK = Math.max(0, (x - 2.6) / 1.5) * (0.6 + 0.4 * Math.sin(z * 9 + y * 7));
    c.lerp(soot, Math.min(0.85, sootK));
    c.multiplyScalar(0.9 + rng() * 0.1 - (y < 0 ? 0.08 : 0));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

// Thin airfoil extruded along +Z (span). chord along X (leading edge at +X).
export function airfoil(chord: number, thick: number, span: number) {
  const s = new Shape();
  s.moveTo(chord / 2, 0);
  s.bezierCurveTo(chord / 2, thick * 0.9, chord * 0.2, thick, -chord * 0.05, thick * 0.85);
  s.bezierCurveTo(-chord * 0.3, thick * 0.6, -chord / 2, thick * 0.12, -chord / 2, 0);
  s.bezierCurveTo(-chord * 0.2, -thick * 0.15, chord * 0.3, -thick * 0.3, chord / 2, 0);
  const g = new ExtrudeGeometry(s, { depth: span, bevelEnabled: false, curveSegments: 6 });
  return g;
}

export function finShape() {
  const s = new Shape();
  s.moveTo(0.55, 0);
  s.lineTo(-0.75, 0);
  s.lineTo(-0.95, 1.45);
  s.lineTo(-0.35, 1.5);
  s.lineTo(0.15, 0.45);
  s.lineTo(0.55, 0);
  const g = new ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  g.translate(0, 0, -0.035);
  return g;
}

export function propBlade() {
  const s = new Shape();
  s.moveTo(-0.07, 0);
  s.quadraticCurveTo(-0.11, 0.5, -0.05, 0.95);
  s.lineTo(0.04, 0.95);
  s.quadraticCurveTo(0.09, 0.45, 0.07, 0);
  s.lineTo(-0.07, 0);
  return new ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
}

export function Wreck({ world, shadows }: { world: World; shadows: boolean }) {
  const { x, z, yaw } = world.wreck;
  const y = world.heightAt(x, z);
  const fire = useRef<Group>(null);
  const fireLight = useRef<PointLight>(null);
  const smoke = useRef<Points>(null);
  const root = useRef<Group>(null);
  const cs = shadows;

  // the airframe and debris never move: merge them per material (about 36 draws down to ~10)
  useLayoutEffect(() => (root.current ? mergeStatic(root.current, { deep: true, exclude: [fire.current] }) : undefined), [x, y, z, yaw, cs]);

  const parts = useMemo(() => {
    const fuselage = fuselageGeometry(world.seed);
    const wingL = airfoil(1.55, 0.16, 4.9);
    const wingStub = airfoil(1.55, 0.16, 1.5);
    const wingTorn = airfoil(1.55, 0.16, 3.1);
    // bend the torn wing piece to look crumpled
    const tp = wingTorn.attributes.position!;
    for (let i = 0; i < tp.count; i++) {
      const zz = tp.getZ(i);
      tp.setY(i, tp.getY(i) + Math.max(0, zz - 1.6) * 0.18 + Math.sin(zz * 2.1) * 0.04);
    }
    wingTorn.computeVertexNormals();
    const stab = airfoil(0.85, 0.07, 3.3);
    stab.translate(0, 0, -1.65);
    return {
      fuselage,
      wingL,
      wingStub,
      wingTorn,
      stab,
      fin: finShape(),
      blade: propBlade(),
      strut: new CylinderGeometry(0.035, 0.035, 1, 6),
      tire: new TorusGeometry(0.22, 0.1, 8, 16),
      hub: new CylinderGeometry(0.11, 0.11, 0.16, 10),
    };
  }, [world.seed]);

  const mats = useMemo(
    () => ({
      hull: new MeshLambertMaterial({ vertexColors: true }),
      paint: new MeshLambertMaterial({ color: '#e2dfd5' }),
      stripe: new MeshLambertMaterial({ color: '#c2452d' }),
      metal: new MeshLambertMaterial({ color: '#6c7175' }),
      darkMetal: new MeshLambertMaterial({ color: '#2e3134' }),
      glass: new MeshLambertMaterial({
        color: '#1b2a33',
        transparent: true,
        opacity: 0.88,
      }),
      rubber: new MeshLambertMaterial({ color: '#1c1b1a' }),
      seat: new MeshLambertMaterial({ color: '#4a3b30' }),
      cargo: new MeshLambertMaterial({ color: '#6b5236' }),
      reg: new MeshLambertMaterial({ map: registrationTexture(), transparent: true, depthWrite: false, side: DoubleSide }),
    }),
    []
  );

  const smokeData = useMemo(() => {
    const geo = new BufferGeometry();
    const pos = new Float32Array(SMOKE_COUNT * 3);
    const life = new Float32Array(SMOKE_COUNT);
    for (let i = 0; i < SMOKE_COUNT; i++) life[i] = i / SMOKE_COUNT;
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    return { geo, life, tex: softDot() };
  }, []);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    if (fire.current) {
      fire.current.children.forEach((m, i) => {
        const f = 1 + Math.sin(t * (13 + i * 3.1) + i) * 0.18 + Math.sin(t * (7 + i)) * 0.1;
        m.scale.y = (i === 0 ? 1.3 : 0.9) * f;
        m.rotation.y = t * (1 + i * 0.4);
      });
    }
    if (fireLight.current) {
      // fade by intensity, never by `visible`: changing the number of lights in the scene
      // makes three.js recompile every lit material (a 70-400 ms hitch each time)
      const near = Math.hypot(playerPos.x - x, playerPos.z - z) < 35;
      fireLight.current.intensity = near ? 16 + Math.sin(t * 13) * 4 + Math.sin(t * 29) * 2 : 0;
    }
    if (smoke.current) {
      const pos = smokeData.geo.attributes.position!;
      for (let i = 0; i < SMOKE_COUNT; i++) {
        let l = smokeData.life[i]! + dt * 0.16;
        if (l > 1) l -= 1;
        smokeData.life[i] = l;
        const drift = l * l * 4.5;
        pos.setXYZ(i, Math.sin(i * 2.3 + t * 0.5) * 0.5 * l + drift, l * 12, Math.cos(i * 1.7) * 0.5 * l);
      }
      pos.needsUpdate = true;
    }
  });

  return (
    <group ref={root} position={[x, y, z]} rotation-y={yaw}>
      {/* the airframe: nose dug in, rolled onto the broken right wing */}
      <group position={[0, 0.78, 0]} rotation={[-0.14, 0, -0.07]}>
        <mesh geometry={parts.fuselage} material={mats.hull} castShadow={cs} receiveShadow={cs} />

        {/* registration on both sides */}
        <mesh position={[-1.9, 0.12, 0.71]} rotation-y={0.02} material={mats.reg}>
          <planeGeometry args={[1.6, 0.4]} />
        </mesh>
        <mesh position={[-1.9, 0.12, -0.71]} rotation-y={Math.PI - 0.02} material={mats.reg}>
          <planeGeometry args={[1.6, 0.4]} />
        </mesh>

        {/* windshield + side windows (one side cracked open) */}
        <mesh position={[2.55, 0.62, 0]} rotation-z={-0.75} material={mats.glass}>
          <boxGeometry args={[0.9, 0.03, 1.15]} />
        </mesh>
        <mesh position={[1.75, 0.38, 0.79]} rotation-x={0.06} material={mats.glass}>
          <boxGeometry args={[1.05, 0.42, 0.02]} />
        </mesh>
        <mesh position={[0.75, 0.38, 0.78]} rotation-x={0.06} material={mats.glass}>
          <boxGeometry args={[0.7, 0.38, 0.02]} />
        </mesh>
        <mesh position={[1.75, 0.38, -0.79]} rotation-x={-0.06} material={mats.glass}>
          <boxGeometry args={[1.05, 0.42, 0.02]} />
        </mesh>
        {/* cabin door torn open, hanging */}
        <group position={[1.2, 0.55, -0.8]} rotation={[-0.9, -0.5, 0.1]}>
          <mesh position={[0, -0.45, -0.02]} material={mats.paint} castShadow={cs}>
            <boxGeometry args={[1.0, 0.95, 0.05]} />
          </mesh>
          <mesh position={[0, -0.25, -0.05]} material={mats.glass}>
            <boxGeometry args={[0.8, 0.38, 0.02]} />
          </mesh>
        </group>

        {/* engine cowling, exhaust, crumpled spinner + bent prop */}
        <mesh position={[3.75, -0.42, 0.25]} rotation-z={Math.PI / 2} material={mats.darkMetal}>
          <cylinderGeometry args={[0.05, 0.05, 0.4, 6]} />
        </mesh>
        <group position={[4.18, -0.02, 0]} rotation-x={0.6}>
          <mesh rotation-z={-Math.PI / 2} material={mats.metal} castShadow={cs}>
            <coneGeometry args={[0.24, 0.42, 12]} />
          </mesh>
          <mesh geometry={parts.blade} material={mats.darkMetal} position={[0.05, 0.12, 0]} rotation={[0, Math.PI / 2, 0.35]} castShadow={cs} />
          <mesh geometry={parts.blade} material={mats.darkMetal} position={[0.05, -0.12, 0]} rotation={[0, Math.PI / 2, Math.PI - 0.7]} castShadow={cs} />
        </group>

        {/* high wing: intact left side with lift strut */}
        <group position={[1.65, 0.98, 0.25]} rotation-x={-0.03}>
          <mesh geometry={parts.wingL} material={mats.paint} castShadow={cs} receiveShadow={cs} />
          <mesh position={[0.1, 0.02, 4.85]} material={mats.stripe}>
            <boxGeometry args={[1.4, 0.13, 0.08]} />
          </mesh>
        </group>
        <mesh
          geometry={parts.strut}
          material={mats.metal}
          position={[1.62, 0.29, 1.85]}
          rotation-x={1.02}
          scale={[1, 2.7, 1]}
        />
        {/* right wing: torn stub + snapped strut */}
        <group position={[1.65, 0.98, -0.25]} rotation-x={-0.25} scale={[1, 1, -1]}>
          <mesh geometry={parts.wingStub} material={mats.paint} castShadow={cs} />
        </group>
        <mesh geometry={parts.strut} material={mats.metal} position={[1.62, -0.25, -0.95]} rotation-x={0.9} scale={[1, 1.2, 1]} />

        {/* tail: stabilizer, fin with stripe */}
        <mesh geometry={parts.stab} material={mats.paint} position={[-3.6, 0.12, 0]} castShadow={cs} />
        <mesh geometry={parts.fin} material={mats.stripe} position={[-3.45, 0.25, 0]} castShadow={cs} />

        {/* main gear: left leg intact with wheel, right collapsed */}
        <mesh geometry={parts.strut} material={mats.darkMetal} position={[1.4, -0.85, 0.48]} rotation-x={0.55} scale={[1.6, 0.8, 1.6]} />
        <group position={[1.4, -1.15, 0.75]}>
          <mesh geometry={parts.tire} material={mats.rubber} castShadow={cs} />
          <mesh geometry={parts.hub} material={mats.metal} rotation-x={Math.PI / 2} />
        </group>
        {/* tail wheel */}
        <mesh position={[-3.7, -0.2, 0]} rotation-y={Math.PI / 2} material={mats.rubber} scale={0.35}>
          <torusGeometry args={[0.22, 0.12, 6, 12]} />
        </mesh>

        {/* fire at the engine */}
        <group position={[3.4, 0.45, 0.25]}>
          <group ref={fire}>
            {(
              [
                [0, 0, 0, 1, '#ff6a1a'],
                [0.28, -0.1, 0.12, 0.7, '#ff8a2a'],
                [-0.25, -0.1, -0.1, 0.75, '#ff7a22'],
                [0.05, -0.15, -0.28, 0.6, '#ffb347'],
                [0, -0.2, 0, 0.55, '#ffe08a'],
              ] as const
            ).map(([fx, fy, fz, s, c], i) => (
              <mesh key={i} position={[fx, fy, fz]} scale={[s, s * 1.3, s]}>
                <coneGeometry args={[0.42, 1.5, 5]} />
                <meshBasicMaterial color={c} transparent opacity={0.85} blending={AdditiveBlending} depthWrite={false} fog={false} />
              </mesh>
            ))}
          </group>
          <pointLight ref={fireLight} color="#ff8a3a" distance={16} decay={1.6} position-y={0.8} />
          <points ref={smoke} geometry={smokeData.geo} position-y={0.9} frustumCulled={false}>
            <pointsMaterial map={smokeData.tex} color="#37322d" size={2.8} transparent opacity={0.42} depthWrite={false} />
          </points>
          <points geometry={smokeData.geo} position-y={0.3} scale={[0.25, 0.12, 0.25]} frustumCulled={false}>
            <pointsMaterial map={smokeData.tex} color="#ffb060" size={0.32} transparent blending={AdditiveBlending} depthWrite={false} />
          </points>
        </group>
      </group>

      {/* torn right wing lying in the grass */}
      <group position={[-0.8, 0.12, -6.2]} rotation={[0.04, 0.55, 0.12]}>
        <mesh geometry={parts.wingTorn} material={mats.paint} castShadow={cs} receiveShadow={cs} />
        <mesh position={[0.1, 0.06, 3.05]} material={mats.stripe}>
          <boxGeometry args={[1.4, 0.13, 0.08]} />
        </mesh>
      </group>
      {/* detached right wheel */}
      <group position={[3.2, 0.3, -3.4]} rotation={[0.3, 0.8, 1.3]}>
        <mesh geometry={parts.tire} material={mats.rubber} castShadow={cs} />
        <mesh geometry={parts.hub} material={mats.metal} rotation-x={Math.PI / 2} />
      </group>
      {/* thrown cabin contents: seat, luggage, cargo box, panel */}
      <mesh position={[0.6, 0.35, -2.6]} rotation={[0.2, 0.9, 1.2]} material={mats.seat} castShadow={cs}>
        <boxGeometry args={[0.5, 0.75, 0.5]} />
      </mesh>
      <mesh position={[-2.6, 0.2, -2.2]} rotation={[0, 0.4, 0.1]} material={mats.cargo} castShadow={cs}>
        <boxGeometry args={[0.7, 0.4, 0.45]} />
      </mesh>
      <mesh position={[4.8, 0.18, 1.6]} rotation={[0.1, 1.2, 0]} material={mats.stripe} castShadow={cs}>
        <boxGeometry args={[0.55, 0.35, 0.3]} />
      </mesh>
      <mesh position={[-4.6, 0.06, 1.8]} rotation={[0.05, 0.3, 0.12]} material={mats.paint} castShadow={cs}>
        <boxGeometry args={[1.1, 0.04, 0.6]} />
      </mesh>
      {/* gouge in the earth behind the plane */}
      <mesh position={[-6.2, 0.03, 0.2]} rotation-x={-Math.PI / 2} scale={[2.6, 0.75, 1]}>
        <circleGeometry args={[0.9, 10]} />
        <meshLambertMaterial color="#4a3b28" />
      </mesh>
    </group>
  );
}
