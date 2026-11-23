import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { sfxGrowl, sfxHit, sfxHowl } from './audio';
import { hard } from './difficulty';
import { atmo } from './fx';
import { playerPos } from './shared';
import { combat, createCreature, creatureSlot, damage, emit, run, toast } from './state';
import { WATER_LEVEL, type World } from './world';

// Night wolf pack (from day 3). Three grey wolves with glowing eyes come out of the dark,
// circle the player and take turns lunging. Fire keeps them back: stand near a lit campfire
// (or the burning wreck) and they only circle. At dawn they slink away.

const PACK = 3;
type Mode = 'away' | 'approach' | 'circle' | 'windup' | 'lunge' | 'retreat' | 'flee' | 'dead';

// shared pack brain: one attacker at a time, with a cooldown between lunges
const pack = { attacker: -1, cd: 0, active: false, warnedFire: false };

function fireSafe(world: World) {
  if (Math.hypot(playerPos.x - world.wreck.x, playerPos.z - world.wreck.z) < 7) return true;
  return run.campfires.some((f) => !f.out && Math.hypot(f.x - playerPos.x, f.z - playerPos.z) < 5);
}

function Wolf({ world, index }: { world: World; index: number }) {
  const root = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);
  const head = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const ai = useRef({ mode: 'away' as Mode, x: 0, z: 0, y: 0, heading: 0, speed: 0, t: 0, hp: 1.5, ang: index * 2.1, gait: 0, dx: 0, dz: 0, hit: false });
  const me = useMemo(() => createCreature('wolf', 0, 0), []);
  useEffect(creatureSlot(me), [me]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const a = ai.current;
    const g = root.current;
    if (!g) return;
    const playing = run.phase === 'play';
    const night = atmo.night > 0.55 && run.day >= 3;
    a.t += dt;
    const setMode = (m: Mode) => {
      a.mode = m;
      a.t = 0;
      me.windup = m === 'windup';
      me.vulnerable = m === 'retreat' ? 1.5 : 1;
    };

    // spawn at nightfall, leave at dawn
    if (a.mode === 'away') {
      me.alive = false;
      me.danger = 0;
      g.visible = false;
      if (playing && night) {
        const ang = index * 2.1 + Math.random() * 0.8;
        a.x = playerPos.x + Math.cos(ang) * 34;
        a.z = playerPos.z + Math.sin(ang) * 34;
        a.y = world.heightAt(a.x, a.z);
        a.hp = 1.5;
        setMode('approach');
        if (index === 0) {
          sfxHowl();
          sfxHowl(0.9);
          toast('Wolves are howling nearby. Stay close to a fire!');
        }
      }
      return;
    }
    if (a.mode !== 'dead' && a.mode !== 'flee' && (!night || !playing)) setMode('flee');

    const dx = playerPos.x - a.x;
    const dz = playerPos.z - a.z;
    const dist = Math.hypot(dx, dz);
    const safe = fireSafe(world);

    if (me.pendingHit > 0 && a.mode !== 'dead') {
      a.hp -= me.pendingHit * me.vulnerable;
      me.pendingHit = 0;
      sfxHit();
      if (pack.attacker === index) pack.attacker = -1;
      if (a.hp <= 0) {
        setMode('dead');
        run.kills.wolf++;
        toast('Wolf down.');
        emit();
      } else setMode('retreat');
    }

    let targetSpeed = 0;
    let face = a.heading;
    switch (a.mode) {
      case 'approach': {
        face = Math.atan2(dx, dz);
        targetSpeed = 6.5 * hard.speed();
        if (dist < 15) setMode('circle');
        break;
      }
      case 'circle': {
        const r = (safe ? 13 : 10.5) + index * 1.2;
        a.ang += dt * (0.45 + index * 0.08);
        const tx = playerPos.x + Math.cos(a.ang) * r;
        const tz = playerPos.z + Math.sin(a.ang) * r;
        face = Math.atan2(tx - a.x, tz - a.z);
        targetSpeed = Math.min(5.5, Math.hypot(tx - a.x, tz - a.z) * 1.5);
        if (safe && !pack.warnedFire && dist < 16) {
          pack.warnedFire = true;
          toast('The wolves won’t come near the fire.');
        }
        if (playing && !safe && pack.attacker === -1 && pack.cd <= 0 && dist < 14) {
          pack.attacker = index;
          sfxGrowl(0.7);
          setMode('windup');
        }
        break;
      }
      case 'windup': {
        face = Math.atan2(dx, dz);
        if (safe) {
          pack.attacker = -1;
          setMode('circle');
        } else if (a.t > 0.7 * hard.windup()) {
          const l = dist || 1;
          a.dx = dx / l;
          a.dz = dz / l;
          a.hit = false;
          setMode('lunge');
        }
        break;
      }
      case 'lunge': {
        face = Math.atan2(a.dx, a.dz);
        targetSpeed = 12 * hard.speed();
        if (!a.hit && dist < 1.25 && combat.invuln <= 0 && playing) {
          a.hit = true;
          damage(12 * hard.dmg(), 'wolf');
          combat.knockX = a.dx * 4;
          combat.knockZ = a.dz * 4;
        }
        if (a.t > 0.9) setMode('retreat');
        break;
      }
      case 'retreat': {
        face = Math.atan2(-dx, -dz);
        targetSpeed = 6;
        if (a.t > 1.8) {
          if (pack.attacker === index) {
            pack.attacker = -1;
            pack.cd = 1.4 + Math.random() * 1.6;
          }
          setMode('circle');
        }
        break;
      }
      case 'flee': {
        face = Math.atan2(-dx, -dz);
        targetSpeed = 7;
        if (a.t > 6) setMode('away');
        break;
      }
      case 'dead':
        break;
    }
    if (index === 0) pack.cd = Math.max(0, pack.cd - dt);

    if (a.mode !== 'dead') {
      let d = face - a.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a.heading = a.mode === 'lunge' ? face : a.heading + d * Math.min(1, dt * 6);
      a.speed += (targetSpeed - a.speed) * Math.min(1, dt * (a.mode === 'lunge' ? 10 : 4));
      const nx = a.x + Math.sin(a.heading) * a.speed * dt;
      const nz = a.z + Math.cos(a.heading) * a.speed * dt;
      if (world.heightAt(nx, nz) > WATER_LEVEL + 0.15) {
        const res = world.collide(nx, nz, 0.4);
        a.x = res.x;
        a.z = res.z;
      }
      a.y += (world.heightAt(a.x, a.z) - a.y) * Math.min(1, dt * 10);
    }
    me.x = a.x;
    me.z = a.z;
    me.alive = a.mode !== 'dead' && a.mode !== 'flee';
    me.danger = !playing || a.mode === 'dead' || a.mode === 'flee' ? 0 : a.mode === 'windup' || a.mode === 'lunge' ? 1 : Math.max(0, 0.6 - dist / 30);

    // --- pose ---
    g.visible = a.mode !== 'dead' || a.t < 20;
    g.position.set(a.x, a.y, a.z);
    g.rotation.y = a.heading;
    g.rotation.z = a.mode === 'dead' ? Math.min(Math.PI / 2, a.t * 4) : 0;
    a.gait += dt * (a.speed * 2.4 + 0.5);
    const swing = Math.min(1, a.speed / 5) * 0.75;
    legs.current.forEach((l, i) => {
      if (l) l.rotation.x = Math.sin(a.gait + (i === 0 || i === 3 ? 0 : Math.PI)) * swing;
    });
    if (head.current) head.current.rotation.x = a.mode === 'windup' ? 0.35 : Math.sin(state.clock.elapsedTime * 2 + index) * 0.05;
    if (tail.current) tail.current.rotation.y = Math.sin(state.clock.elapsedTime * 5 + index) * 0.25;
  });

  const fur = '#5f5a52';
  const dark = '#3e3a35';
  const belly = '#8a8378';
  return (
    <group ref={root} visible={false} scale={1.1}>
      {/* body */}
      <mesh position={[0, 0.62, -0.05]} rotation-x={Math.PI / 2}>
        <capsuleGeometry args={[0.2, 0.62, 4, 10]} />
        <meshLambertMaterial color={fur} />
      </mesh>
      <mesh position={[0, 0.66, 0.28]} scale={[1, 1.08, 1.15]}>
        <sphereGeometry args={[0.25, 12, 10]} />
        <meshLambertMaterial color={fur} />
      </mesh>
      <mesh position={[0, 0.5, 0.05]} scale={[0.85, 0.5, 1.6]}>
        <sphereGeometry args={[0.2, 10, 8]} />
        <meshLambertMaterial color={belly} />
      </mesh>
      {/* head */}
      <group ref={head} position={[0, 0.84, 0.52]}>
        <mesh scale={[1, 0.95, 1.1]}>
          <sphereGeometry args={[0.16, 12, 10]} />
          <meshLambertMaterial color={fur} />
        </mesh>
        <mesh position={[0, -0.04, 0.2]} rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.08, 0.26, 8]} />
          <meshLambertMaterial color={dark} />
        </mesh>
        <mesh position={[0, -0.03, 0.33]}>
          <sphereGeometry args={[0.03, 6, 5]} />
          <meshBasicMaterial color="#111" />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[s * 0.08, 0.16, -0.02]} rotation-z={s * -0.2}>
              <coneGeometry args={[0.05, 0.14, 4]} />
              <meshLambertMaterial color={dark} />
            </mesh>
            {/* eyes glow in the dark */}
            <mesh position={[s * 0.065, 0.04, 0.12]}>
              <sphereGeometry args={[0.024, 6, 5]} />
              <meshBasicMaterial color="#ffd24a" toneMapped={false} fog={false} />
            </mesh>
          </group>
        ))}
      </group>
      {/* legs: front-left, front-right, back-left, back-right */}
      {(
        [
          [0.11, 0.3],
          [-0.11, 0.3],
          [0.11, -0.36],
          [-0.11, -0.36],
        ] as const
      ).map(([x, z], i) => (
        <group
          key={i}
          position={[x, 0.56, z]}
          ref={(el) => {
            legs.current[i] = el;
          }}
        >
          <mesh position-y={-0.27}>
            <cylinderGeometry args={[0.045, 0.035, 0.56, 6]} />
            <meshLambertMaterial color={dark} />
          </mesh>
        </group>
      ))}
      {/* tail */}
      <group ref={tail} position={[0, 0.66, -0.46]}>
        <mesh position={[0, -0.12, -0.18]} rotation-x={-0.7}>
          <capsuleGeometry args={[0.06, 0.36, 3, 6]} />
          <meshLambertMaterial color={fur} />
        </mesh>
      </group>
    </group>
  );
}

export function Wolves({ world }: { world: World }) {
  useEffect(() => {
    pack.attacker = -1;
    pack.cd = 0;
    pack.warnedFire = false;
  }, []);
  return (
    <>
      {Array.from({ length: PACK }, (_, i) => (
        <Wolf key={i} world={world} index={i} />
      ))}
    </>
  );
}
