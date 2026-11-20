import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Group,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfxGrowl, sfxHit, sfxRoar } from './audio';
import { atmo } from './fx';
import { playerPos } from './shared';
import { combat, damage, debugReq, createCreature, run, tiger, toast, emit, creatureSlot } from './state';
import { mulberry32, WORLD_HALF, type World } from './world';

// Bengal tiger, ~2.6 m nose to rump. Built facing +Z.
// AI: idle prowl -> stalk (circle closer, growl) -> windup (crouch, roar: DODGE window)
//     -> charge (straight lunge) -> recover (vulnerable) -> stalk ...
// Campfires, flares and weapon hits make it flee.

const ORANGE = new Color('#d97a2b');
const DARK = new Color('#1d1611');
const CREAM = new Color('#efe2c8');
const RUST = new Color('#b85a1c');

// Paint stripes + pale belly as vertex colours on a body-part geometry.
function striped(geo: BufferGeometry, stripeFreq: number, axis: 'x' | 'y' | 'z', bellyBelow: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position!;
  const cols = new Float32Array(p.count * 3);
  const c = new Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = axis === 'z' ? z : axis === 'x' ? x : y;
    // warmer on the back, paler on the flanks
    c.copy(ORANGE).lerp(RUST, Math.max(0, Math.min(1, y * 2.5)));
    if (y < bellyBelow) c.lerp(CREAM, Math.min(1, (bellyBelow - y) * 6));
    // stripes run around the body, wobble and fork, and thin out toward the belly
    const wobble = Math.sin(y * 7 + x * 5) * 0.9 + Math.sin(y * 17 - x * 3) * 0.25;
    const band = Math.sin(a * stripeFreq + wobble);
    const width = 0.7 + Math.max(0, bellyBelow + 0.25 - y) * 1.2;
    if (band > width && y > bellyBelow - 0.04) c.copy(DARK);
    // fur noise
    c.multiplyScalar(0.92 + (Math.sin(x * 91 + y * 57 + z * 33) * 0.5 + 0.5) * 0.12);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(cols, 3));
  return g;
}

function onlyPosColor(g: BufferGeometry) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}

function onlyPos(g: BufferGeometry) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return g;
}

type Mode = typeof tiger.mode;

