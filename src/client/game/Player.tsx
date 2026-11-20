import { useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { sfxDrink, sfxPickup, sfxSwing } from './audio';
import { input } from './input';
import { PICKUP_RADIUS, type Pickup } from './loot';
import { nearestRef } from './Pickups';
import { gameClock, playerPos } from './shared';
import {
  actions,
  addItem,
  combat,
  creatures,
  damage,
  debugReq,
  emit,
  getVersion,
  ITEM_LABEL,
  RESCUE_DAY,
  rescue,
  run,
  subscribe,
  toast,
} from './state';
import { Survivor, type SurvivorHandle, type Weapon } from './Survivor';
import { tickSurvival } from './survival';
import { WATER_LEVEL, type World } from './world';

const WALK = 4.2;
const SPRINT = 6.8;
const CAM_DIST = 6.5;
const RADIUS = 0.4;
const DODGE_TIME = 0.38;
const DODGE_SPEED = 12;
const ATTACK_TIME = 0.45;

function dampAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function Player({ world, shadows, pickups }: { world: World; shadows: boolean; pickups: Pickup[] }) {
  const root = useRef<Group>(null);
  const rig = useRef<SurvivorHandle>(null);
  const camera = useThree((s) => s.camera);
  useSyncExternalStore(subscribe, getVersion);
  const weapon: Weapon = run.spear ? 'spear' : run.knife ? 'knife' : 'none';

  // look toward the wreck at start
  const initYaw = Math.atan2(world.spawn.x - world.wreck.x, world.spawn.z - world.wreck.z);
  const state = useRef({
    x: world.spawn.x,
    z: world.spawn.z,
    y: world.heightAt(world.spawn.x, world.spawn.z),
    facing: initYaw + Math.PI,
    yaw: initYaw,
    pitch: 0.42,
    walk: 0,
    speed: 0,
    camInit: false,
    time: 0,
    dodge: 0, // time left in roll
    dodgeCd: 0,
    dodgeX: 0,
    dodgeZ: 0,
    attack: 0, // time left in swing
    attackCd: 0,
    struck: false,
    wasDrinking: false,
    shake: 0,
  });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = state.current;

    if (run.phase === 'intro') {
      // hidden while the crash cinematic owns the camera; reset camera follow for the hand-off
      if (root.current) root.current.visible = false;
      s.camInit = false;
      actions.interact = actions.attack = actions.dodge = false;
      return;
    }
    if (root.current) root.current.visible = true;
    if (debugReq.player) {
      s.x = debugReq.player.x;
      s.z = debugReq.player.z;
      debugReq.player = null;
    }
    const playing = run.phase === 'play';

    if (playing) {
      run.timeAlive += dt;
      const day = 1 + Math.floor(gameClock.startPhase + gameClock.elapsed / gameClock.dayLength);
      if (day !== run.day) {
        run.day = day;
        if (day >= RESCUE_DAY) rescue();
        else toast(`Day ${day}. You made it through the night.`);
        emit();
      }
    }

    // camera look input
    s.yaw -= input.lookDX * 0.0065;
    s.pitch = Math.min(1.15, Math.max(0.08, s.pitch + input.lookDY * 0.004));
    input.lookDX = 0;
    input.lookDY = 0;

    // movement relative to camera
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const rx = Math.cos(s.yaw);
    const rz = -Math.sin(s.yaw);
    const mx = playing ? rx * input.moveX + fx * input.moveY : 0;
    const mz = playing ? rz * input.moveX + fz * input.moveY : 0;
    const mag = playing ? Math.min(1, Math.hypot(input.moveX, input.moveY)) : 0;

    const ground = world.heightAt(s.x, s.z);
    const swimming = ground < WATER_LEVEL - 0.7;
    const top = swimming ? WALK * 0.45 : mag > 0.92 || input.sprint ? SPRINT : WALK;
    s.speed += (mag * top - s.speed) * Math.min(1, dt * 10);

    // --- dodge roll ---------------------------------------------------------
    s.dodgeCd = Math.max(0, s.dodgeCd - dt);
    combat.invuln = Math.max(0, combat.invuln - dt);
    if (actions.dodge) {
      actions.dodge = false;
      if (playing && s.dodgeCd <= 0) {
        // roll in the stick direction, else backwards
        let dx = mx;
        let dz = mz;
        if (Math.hypot(dx, dz) < 0.1) {
          dx = -Math.sin(s.facing);
          dz = -Math.cos(s.facing);
        }
        const l = Math.hypot(dx, dz) || 1;
        s.dodgeX = dx / l;
        s.dodgeZ = dz / l;
        s.dodge = DODGE_TIME;
        s.dodgeCd = 0.85;
        combat.invuln = DODGE_TIME + 0.08;
        sfxSwing();
      }
    }

    let vx = 0;
    let vz = 0;
    if (s.dodge > 0) {
      s.dodge -= dt;
      vx = s.dodgeX * DODGE_SPEED;
      vz = s.dodgeZ * DODGE_SPEED;
      s.facing = dampAngle(s.facing, Math.atan2(s.dodgeX, s.dodgeZ), Math.min(1, dt * 20));
    } else if (mag > 0.05) {
      const len = Math.hypot(mx, mz) || 1;
      vx = (mx / len) * s.speed;
      vz = (mz / len) * s.speed;
      s.facing = dampAngle(s.facing, Math.atan2(mx, mz), Math.min(1, dt * 12));
    }
    // knockback from a tiger hit
    if (Math.abs(combat.knockX) + Math.abs(combat.knockZ) > 0.05) {
      vx += combat.knockX;
      vz += combat.knockZ;
      combat.knockX *= Math.exp(-dt * 6);
      combat.knockZ *= Math.exp(-dt * 6);
      s.shake = 0.5;
    }
    if (vx || vz) {
      const res = world.collide(s.x + vx * dt, s.z + vz * dt, RADIUS);
      s.x = res.x;
      s.z = res.z;
    }
    combat.facing = s.facing;
    combat.camYaw = s.yaw;

    // --- attack ---------------------------------------------------------------
    s.attackCd = Math.max(0, s.attackCd - dt);
    if (actions.attack) {
      actions.attack = false;
      if (playing && s.attackCd <= 0 && s.dodge <= 0) {
        s.attack = ATTACK_TIME;
        s.attackCd = 0.6;
        s.struck = false;
        sfxSwing();
      }
    }
    if (s.attack > 0) {
      s.attack -= dt;
      const progress = 1 - s.attack / ATTACK_TIME;
      if (!s.struck && progress > 0.4) {
        s.struck = true;
        const reach = run.spear ? 3.0 : run.knife ? 2.0 : 1.6;
        // hit the closest animal inside a forward cone
        let target: (typeof creatures)[number] | null = null;
        let targetD = reach;
        for (const c of creatures) {
          if (!c.alive) continue;
          const tdx = c.x - s.x;
          const tdz = c.z - s.z;
          const d = Math.hypot(tdx, tdz);
          let ang = Math.atan2(tdx, tdz) - s.facing;
          while (ang > Math.PI) ang -= Math.PI * 2;
          while (ang < -Math.PI) ang += Math.PI * 2;
          if (d < targetD && Math.abs(ang) < 1.2) {
            targetD = d;
            target = c;
          }
        }
        if (target) target.pendingHit += run.spear ? 1 : run.knife ? 0.6 : 0.25;
      }
    }

    const g = world.heightAt(s.x, s.z);
    const targetY = g < WATER_LEVEL - 0.7 ? WATER_LEVEL - 0.95 : g;
    s.y += (targetY - s.y) * Math.min(1, dt * 14);

    // --- survival ---------------------------------------------------------------
    if (playing) {
      const inWater = g < WATER_LEVEL - 0.1;
      const nearFire =
        Math.hypot(s.x - world.wreck.x, s.z - world.wreck.z) < 6 ||
        run.campfires.some((f) => Math.hypot(f.x - s.x, f.z - s.z) < 4);
      const drain = tickSurvival(dt, inWater, nearFire);
      if (drain) damage(dt * 1.6, drain);
      if (run.poisoned) damage(dt * 1.1, 'venom');
      if (inWater && !s.wasDrinking && g > WATER_LEVEL - 0.7) sfxDrink();
      s.wasDrinking = inWater;
      run.hurtFlash = Math.max(0, run.hurtFlash - dt * 1.5);
    }

    // --- threat aggregation: heartbeat, red edge, dodge prompt -------------------
    let danger = 0;
    let windup = false;
    for (const c of creatures) {
      if (!c.alive && c.danger <= 0) continue;
      danger = Math.max(danger, c.danger);
      windup = windup || c.windup;
    }
    run.danger += ((playing ? danger : 0) - run.danger) * Math.min(1, dt * 3);
    run.dodgeNow = playing && windup;

    // --- interact: nearest pickup --------------------------------------------------
    let best: Pickup | null = null;
    let bestD = PICKUP_RADIUS;
    for (const p of pickups) {
      if (p.taken) continue;
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    nearestRef.current = playing ? best : null;
    const label = best && playing ? `Pick up ${ITEM_LABEL[best.kind]}` : null;
    if ((run.nearby?.label ?? null) !== label) {
      run.nearby = label ? { label } : null;
      emit();
    }
    if (actions.interact) {
      actions.interact = false;
      if (best && playing) {
        best.taken = true;
        addItem(best.kind, best.amount);
        sfxPickup();
        toast(`+${best.amount} ${ITEM_LABEL[best.kind]}`);
        nearestRef.current = null;
      }
    }

    // --- animation --------------------------------------------------------------------
    s.walk += dt * (s.speed * 1.9 + (s.speed > 0.2 ? 1.2 : 0));
    s.time += dt;
    if (root.current) {
      root.current.position.set(s.x, s.y, s.z);
      root.current.rotation.y = s.facing;
    }
    rig.current?.pose({
      walk: s.walk,
      speed: run.phase === 'dead' ? 0 : s.speed / WALK,
      swim: g < WATER_LEVEL - 0.7,
      time: s.time,
      attack: s.attack > 0 ? 1 - s.attack / ATTACK_TIME : 0,
      dodge: s.dodge > 0 ? 1 - s.dodge / DODGE_TIME : 0,
    });
    if (run.phase === 'dead' && root.current) {
      // collapse
      root.current.rotation.z = Math.min(Math.PI / 2, root.current.rotation.z + dt * 3);
      root.current.position.y = s.y + 0.25;
    } else if (root.current) root.current.rotation.z = 0;

    playerPos.set(s.x, s.y, s.z);

    // --- third-person camera ------------------------------------------------------------
    const cp = Math.cos(s.pitch);
    const tx = s.x + Math.sin(s.yaw) * cp * CAM_DIST;
    const tz = s.z + Math.cos(s.yaw) * cp * CAM_DIST;
    let ty = s.y + 1.4 + Math.sin(s.pitch) * CAM_DIST;
    ty = Math.max(ty, world.heightAt(tx, tz) + 0.6, WATER_LEVEL + 0.4);
    if (!s.camInit) {
      camera.position.set(tx, ty, tz);
      s.camInit = true;
    } else {
      const k = 1 - Math.exp(-dt * 9);
      camera.position.x += (tx - camera.position.x) * k;
      camera.position.y += (ty - camera.position.y) * k;
      camera.position.z += (tz - camera.position.z) * k;
    }
    s.shake = Math.max(s.shake - dt, run.dodgeNow ? 0.06 : 0);
    const sh = s.shake * 0.25;
    camera.lookAt(s.x + (Math.random() - 0.5) * sh, s.y + 1.3 + (Math.random() - 0.5) * sh, s.z);
  });

  return (
    <group ref={root}>
      <Survivor ref={rig} shadows={shadows} weapon={weapon} />
    </group>
  );
}
