import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Group, type PointLight } from 'three';
import { run } from './state';

// Player-built campfires: ring of stones, crossed logs, flickering flame + light.
// Only the 2 newest fires get a real light to keep mobile GPUs happy.
function Campfire({ x, y, z, lit }: { x: number; y: number; z: number; lit: boolean }) {
  const flames = useRef<Group>(null);
  const light = useRef<PointLight>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime + x;
    flames.current?.children.forEach((m, i) => {
      m.scale.y = 0.8 + Math.sin(t * (11 + i * 3) + i) * 0.22;
      m.rotation.y = t * (1.2 + i * 0.5);
    });
    if (light.current) light.current.intensity = 9 + Math.sin(t * 14) * 2 + Math.sin(t * 31) * 1;
  });

  return (
    <group position={[x, y, z]}>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55]} rotation={[i, i * 2, 0]}>
            <dodecahedronGeometry args={[0.13, 0]} />
            <meshLambertMaterial color="#7d7a70" />
          </mesh>
        );
      })}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position-y={0.12} rotation={[0.25, (i / 3) * Math.PI, 0]}>
          <cylinderGeometry args={[0.06, 0.07, 0.9, 6]} />
          <meshLambertMaterial color="#4a3322" />
        </mesh>
      ))}
      <group ref={flames} position-y={0.3}>
        {(
          [
            [0, 0.6, '#ff6a1a'],
            [0.1, 0.45, '#ff9a2e'],
            [-0.08, 0.4, '#ffd06b'],
          ] as const
        ).map(([dx, s, c], i) => (
          <mesh key={i} position-x={dx} scale={[s, s * 1.4, s]}>
            <coneGeometry args={[0.35, 1, 5]} />
            <meshBasicMaterial color={c} transparent opacity={0.85} blending={AdditiveBlending} depthWrite={false} fog={false} />
          </mesh>
        ))}
      </group>
      {lit && <pointLight ref={light} color="#ff9045" distance={13} decay={1.6} position-y={1} />}
    </group>
  );
}

export function Campfires({ version }: { version: number }) {
  void version; // re-render when a fire is added
  const fires = run.campfires;
  return (
    <>
      {fires.map((f, i) => (
        <Campfire key={i} x={f.x} y={f.y} z={f.z} lit={i >= fires.length - 2} />
      ))}
    </>
  );
}
