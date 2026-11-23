import { run } from './state';

// Player-built lean-to: two forked posts, a ridge pole and a sloped roof of palm thatch,
// open toward where the player stood when building it.
function Shelter({ x, y, z, rot }: { x: number; y: number; z: number; rot: number }) {
  return (
    <group position={[x, y, z]} rotation-y={rot}>
      {[-0.95, 0.95].map((sx) => (
        <mesh key={sx} position={[sx, 0.75, -0.55]} castShadow>
          <cylinderGeometry args={[0.06, 0.07, 1.5, 6]} />
          <meshLambertMaterial color="#5b4330" />
        </mesh>
      ))}
      <mesh position={[0, 1.48, -0.55]} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2.3, 6]} />
        <meshLambertMaterial color="#5b4330" />
      </mesh>
      {/* roof slopes from the ridge down to the ground behind */}
      <mesh position={[0, 0.78, 0.25]} rotation-x={-0.98} castShadow receiveShadow>
        <boxGeometry args={[2.3, 1.9, 0.08]} />
        <meshLambertMaterial color="#4f7f3a" />
      </mesh>
      {[-0.7, -0.23, 0.23, 0.7].map((sx, i) => (
        <mesh key={sx} position={[sx, 0.82, 0.18]} rotation={[-0.98, 0, i % 2 ? 0.08 : -0.08]}>
          <boxGeometry args={[0.42, 2.0, 0.04]} />
          <meshLambertMaterial color={i % 2 ? '#6f9a40' : '#3f7a3a'} />
        </mesh>
      ))}
      {/* bedding */}
      <mesh position={[0, 0.04, -0.05]} receiveShadow>
        <boxGeometry args={[1.6, 0.08, 0.9]} />
        <meshLambertMaterial color="#8f7a52" />
      </mesh>
    </group>
  );
}

export function Shelters({ version }: { version: number }) {
  void version; // re-render when one is built
  return (
    <>
      {run.shelters.map((h, i) => (
        <Shelter key={i} x={h.x} y={h.y} z={h.z} rot={h.rot} />
      ))}
    </>
  );
}
