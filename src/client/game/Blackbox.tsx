import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import { sfxPickup } from './audio';
import { playerPos } from './shared';
import { run } from './state';
import type { World } from './world';

// "Black box" challenge: the orange flight recorder, half-buried, with a blinking beacon
// that chirps faster as you get closer. Picked up through the normal interact button.
export function Blackbox({ world }: { world: World }) {
  const root = useRef<Group>(null);
  const beacon = useRef<Mesh>(null);
  const chirp = useRef(0);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const b = run.blackbox;
    const g = root.current;
    if (!g) return;
    g.visible = !!b && !b.taken && run.phase !== 'intro';
    if (!b || b.taken) return;
    g.position.set(b.x, world.heightAt(b.x, b.z), b.z);
    const t = state.clock.elapsedTime;
    if (beacon.current) beacon.current.visible = t % 1 < 0.25;
    // beeps within 25 m, faster when closer
    const d = Math.hypot(b.x - playerPos.x, b.z - playerPos.z);
    if (run.phase === 'play' && d < 25) {
      chirp.current -= dt;
      if (chirp.current <= 0) {
        sfxPickup();
        chirp.current = 0.4 + (d / 25) * 1.6;
      }
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh position={[0, 0.18, 0]} rotation={[0.25, 0.6, 0.1]}>
        <boxGeometry args={[0.55, 0.34, 0.4]} />
        <meshLambertMaterial color="#f07a1a" />
      </mesh>
      <mesh position={[0, 0.2, 0]} rotation={[0.25, 0.6, 0.1]}>
        <boxGeometry args={[0.57, 0.06, 0.42]} />
        <meshLambertMaterial color="#202326" />
      </mesh>
      <mesh ref={beacon} position={[0.05, 0.42, 0]}>
        <sphereGeometry args={[0.07, 8, 6]} />
        <meshBasicMaterial color="#ff3b2f" toneMapped={false} fog={false} />
      </mesh>
    </group>
  );
}
