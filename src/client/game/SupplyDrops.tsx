import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, type Group } from 'three';
import { sfxThud, startEngine } from './audio';
import { gameClock, playerPos } from './shared';
import { emit, run, toast } from './state';
import { WATER_LEVEL, WORLD_HALF, type World } from './world';

// Supply drops: at midday on days 2 and 4 a crate parachutes into the jungle 35-60 m from
// the player. It lands with red smoke, shows on the map, and holds med kit, water, food and
// arrows. Worth the walk, but the animals get bolder every day.

const DROP_DAYS = [2, 4];
const DROP_PHASE = 0.45; // fraction of the day (0 dawn .. 1 next dawn)
const START_H = 60;
const FALL = 5.5; // m/s under canopy
const MAX = 2;

function dayPhase() {
  const t = gameClock.startPhase + gameClock.elapsed / gameClock.dayLength;
  return t - Math.floor(t);
}

function pickSpot(world: World) {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 35 + Math.random() * 25;
    const x = playerPos.x + Math.cos(a) * r;
    const z = playerPos.z + Math.sin(a) * r;
    if (Math.abs(x) > WORLD_HALF - 12 || Math.abs(z) > WORLD_HALF - 12) continue;
    const h = world.heightAt(x, z);
    if (h < WATER_LEVEL + 0.4 || h > 9) continue;
    const res = world.collide(x, z, 1.2);
    if (Math.hypot(res.x - x, res.z - z) > 0.05) continue; // not inside a tree
    return { x, z, ground: h };
  }
  return null;
}

function Crate({ index }: { index: number }) {
  const root = useRef<Group>(null);
  const chute = useRef<Group>(null);
  const smoke = useRef<Group>(null);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const d = run.drops[index];
    const g = root.current;
    if (!g) return;
    if (!d || run.phase === 'intro') {
      g.visible = false;
      return;
    }
    g.visible = true;
    if (!d.landed) {
      d.y = Math.max(d.ground, d.y - FALL * dt);
      if (d.y <= d.ground) {
        d.landed = true;
        sfxThud();
        emit();
      }
    }
    const t = state.clock.elapsedTime;
    g.position.set(d.x, d.y, d.z);
    // swing under the canopy while falling
    g.rotation.z = d.landed ? 0 : Math.sin(t * 1.3 + index) * 0.12;
    g.rotation.x = d.landed ? 0 : Math.cos(t * 1.1 + index) * 0.08;
    if (chute.current) {
      chute.current.visible = !d.landed;
    }
    const sm = smoke.current;
    if (sm) {
      sm.visible = d.landed && !d.opened;
      const n = sm.children.length;
      sm.children.forEach((p, i) => {
        // looping column of red signal smoke
        const k = (t * 0.35 + i / n) % 1;
        p.position.set(Math.sin(i * 2.3 + t * 0.4) * 0.3 * k + k * 1.2, 0.6 + k * 9, Math.cos(i * 1.7) * 0.3 * k);
        p.scale.setScalar(0.4 + k * 1.6);
      });
    }
  });

  return (
    <group ref={root} visible={false}>
      {/* wooden crate with metal bands */}
      <mesh position-y={0.42} castShadow>
        <boxGeometry args={[0.95, 0.8, 0.95]} />
        <meshLambertMaterial color="#8a6a44" />
      </mesh>
      {[-0.3, 0.3].map((x) => (
        <mesh key={x} position={[x, 0.42, 0]}>
          <boxGeometry args={[0.08, 0.84, 0.99]} />
          <meshLambertMaterial color="#4a4f55" />
        </mesh>
      ))}
      <mesh position={[0, 0.83, 0]}>
        <boxGeometry args={[0.4, 0.02, 0.4]} />
        <meshLambertMaterial color="#d93a2b" />
      </mesh>
      {/* parachute: canopy + four lines */}
      <group ref={chute}>
        <mesh position-y={5.4} scale={[1, 0.45, 1]}>
          <sphereGeometry args={[2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshLambertMaterial color="#e2632b" side={DoubleSide} />
        </mesh>
        <mesh position-y={5.42} scale={[1.01, 0.46, 1.01]}>
          <sphereGeometry args={[2.4, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshLambertMaterial color="#ebe7dc" wireframe />
        </mesh>
        {(
          [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ] as const
        ).map(([sx, sz]) => (
          <mesh key={`${sx}${sz}`} position={[sx * 1.0, 3.1, sz * 1.0]} rotation={[sz * -0.38, 0, sx * 0.38]}>
            <cylinderGeometry args={[0.01, 0.01, 4.9, 3]} />
            <meshBasicMaterial color="#d8d2c3" />
          </mesh>
        ))}
      </group>
      <group ref={smoke} visible={false}>
        {Array.from({ length: 10 }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.5, 10, 7]} />
            <meshLambertMaterial color="#d9584a" transparent opacity={0.3} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function SupplyDrops({ world }: { world: World }) {
  const engine = useRef<ReturnType<typeof startEngine>>(null);
  const engineT = useRef(0);

  useEffect(
    () => () => {
      engine.current?.stop();
      engine.current = null;
    },
    []
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    // fade the supply plane's drone out after a few seconds
    if (engine.current) {
      engineT.current += dt;
      engine.current.set?.(Math.max(0, 0.6 - engineT.current * 0.12));
      if (engineT.current > 5) {
        engine.current.stop();
        engine.current = null;
      }
    }
    if (run.phase !== 'play') return;
    const day = run.day;
    if (!DROP_DAYS.includes(day) || run.dropDays.includes(day) || dayPhase() < DROP_PHASE) return;
    run.dropDays.push(day);
    const spot = pickSpot(world);
    if (!spot) return;
    run.drops.push({ ...spot, y: spot.ground + START_H, landed: false, opened: false });
    engine.current?.stop();
    engine.current = startEngine();
    engineT.current = 0;
    toast('A supply plane drops a crate! Follow the red smoke — it is on your map.');
    emit();
  });

  return (
    <>
      {Array.from({ length: MAX }, (_, i) => (
        <Crate key={i} index={i} />
      ))}
    </>
  );
}