export function Tiger({ world, shadows }: { world: World; shadows: boolean }) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const jaw = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const legs = useRef<(Group | null)[]>([]);

  const geo = useMemo(() => {
    const torsoCore = new CapsuleGeometry(0.36, 1.25, 8, 18);
    torsoCore.rotateX(Math.PI / 2);
    torsoCore.scale(0.92, 1, 1);
    // sag the belly slightly and lift the shoulders
    {
      const tp = torsoCore.attributes.position!;
      for (let i = 0; i < tp.count; i++) {
        const z = tp.getZ(i);
        const y = tp.getY(i);
        if (y < 0) tp.setY(i, y * (1.08 - Math.abs(z) * 0.06));
        if (y > 0 && z > 0.3) tp.setY(i, y + (z - 0.3) * 0.08);
      }
    }
    const chestG = new SphereGeometry(0.42, 14, 12);
    chestG.scale(0.92, 1.05, 1);
    chestG.translate(0, 0.05, 0.62);
    const hauncheL = new SphereGeometry(0.3, 12, 10);
    hauncheL.scale(0.75, 1.05, 1.1);
    hauncheL.translate(0.16, -0.02, -0.6);
    const hauncheR = hauncheL.clone();
    hauncheR.translate(-0.32, 0, 0);
    const neckG = new CapsuleGeometry(0.22, 0.3, 6, 12);
    neckG.rotateX(Math.PI / 2 - 0.6);
    neckG.translate(0, 0.18, 0.86);
    const torso = mergeGeometries(
      [torsoCore, chestG, hauncheL, hauncheR, neckG].map((g) => striped(g, 11, 'z', -0.12)).map(onlyPosColor)
    )!;
    torso.computeVertexNormals();
    const skull = new SphereGeometry(0.27, 16, 12);
    skull.scale(1.02, 0.86, 1.05);
    // brow ridge
    {
      const sp = skull.attributes.position!;
      for (let i = 0; i < sp.count; i++) {
        const z = sp.getZ(i);
        const y = sp.getY(i);
        if (z > 0.12 && y > 0.04) sp.setY(i, y + 0.025);
      }
    }
    const muzzle = new SphereGeometry(0.16, 12, 10);
    muzzle.scale(1.1, 0.78, 1.15);
    muzzle.translate(0, -0.08, 0.22);
    const ruff = new SphereGeometry(0.2, 10, 8);
    ruff.scale(1.6, 0.85, 0.7);
    ruff.translate(0, -0.08, 0.04);
    const jaw = new SphereGeometry(0.12, 10, 8);
    jaw.scale(1, 0.45, 1.3);
    jaw.translate(0, -0.03, 0.12);
    const teethParts = [];
    for (const side of [-1, 1]) {
      const fang = new ConeGeometry(0.018, 0.08, 5);
      fang.rotateX(Math.PI);
      fang.translate(side * 0.06, -0.15, 0.3);
      teethParts.push(fang);
    }
    const fangs = mergeGeometries(teethParts.map(onlyPos))!;
    const ear = new ConeGeometry(0.08, 0.12, 6);
    const leg = new CapsuleGeometry(0.1, 0.42, 4, 8);
    leg.translate(0, -0.25, 0);
    const lower = new CapsuleGeometry(0.075, 0.36, 4, 8);
    lower.translate(0, -0.22, 0);
    const paw = new SphereGeometry(0.1, 8, 6);
    paw.scale(1, 0.55, 1.3);
    const tailSeg = new CapsuleGeometry(0.055, 0.32, 3, 6);
    tailSeg.translate(0, 0, -0.18);
    tailSeg.rotateX(Math.PI / 2);
    return {
      torso,
      skull: striped(skull, 26, 'x', -0.1),
      muzzle: striped(muzzle, 0.01, 'y', 0.2),
      ruff: striped(ruff, 30, 'x', 0.02),
      jaw,
      fangs,
      ear,
      leg: striped(leg, 14, 'y', -0.6),
      lower: striped(lower, 16, 'y', -0.5),
      paw,
      tailSeg: striped(tailSeg, 20, 'z', -1),
    };
  }, []);

  const mats = useMemo(
    () => ({
      fur: new MeshLambertMaterial({ vertexColors: true }),
      dark: new MeshLambertMaterial({ color: '#1d1611' }),
      cream: new MeshLambertMaterial({ color: '#efe2c8' }),
      nose: new MeshLambertMaterial({ color: '#2a1c18' }),
      eye: new MeshBasicMaterial({ color: '#c9b03a', toneMapped: false }),
      fang: new MeshLambertMaterial({ color: '#f4efe2' }),
      whisker: new MeshBasicMaterial({ color: '#f2eee6', transparent: true, opacity: 0.7 }),
    }),
    []
  );

  // AI state
  const ai = useRef(
    (() => {
      const rng = mulberry32(world.seed ^ 0x7f4a7c15);
      // territory: away from the wreck, on dry land
      let hx = 0;
      let hz = 0;
      for (let i = 0; i < 60; i++) {
        const a = rng() * Math.PI * 2;
        const r = 40 + rng() * 30;
        hx = Math.max(-WORLD_HALF + 25, Math.min(WORLD_HALF - 25, world.wreck.x + Math.cos(a) * r));
        hz = Math.max(-WORLD_HALF + 25, Math.min(WORLD_HALF - 25, world.wreck.z + Math.sin(a) * r));
        if (Math.abs(hx - world.riverX(hz)) > 10) break;
      }
      return {
        rng,
        home: { x: hx, z: hz },
        x: hx,
        z: hz,
        y: world.heightAt(hx, hz),
        heading: 0,
        speed: 0,
        timer: 0,
        stalkTime: 0,
        wander: { x: hx, z: hz },
        chargeDir: { x: 0, z: 0 },
        chargeDist: 0,
        nextGrowl: 4,
        gait: 0,
        crouch: 0,
        hitFlash: 0,
        warned: false,
      };
    })()
  );

  const me = useMemo(() => createCreature('tiger', ai.current.x, ai.current.z), []);
  useEffect(creatureSlot(me), [me]);

  const setMode = (m: Mode) => {
    tiger.mode = m;
    ai.current.timer = 0;
    me.windup = m === 'windup';
    me.vulnerable = m === 'recover' ? 2 : 1;
    me.alive = m !== 'gone';
  };

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const a = ai.current;
    const t = state.clock.elapsedTime;
    if (run.phase !== 'play' || tiger.mode === 'gone') {
      me.danger = 0;
      me.windup = false;
      if (root.current) root.current.visible = tiger.mode !== 'gone' && run.phase !== 'intro';
      return;
    }
    if (root.current) root.current.visible = true;
    if (debugReq.tiger) {
      a.x = debugReq.tiger.x;
      a.z = debugReq.tiger.z;
      debugReq.tiger = null;
    }
    a.timer += dt;

    const px = playerPos.x;
    const pz = playerPos.z;
    const dx = px - a.x;
    const dz = pz - a.z;
    const dist = Math.hypot(dx, dz);
    const night = atmo.night;

    // --- reactions -------------------------------------------------------
    if (me.pendingHit > 0) {
      const dmg = me.pendingHit * me.vulnerable;
      me.pendingHit = 0;
      tiger.hp -= dmg;
      a.hitFlash = 1;
      run.tigerHits++;
      sfxHit();
      if (tiger.hp <= 0) {
        run.tigerDown = true;
        toast('The tiger limps away into the jungle. It won’t be back.');
        setMode('flee');
        a.timer = -20; // long flee, then gone
      } else {
        setMode('flee');
      }
      emit();
    }
    if (tiger.scare > 0) {
      tiger.scare = 0;
      if (dist < 40 && tiger.mode !== 'flee') {
        setMode('flee');
        a.timer = -10;
      }
    }
    const nearFire = run.campfires.some((f) => Math.hypot(f.x - a.x, f.z - a.z) < 9 || Math.hypot(f.x - px, f.z - pz) < 5);
    if (nearFire && (tiger.mode === 'stalk' || tiger.mode === 'windup')) {
      setMode('flee');
      if (!a.warned) {
        toast('The fire keeps the tiger at bay.');
        a.warned = true;
      }
    }

    // --- behaviour -------------------------------------------------------
    let targetSpeed = 0;
    let face = a.heading;
    const aggro = run.timeAlive > 35; // grace period after the crash

    switch (tiger.mode) {
      case 'idle': {
        // prowl around home territory
        if (Math.hypot(a.wander.x - a.x, a.wander.z - a.z) < 2 || a.timer > 12) {
          a.wander.x = a.home.x + (a.rng() * 2 - 1) * 14;
          a.wander.z = a.home.z + (a.rng() * 2 - 1) * 14;
          a.timer = 0;
        }
        face = Math.atan2(a.wander.x - a.x, a.wander.z - a.z);
        targetSpeed = 1.6;
        const sense = night > 0.5 ? 38 : 28;
        if (aggro && dist < sense && !nearFire) {
          setMode('stalk');
          a.stalkTime = 0;
          sfxGrowl(0.6);
          toast('Something is moving in the grass…');
        }
        break;
      }
      case 'stalk': {
        a.stalkTime += dt;
        // circle the player, tightening the radius over time
        const radius = Math.max(8.5, 17 - a.stalkTime * 1.2);
        const ang = Math.atan2(a.x - px, a.z - pz) + dt * 0.35;
        const tx = px + Math.sin(ang) * radius;
        const tz = pz + Math.cos(ang) * radius;
        face = Math.atan2(tx - a.x, tz - a.z);
        targetSpeed = 3.2;
        a.nextGrowl -= dt;
        if (a.nextGrowl <= 0) {
          sfxGrowl(Math.min(1, 14 / Math.max(dist, 1)));
          a.nextGrowl = 3.5 + a.rng() * 3;
        }
        const ready = a.stalkTime > (night > 0.5 ? 4 : 6);
        if (ready && dist < 12.5) {
          setMode('windup');
          sfxRoar();
        }
        if (dist > 60) setMode('idle');
        break;
      }
      case 'windup': {
        face = Math.atan2(dx, dz);
        targetSpeed = 0;
        const wind = night > 0.5 ? 0.85 : 1.05;
        if (a.timer > wind) {
          // lunge at where the player is now (no homing: dodging sideways works)
          const len = dist || 1;
          a.chargeDir.x = dx / len;
          a.chargeDir.z = dz / len;
          a.chargeDist = 0;
          setMode('charge');
        }
        break;
      }
      case 'charge': {
        face = Math.atan2(a.chargeDir.x, a.chargeDir.z);
        targetSpeed = 15;
        if (dist < 1.35 && combat.invuln <= 0) {
          damage(28, 'tiger');
          combat.knockX = a.chargeDir.x * 7;
          combat.knockZ = a.chargeDir.z * 7;
          setMode('recover');
        } else if (a.chargeDist > 17 || a.timer > 1.3) {
          setMode('recover');
        }
        break;
      }
      case 'recover': {
        face = Math.atan2(dx, dz);
        targetSpeed = 0;
        if (a.timer > 1.7) {
          setMode('stalk');
          a.stalkTime = 2;
        }
        break;
      }
      case 'flee': {
        face = Math.atan2(-dx, -dz);
        targetSpeed = 8;
        if (a.timer > 6) {
          if (run.tigerDown) setMode('gone');
          else {
            setMode('idle');
            a.wander.x = a.home.x;
            a.wander.z = a.home.z;
          }
        }
        break;
      }
    }

    // --- movement ----------------------------------------------------------
    const turn = tiger.mode === 'charge' ? 0 : Math.min(1, dt * 5);
    let d = face - a.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    a.heading += d * turn;
    if (tiger.mode === 'charge') a.heading = face;
    a.speed += (targetSpeed - a.speed) * Math.min(1, dt * (tiger.mode === 'charge' ? 12 : 4));

    const vx = Math.sin(a.heading) * a.speed * dt;
    const vz = Math.cos(a.heading) * a.speed * dt;
    const res = world.collide(a.x + vx, a.z + vz, 0.6);
    const moved = Math.hypot(res.x - a.x, res.z - a.z);
    if (tiger.mode === 'charge') {
      a.chargeDist += moved;
      // slammed into a tree: stunned
      if (moved < Math.hypot(vx, vz) * 0.4) setMode('recover');
    }
    a.x = res.x;
    a.z = res.z;
    // keep a body-length away from the player unless lunging
    if (tiger.mode !== 'charge') {
      const sx = a.x - px;
      const sz = a.z - pz;
      const sd = Math.hypot(sx, sz);
      if (sd < 1.7 && sd > 1e-4) {
        a.x = px + (sx / sd) * 1.7;
        a.z = pz + (sz / sd) * 1.7;
      }
    }
    a.y += (world.heightAt(a.x, a.z) - a.y) * Math.min(1, dt * 10);
    tiger.x = a.x;
    tiger.z = a.z;

    // --- danger level for heartbeat / HUD ---------------------------------
    let danger = 0;
    if (tiger.mode === 'stalk') danger = Math.max(0, 1 - dist / 30) * 0.8 + 0.15;
    if (tiger.mode === 'windup' || tiger.mode === 'charge') danger = 1;
    if (tiger.mode === 'recover') danger = 0.6;
    me.danger = danger;
    me.x = a.x;
    me.z = a.z;

    // --- animation ----------------------------------------------------------
    a.gait += dt * (a.speed * 2.2 + 0.5);
    const crouchTarget = tiger.mode === 'windup' ? 1 : tiger.mode === 'stalk' ? 0.45 : 0;
    a.crouch += (crouchTarget - a.crouch) * Math.min(1, dt * 8);
    a.hitFlash = Math.max(0, a.hitFlash - dt * 3);

    if (root.current) {
      root.current.position.set(a.x, a.y, a.z);
      root.current.rotation.y = a.heading;
    }
    const galloping = a.speed > 6;
    if (body.current) {
      const bob = galloping ? Math.sin(a.gait * 2) * 0.08 : Math.abs(Math.sin(a.gait)) * 0.03;
      body.current.position.y = 0.92 - a.crouch * 0.35 + bob;
      body.current.rotation.x = (galloping ? Math.sin(a.gait * 2) * 0.12 : 0) + a.crouch * 0.12;
      body.current.rotation.z = a.hitFlash * Math.sin(t * 40) * 0.08;
    }
    if (jaw.current) {
      const open = tiger.mode === 'windup' ? 0.55 : tiger.mode === 'charge' ? 0.4 : tiger.mode === 'recover' ? 0.18 + Math.sin(t * 9) * 0.08 : 0;
      jaw.current.rotation.x += (open - jaw.current.rotation.x) * Math.min(1, dt * 12);
    }
    if (head.current) {
      head.current.rotation.x = -0.1 + a.crouch * 0.25 + (tiger.mode === 'windup' ? Math.sin(t * 20) * 0.03 : 0);
      head.current.rotation.y = tiger.mode === 'idle' ? Math.sin(t * 0.7) * 0.3 : 0;
    }
    legs.current.forEach((leg, i) => {
      if (!leg) return;
      const phase = galloping ? (i < 2 ? 0 : Math.PI * 0.6) + (i % 2) * 0.4 : (i === 0 || i === 3 ? 0 : Math.PI);
      const amp = Math.min(1, a.speed / 3) * (galloping ? 0.9 : 0.5);
      leg.rotation.x = Math.sin(a.gait + phase) * amp - a.crouch * (i < 2 ? -0.5 : 0.7);
    });
    if (tail.current) {
      tail.current.rotation.y = Math.sin(t * (tiger.mode === 'stalk' ? 4 : 1.5)) * 0.4;
      tail.current.rotation.x = -0.5 + a.crouch * 0.4;
    }
    {
      // eyes glow in the dark, brighter while hunting
      const glow = night * (tiger.mode === 'idle' ? 0.5 : 1);
      mats.eye.color.setRGB(0.9 * glow + 0.15, 0.85 * glow + 0.12, 0.25 * glow + 0.05);
    }
  });

  const cs = shadows;
  const legPos: [number, number, number][] = [
    [0.22, -0.05, 0.62],
    [-0.22, -0.05, 0.62],
    [0.22, -0.02, -0.62],
    [-0.22, -0.02, -0.62],
  ];

  return (
    <group ref={root} visible={false}>
      <group ref={body} position-y={0.92}>
        <mesh geometry={geo.torso} material={mats.fur} castShadow={cs} />
        {legPos.map((p, i) => (
          <group key={i} ref={(el) => void (legs.current[i] = el)} position={p}>
            <mesh geometry={geo.leg} material={mats.fur} castShadow={cs} />
            <group position-y={-0.5}>
              <mesh geometry={geo.lower} material={mats.fur} />
              <mesh geometry={geo.paw} material={mats.cream} position={[0, -0.42, 0.04]} />
            </group>
          </group>
        ))}
        <group ref={head} position={[0, 0.28, 1.0]}>
          <mesh geometry={geo.skull} material={mats.fur} castShadow={cs} />
          <mesh geometry={geo.muzzle} material={mats.fur} />
          <mesh geometry={geo.ruff} material={mats.fur} />
          {/* white patches over the eyes */}
          <mesh position={[0.1, 0.11, 0.2]} scale={[1.2, 0.5, 0.6]} material={mats.cream}>
            <sphereGeometry args={[0.045, 8, 6]} />
          </mesh>
          <mesh position={[-0.1, 0.11, 0.2]} scale={[1.2, 0.5, 0.6]} material={mats.cream}>
            <sphereGeometry args={[0.045, 8, 6]} />
          </mesh>
          <group ref={jaw} position={[0, -0.12, 0.1]}>
            <mesh geometry={geo.jaw} material={mats.cream} />
          </group>
          <mesh geometry={geo.fangs} material={mats.fang} />
          {/* whiskers */}
          {[1, -1].map((side) => (
            <group key={side} position={[side * 0.1, -0.08, 0.32]} rotation-y={side * 0.5}>
              {[0, 1, 2].map((k) => (
                <mesh key={k} position={[side * 0.11, (k - 1) * 0.02, 0]} rotation-z={(k - 1) * 0.15 * side} material={mats.whisker}>
                  <boxGeometry args={[0.24, 0.004, 0.004]} />
                </mesh>
              ))}
            </group>
          ))}
          <mesh position={[0, -0.04, 0.37]} material={mats.nose}>
            <sphereGeometry args={[0.045, 6, 5]} />
          </mesh>
          <mesh geometry={geo.ear} material={mats.dark} position={[0.17, 0.22, -0.04]} rotation-z={-0.3} />
          <mesh geometry={geo.ear} material={mats.dark} position={[-0.17, 0.22, -0.04]} rotation-z={0.3} />
          <mesh position={[0.17, 0.22, -0.085]} material={mats.cream}>
            <circleGeometry args={[0.03, 8]} />
          </mesh>
          <mesh position={[-0.17, 0.22, -0.085]} material={mats.cream}>
            <circleGeometry args={[0.03, 8]} />
          </mesh>
          {/* eyes */}
          {[0.1, -0.1].map((x) => (
            <mesh key={x} position={[x, 0.06, 0.24]} material={mats.eye}>
              <sphereGeometry args={[0.032, 6, 5]} />
            </mesh>
          ))}
        </group>
        {/* tail: three segments curling */}
        <group ref={tail} position={[0, 0.12, -0.95]}>
          <mesh geometry={geo.tailSeg} material={mats.fur} />
          <group position={[0, 0, -0.34]} rotation-x={0.35}>
            <mesh geometry={geo.tailSeg} material={mats.fur} />
            <group position={[0, 0, -0.34]} rotation-x={0.45}>
              <mesh geometry={geo.tailSeg} material={mats.dark} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
