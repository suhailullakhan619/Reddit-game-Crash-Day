import { useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { sfxBow, sfxCraft, sfxDrink, sfxPickup, sfxSwing } from './audio';
import { ARROW_GRAVITY, ARROW_SPEED, fireArrow } from './Arrows';
import { DAY_WARNING, hard } from './difficulty';
import { input } from './input';
import { track } from './net';
import { PICKUP_RADIUS, type Pickup } from './loot';
import { nearestRef } from './Pickups';
import { gameClock, playerPos, view } from './shared';
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
  rescueFx,
  run,
  subscribe,
  toast,
} from './state';
import { Survivor, type SurvivorHandle, type Weapon } from './Survivor';
import { survival, tickSurvival } from './survival';
import { WATER_LEVEL, type World } from './world';

const WALK = 4.2;
const SPRINT = 6.8;
const CAM_DIST = 6.5;
const RADIUS = 0.4;
const DODGE_TIME = 0.38;
const DODGE_SPEED = 12;
const ATTACK_TIME = 0.45;

// Supply crate contents: medicine, water, food, and ammo (or a flare before you have a bow).
function openCrate() {
  run.inv.medkit += 1;
  run.inv.water += 2;
  run.inv.berries += 2;
  if (run.bow) run.arrows += 4;
  else run.inv.flare += 1;
  run.collected += 5;
  sfxCraft();
  track('supply_crate');
  toast(`Supply crate: Med kit, 2 Water, 2 Berries, ${run.bow ? '4 arrows' : 'a Flare'}.`);
  emit();
}

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
  const size = useThree((s) => s.size);
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
    shootCd: 0,
    struck: false,
    wasDrinking: false,
    sheltered: false,
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
    // rescue cinematic: hang from the helicopter rope; Rescue.tsx owns the camera
    if (rescueFx.active) {
      s.time += dt;
      s.x = rescueFx.x;
      s.y = rescueFx.y;
      s.z = rescueFx.z;
      root.current?.position.set(s.x, s.y, s.z);
      if (root.current) root.current.rotation.z = 0;
      rig.current?.pose({ walk: s.walk, speed: 0, swim: false, time: s.time, attack: 0, dodge: 0 });
      playerPos.set(s.x, s.y, s.z);
      actions.interact = actions.attack = actions.dodge = actions.shoot = false;
      return;
    }
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
        track('day_survived', `day${Math.min(day - 1, 5)}`);
        run.day = day;
        if (day >= RESCUE_DAY) rescue();
        else toast(DAY_WARNING[day] ?? `Day ${day}. You made it through the night.`);
        emit();
      }
    }

    // camera look input
    const looking = input.lookDX !== 0 || input.lookDY !== 0;
    s.yaw -= input.lookDX * 0.0065;
    // portrait phones see a narrow slice sideways: widen the view so threats stay in frame
    {
      const aspect = size.width / Math.max(1, size.height);
      const wantFov = aspect < 0.8 ? 74 : aspect < 1.2 ? 66 : 60;
      if ('fov' in camera && Math.abs(camera.fov - wantFov) > 0.1) {
        camera.fov = wantFov;
        camera.updateProjectionMatrix();
      }
    }
    view.camera = camera;
    // an animal winding up to attack: swing the camera toward it so the lunge is visible
    if (playing && !looking) {
      let target: (typeof creatures)[number] | null = null;
      for (const c of creatures) if (c.alive && c.windup && (!target || c.danger > target.danger)) target = c;
      if (target) {
        const want = Math.atan2(-(target.x - s.x), -(target.z - s.z));
        let d = want - s.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        s.yaw += d * Math.min(1, dt * 4);
      }
    }
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

    // --- bow ---------------------------------------------------------------------
    s.shootCd = Math.max(0, s.shootCd - dt);
    if (actions.shoot) {
      actions.shoot = false;
      if (playing && run.bow && s.shootCd <= 0 && s.dodge <= 0) {
        if (run.arrows <= 0) toast('Out of arrows. Craft more: 1 wood + 1 stone.');
        else {
          // aim along the camera; snap to the animal closest to the crosshair line
          const cfx = -Math.sin(s.yaw);
          const cfz = -Math.cos(s.yaw);
          let aim: (typeof creatures)[number] | null = null;
          let aimScore = Infinity;
          for (const c of creatures) {
            if (!c.alive) continue;
            const tdx = c.x - s.x;
            const tdz = c.z - s.z;
            const d = Math.hypot(tdx, tdz);
            if (d > 34 || d < 0.5) continue;
            const ang = Math.acos(Math.max(-1, Math.min(1, (tdx * cfx + tdz * cfz) / d)));
            if (ang > 0.55) continue;
            const score = ang * 20 + d * 0.15 + (c.windup ? -3 : 0);
            if (score < aimScore) {
              aimScore = score;
              aim = c;
            }
          }
          const ox = s.x;
          const oy = s.y + 1.45;
          const oz = s.z;
          let dx = cfx;
          let dz = cfz;
          let vy = 0.6;
          if (aim) {
            const tdx = aim.x - ox;
            const tdz = aim.z - oz;
            const d = Math.hypot(tdx, tdz) || 1;
            dx = tdx / d;
            dz = tdz / d;
            const ty = world.heightAt(aim.x, aim.z) + (aim.kind === 'snake' ? 0.15 : aim.kind === 'gator' ? 0.25 : 0.7);
            const t = d / ARROW_SPEED;
            // lead the drop so the arrow lands on target
            vy = (ty - oy) / t + 0.5 * ARROW_GRAVITY * t;
          }
          fireArrow(ox + dx * 0.5, oy, oz + dz * 0.5, dx * ARROW_SPEED, vy, dz * ARROW_SPEED);
          s.facing = Math.atan2(dx, dz);
          run.arrows--;
          s.shootCd = 0.7;
          s.attack = ATTACK_TIME;
          s.struck = true; // pose only, no melee hit
          sfxBow();
          emit();
        }
      }
    }

    const g = world.heightAt(s.x, s.z);
    const targetY = g < WATER_LEVEL - 0.7 ? WATER_LEVEL - 0.95 : g;
    s.y += (targetY - s.y) * Math.min(1, dt * 14);

    // --- survival ---------------------------------------------------------------
    if (playing) {
      const inWater = g < WATER_LEVEL - 0.1;
      // campfires burn out (sooner on later days): rebuild them to stay warm and safe
      const life = hard.fireLife();
      for (const f of run.campfires) {
        if (f.out) continue;
        f.age += dt;
        if (f.age > life) {
          f.out = true;
          if (Math.hypot(f.x - s.x, f.z - s.z) < 25) toast('Your campfire has burned out.');
          emit();
        }
      }
      const nearFire =
        Math.hypot(s.x - world.wreck.x, s.z - world.wreck.z) < 6 ||
        run.campfires.some((f) => !f.out && Math.hypot(f.x - s.x, f.z - s.z) < 4);
      // a lean-to keeps most of the night cold off and lets wounds heal while you rest
      const sheltered = run.shelters.some((h) => Math.hypot(h.x - s.x, h.z - s.z) < 2.6);
      const drain = tickSurvival(dt, inWater, nearFire, hard.drain(), hard.cold() * (sheltered ? 0.25 : 1));
      if (sheltered && survival.hunger > 30 && survival.thirst > 30) survival.health = Math.min(100, survival.health + dt * 0.9);
      if (sheltered !== s.sheltered) {
        s.sheltered = sheltered;
        if (sheltered) toast('Resting in the shelter. Warm, and healing.');
      }
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
    // a landed supply crate beats loose items
    let crate: (typeof run.drops)[number] | null = null;
    for (const d of run.drops) {
      if (d.landed && !d.opened && Math.hypot(d.x - s.x, d.z - s.z) < 2.4) crate = d;
    }
    const label = !playing ? null : crate ? 'Open supply crate' : best ? `Pick up ${ITEM_LABEL[best.kind]}` : null;
    if ((run.nearby?.label ?? null) !== label) {
      run.nearby = label ? { label } : null;
      emit();
    }
    if (actions.interact) {
      actions.interact = false;
      if (crate && playing) {
        crate.opened = true;
        openCrate();
      } else if (best && playing) {
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
    // fixed follow distance: leaves near the lens dissolve instead (see nearFade in shared.ts),
    // so the camera never zooms in and out while running through the jungle
    const dist = CAM_DIST;
    const tx = s.x + Math.sin(s.yaw) * cp * dist;
    const tz = s.z + Math.cos(s.yaw) * cp * dist;
    let ty = s.y + 1.4 + Math.sin(s.pitch) * dist;
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
      <Survivor ref={rig} shadows={shadows} weapon={weapon} bow={run.bow} />
    </group>
  );
}
