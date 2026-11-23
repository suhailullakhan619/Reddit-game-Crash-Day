import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Quaternion, Vector3, type Group } from 'three';
import { creatures, run, type CreatureKind } from './state';
import type { World } from './world';

// Bow projectiles: a small pool of arrow meshes flown with simple ballistics.
// An arrow hits the first live animal it passes through, sticks in the ground or a tree,
// and fades out a few seconds later.

const POOL = 8;
const GRAVITY = 6;
const ARROW_DMG = 1; // tiger has 3 hp, boar 2, gator 3, any hit kills a snake
const HIT_R: Record<CreatureKind, number> = { tiger: 1.25, boar: 0.95, gator: 1.3, snake: 0.75 };

type Shot = { x: number; y: number; z: number; vx: number; vy: number; vz: number; flying: boolean; life: number };

const shots: Shot[] = Array.from({ length: POOL }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, flying: false, life: 0 }));
let next = 0;

export const ARROW_SPEED = 36;
export const ARROW_GRAVITY = GRAVITY;

export function fireArrow(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
  const s = shots[next];
  next = (next + 1) % POOL;
  if (!s) return;
  s.x = x;
  s.y = y;
  s.z = z;
  s.vx = vx;
  s.vy = vy;
  s.vz = vz;
  s.flying = true;
  s.life = 5;
}

export function clearArrows() {
  for (const s of shots) s.life = 0;
}

const FWD = new Vector3(0, 0, 1);
const dir = new Vector3();
const q = new Quaternion();

export function Arrows({ world }: { world: World }) {
  const refs = useRef<(Group | null)[]>([]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    shots.forEach((s, i) => {
      const g = refs.current[i];
      if (!g) return;
      if (s.life <= 0 || run.phase === 'intro') {
        g.visible = false;
        return;
      }
      s.life -= dt;
      if (s.flying) {
        // two sub-steps so a fast arrow cannot skip through a boar
        for (let k = 0; k < 2 && s.flying; k++) {
          const h = dt / 2;
          s.vy -= GRAVITY * h;
          s.x += s.vx * h;
          s.y += s.vy * h;
          s.z += s.vz * h;
          for (const c of creatures) {
            if (!c.alive) continue;
            const ground = world.heightAt(c.x, c.z);
            if (s.y < ground - 0.6 || s.y > ground + 2.2) continue;
            if (Math.hypot(s.x - c.x, s.z - c.z) < HIT_R[c.kind]) {
              c.pendingHit += ARROW_DMG;
              s.flying = false;
              s.life = 0; // arrow stays in the animal: just remove it
              break;
            }
          }
          if (!s.flying) break;
          const ground = world.heightAt(s.x, s.z);
          const res = world.collide(s.x, s.z, 0.05);
          if (s.y <= ground + 0.05 || Math.hypot(res.x - s.x, res.z - s.z) > 0.01) {
            s.y = Math.max(s.y, ground + 0.05);
            s.flying = false;
            s.life = Math.min(s.life, 4);
          }
        }
        dir.set(s.vx, s.vy, s.vz).normalize();
        q.setFromUnitVectors(FWD, dir);
        g.quaternion.copy(q);
      }
      g.visible = s.life > 0;
      g.position.set(s.x, s.y, s.z);
    });
  });

  return (
    <>
      {shots.map((_, i) => (
        <group
          key={i}
          visible={false}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          {/* shaft along +z, tip at the front */}
          <mesh rotation-x={Math.PI / 2} position-z={-0.3}>
            <cylinderGeometry args={[0.014, 0.014, 0.75, 5]} />
            <meshLambertMaterial color="#8a6a44" />
          </mesh>
          <mesh rotation-x={Math.PI / 2} position-z={0.1}>
            <coneGeometry args={[0.035, 0.12, 4]} />
            <meshLambertMaterial color="#6f6b60" />
          </mesh>
          <mesh position-z={-0.62}>
            <boxGeometry args={[0.005, 0.07, 0.14]} />
            <meshLambertMaterial color="#d8d2c3" />
          </mesh>
          <mesh position-z={-0.62}>
            <boxGeometry args={[0.07, 0.005, 0.14]} />
            <meshLambertMaterial color="#d8d2c3" />
          </mesh>
        </group>
      ))}
    </>
  );
}
