import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Mesh, MeshLambertMaterial, Vector3, type Group, type PointLight } from 'three';
import { sfxFlare, startRotor } from './audio';
import { playerPos } from './shared';
import { emit, rescueFx, run } from './state';
import type { World } from './world';

// Rescue cinematic at dawn of day 6 (~16 s, skippable):
//   0.0  the survivor fires a red flare into the sky
//   1.2  a rescue helicopter flies in and settles into a hover overhead
//   6.6  the winch line drops
//   8.2  the survivor is winched up
//  11.0  the end card appears; the helicopter banks away with the survivor on the line

export const RESCUE_CARD_AT = 11;
const ARRIVE = [1.2, 6.6] as const;
const ROPE = [6.6, 8.2] as const;
const LIFT = [8.2, 11] as const;
const HOVER = 13; // hover height above the ground
const HANG = 2.05; // rope end above the survivor's feet (hands)

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const phase = (t: number, [a, b]: readonly [number, number]) => ease((t - a) / (b - a));

// shortest signed angle from a to b
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

const tmp = new Vector3();
const look = new Vector3();

function Helicopter({ heli, mainRotor, tailRotor, strobe }: { heli: RefObject<Group | null>; mainRotor: RefObject<Group | null>; tailRotor: RefObject<Group | null>; strobe: RefObject<Mesh | null> }) {
  return (
    <group ref={heli}>
      {/* fuselage: white upper, rescue-orange lower */}
      <mesh scale={[1.25, 1.2, 2.3]}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshLambertMaterial color="#ebe7dc" />
      </mesh>
      <mesh scale={[1.27, 0.7, 2.32]} position-y={-0.42}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshLambertMaterial color="#e2632b" />
      </mesh>
      {/* cockpit glazing */}
      <mesh scale={[1.0, 0.75, 1.05]} position={[0, 0.22, 1.45]}>
        <sphereGeometry args={[1, 16, 10]} />
        <meshLambertMaterial color="#1b2a35" />
      </mesh>
      {/* open side door (the winch side) */}
      <mesh position={[1.12, -0.05, 0.1]}>
        <boxGeometry args={[0.12, 1.1, 1.3]} />
        <meshLambertMaterial color="#14181c" />
      </mesh>
      {/* winch arm */}
      <mesh position={[1.45, 0.55, 0.1]}>
        <boxGeometry args={[0.8, 0.1, 0.12]} />
        <meshLambertMaterial color="#8b8f93" />
      </mesh>
      {/* tail boom + fin + stabiliser */}
      <mesh rotation-x={Math.PI / 2} position={[0, 0.35, -4.2]}>
        <cylinderGeometry args={[0.16, 0.38, 4.6, 10]} />
        <meshLambertMaterial color="#ebe7dc" />
      </mesh>
      <mesh position={[0, 1.0, -6.4]} rotation-x={-0.35}>
        <boxGeometry args={[0.1, 1.5, 0.8]} />
        <meshLambertMaterial color="#e2632b" />
      </mesh>
      <mesh position={[0, 0.35, -5.9]}>
        <boxGeometry args={[1.8, 0.08, 0.5]} />
        <meshLambertMaterial color="#e2632b" />
      </mesh>
      <group ref={tailRotor} position={[0.22, 1.05, -6.5]}>
        <mesh>
          <boxGeometry args={[0.04, 1.4, 0.12]} />
          <meshLambertMaterial color="#2a2d31" />
        </mesh>
      </group>
      {/* rotor mast + blades + blur disc */}
      <mesh position-y={1.3}>
        <cylinderGeometry args={[0.12, 0.2, 0.5, 8]} />
        <meshLambertMaterial color="#5a5e63" />
      </mesh>
      <group ref={mainRotor} position-y={1.58}>
        <mesh>
          <boxGeometry args={[11, 0.05, 0.32]} />
          <meshLambertMaterial color="#2a2d31" />
        </mesh>
        <mesh rotation-y={Math.PI / 2}>
          <boxGeometry args={[11, 0.05, 0.32]} />
          <meshLambertMaterial color="#2a2d31" />
        </mesh>
      </group>
      <mesh position-y={1.6} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[5.5, 32]} />
        <meshBasicMaterial color="#cfd3d6" transparent opacity={0.13} depthWrite={false} />
      </mesh>
      {/* skids */}
      {[-0.95, 0.95].map((x) => (
        <group key={x}>
          <mesh position={[x, -1.45, 0.2]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.06, 0.06, 3.4, 6]} />
            <meshLambertMaterial color="#5a5e63" />
          </mesh>
          <mesh position={[x * 0.85, -1.1, 0.9]}>
            <cylinderGeometry args={[0.05, 0.05, 0.7, 6]} />
            <meshLambertMaterial color="#5a5e63" />
          </mesh>
          <mesh position={[x * 0.85, -1.1, -0.6]}>
            <cylinderGeometry args={[0.05, 0.05, 0.7, 6]} />
            <meshLambertMaterial color="#5a5e63" />
          </mesh>
        </group>
      ))}
      {/* anti-collision strobe */}
      <mesh ref={strobe} position={[0, 1.7, -6.6]}>
        <sphereGeometry args={[0.12, 8, 6]} />
        <meshBasicMaterial color="#ff3b2f" fog={false} />
      </mesh>
    </group>
  );
}

export function Rescue({ world }: { world: World }) {
  const camera = useThree((s) => s.camera);
  const heli = useRef<Group>(null);
  const mainRotor = useRef<Group>(null);
  const tailRotor = useRef<Group>(null);
  const strobe = useRef<Mesh>(null);
  const rope = useRef<Mesh>(null);
  const flare = useRef<Group>(null);
  const flareLight = useRef<PointLight>(null);
  const smoke = useRef<Group>(null);

  const st = useRef({
    started: false,
    gx: 0, // survivor's ground spot
    gy: 0,
    gz: 0,
    fromX: 0,
    fromZ: 0,
    awayX: 0,
    awayZ: 0,
    camAng: 0,
    flareY: 0,
    rotor: null as ReturnType<typeof startRotor>,
    smokeT: 0,
  });

  // stop the rotor loop if the scene unmounts mid-cinematic (retry, quality change)
  useEffect(
    () => () => {
      st.current.rotor?.stop();
      st.current.rotor = null;
    },
    [],
  );

  // 24 puffs of red flare smoke, recycled along the flare's climb
  const puffs = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    const g = heli.current;
    if (!g) return;

    if (run.phase !== 'rescued') {
      if (s.started) {
        s.rotor?.stop();
        s.rotor = null;
        s.started = false;
      }
      g.visible = false;
      if (flare.current) flare.current.visible = false;
      if (rope.current) rope.current.visible = false;
      if (smoke.current) smoke.current.visible = false;
      return;
    }

    if (!s.started) {
      s.started = true;
      rescueFx.active = true;
      rescueFx.t = 0;
      s.gx = playerPos.x;
      s.gz = playerPos.z;
      s.gy = world.heightAt(s.gx, s.gz);
      // fly in from where the camera is looking (so it is seen arriving), leave the other way
      const cdx = s.gx - camera.position.x;
      const cdz = s.gz - camera.position.z;
      const cl = Math.hypot(cdx, cdz) || 1;
      s.fromX = cdx / cl;
      s.fromZ = cdz / cl;
      s.awayX = -s.fromZ;
      s.awayZ = s.fromX;
      s.camAng = Math.atan2(camera.position.x - s.gx, camera.position.z - s.gz);
      s.flareY = s.gy + 1.6;
      s.rotor = startRotor();
      sfxFlare();
    }

    rescueFx.t += dt;
    const t = rescueFx.t;
    if (t >= RESCUE_CARD_AT && !run.rescueDone) {
      run.rescueDone = true;
      emit();
    }

    // --- helicopter path -------------------------------------------------------
    const hoverY = s.gy + HOVER;
    const arrive = phase(t, ARRIVE);
    const startDist = 150;
    let hx = s.gx + s.fromX * startDist * (1 - arrive);
    let hz = s.gz + s.fromZ * startDist * (1 - arrive);
    let hy = hoverY + 22 * (1 - arrive);
    // depart: accelerate sideways and climb with the survivor on the line
    const dep = Math.max(0, t - LIFT[1] - 0.4);
    if (dep > 0) {
      const d = 1.6 * dep * dep + 2 * dep;
      hx += s.awayX * d;
      hz += s.awayZ * d;
      hy += 0.9 * dep * dep;
    }
    // gentle hover bob
    hy += Math.sin(t * 1.7) * 0.25 * arrive;
    g.visible = true;
    g.position.set(hx, hy, hz);
    // heading: nose along travel, then turned side-on (door toward the survivor) in the hover
    const travelYaw = Math.atan2(-s.fromX, -s.fromZ);
    const departYaw = Math.atan2(s.awayX, s.awayZ);
    const hoverYaw = travelYaw + Math.PI / 2;
    const yaw = dep > 0 ? hoverYaw + turn(hoverYaw, departYaw) * Math.min(1, dep / 1.5) : travelYaw + turn(travelYaw, hoverYaw) * phase(t, [5.2, 6.6]);
    g.rotation.set(0, 0, 0);
    g.rotation.y = yaw;
    // nose down while flying fast, flare up when braking
    const speedIn = arrive > 0 && arrive < 1 ? Math.sin(arrive * Math.PI) : 0;
    g.rotation.x = speedIn * 0.22 - phase(t, [5, 6.2]) * (1 - phase(t, [6.2, 7.2])) * 0.12 + Math.min(0.25, dep * 0.12);
    g.rotation.z = Math.min(0.2, dep * 0.1);
    if (mainRotor.current) mainRotor.current.rotation.y += dt * 38;
    if (tailRotor.current) tailRotor.current.rotation.x += dt * 60;
    if (strobe.current) strobe.current.visible = Math.sin(t * 9) > 0.6;

    // rotor sound by proximity
    const hd = Math.hypot(hx - s.gx, hz - s.gz, hy - s.gy);
    s.rotor?.set?.(Math.max(0, Math.min(1, 1 - hd / 140)));

    // --- winch line + survivor -----------------------------------------------------
    // winch point in world space (door side of the hovering helicopter)
    tmp.set(1.75, 0.5, 0.1).applyEuler(g.rotation).add(g.position);
    const ropeOut = phase(t, ROPE);
    const lift = phase(t, LIFT);
    let sx = s.gx;
    let sy = s.gy;
    let sz = s.gz;
    // during the lift the survivor sways in under the winch, then rides it
    if (t > LIFT[0]) {
      const k = ease(Math.min(1, (t - LIFT[0]) / 1.2));
      sx = s.gx + (tmp.x - s.gx) * k;
      sz = s.gz + (tmp.z - s.gz) * k;
      const top = tmp.y - HANG - 0.9;
      sy = s.gy + (top - s.gy) * lift;
      if (dep > 0) {
        sx = tmp.x + Math.sin(t * 2.1) * 0.15;
        sz = tmp.z;
        sy = top;
      }
    }
    rescueFx.x = sx;
    rescueFx.y = sy;
    rescueFx.z = sz;

    const r = rope.current;
    if (r) {
      // rope from the winch down to the survivor's hands (or the dropping hook)
      const endY = t > LIFT[0] ? sy + HANG : tmp.y - (tmp.y - (s.gy + HANG)) * ropeOut;
      const endX = t > LIFT[0] ? sx : tmp.x;
      const endZ = t > LIFT[0] ? sz : tmp.z;
      const len = Math.max(0.01, Math.hypot(tmp.x - endX, tmp.y - endY, tmp.z - endZ));
      r.visible = ropeOut > 0.01;
      r.position.set((tmp.x + endX) / 2, (tmp.y + endY) / 2, (tmp.z + endZ) / 2);
      r.scale.set(1, len, 1);
      look.set(endX - tmp.x, endY - tmp.y, endZ - tmp.z).normalize();
      r.quaternion.setFromUnitVectors(UP, look);
    }

    // --- flare: a red star climbing over the canopy, trailing smoke -----------------
    if (flare.current) {
      const ft = t;
      flare.current.visible = ft < 9;
      const climb = Math.min(1, ft / 1.6);
      s.flareY = s.gy + 1.6 + (1 - (1 - climb) * (1 - climb)) * 42 - Math.max(0, ft - 1.6) * 2.2;
      flare.current.position.set(s.gx + 0.6, s.flareY, s.gz + 0.3);
      if (flareLight.current) flareLight.current.intensity = ft < 9 ? 14 * (0.85 + Math.random() * 0.3) : 0;
    }
    if (smoke.current) {
      smoke.current.visible = t < 12;
      smoke.current.children.forEach((p, i) => {
        // each puff is laid down at the height the flare had when it passed, then drifts and grows
        const born = i * 0.07;
        const age = t - born;
        const fade = Math.max(0, 1 - age / 7);
        p.visible = age > 0 && fade > 0;
        if (!p.visible) return;
        const bornClimb = Math.min(1, born / 1.6);
        const y = s.gy + 1.6 + (1 - (1 - bornClimb) * (1 - bornClimb)) * 42;
        p.position.set(s.gx + 0.6 + age * 0.35, y + age * 0.25, s.gz + 0.3 + age * 0.15);
        // thin trail that softens and thins out, never a wall of smoke in front of the camera
        p.scale.setScalar(Math.min(1.6, 0.35 + age * 0.3));
        if (p instanceof Mesh && p.material instanceof MeshLambertMaterial) p.material.opacity = 0.32 * fade;
      });
    }

    // --- camera: low wide shot from the survivor's side, slowly orbiting -----------------
    s.camAng += dt * 0.06;
    const focusX = sx;
    const focusZ = sz;
    const cd = 11 + lift * 3 + dep * 1.5;
    const camX = focusX + Math.sin(s.camAng) * cd;
    const camZ = focusZ + Math.cos(s.camAng) * cd;
    const camY = Math.max(world.heightAt(camX, camZ) + 1.8, s.gy + 2.2 + lift * 6 + dep * 1.2);
    const k = 1 - Math.exp(-dt * 2.5);
    camera.position.x += (camX - camera.position.x) * k;
    camera.position.y += (camY - camera.position.y) * k;
    camera.position.z += (camZ - camera.position.z) * k;
    // look at the flare first, then frame survivor and helicopter together
    if (t < 2.2) look.set(s.gx, Math.min(s.flareY, s.gy + 18), s.gz);
    else look.set(sx + (hx - sx) * 0.4, sy + 1.2 + (hy - sy) * 0.42, sz + (hz - sz) * 0.4);
    camera.lookAt(look);

    if (t > 18) {
      s.rotor?.stop();
      s.rotor = null;
    }
  });

  return (
    <>
      <Helicopter heli={heli} mainRotor={mainRotor} tailRotor={tailRotor} strobe={strobe} />
      <mesh ref={rope} visible={false}>
        <cylinderGeometry args={[0.025, 0.025, 1, 5]} />
        <meshLambertMaterial color="#e8d9a8" />
      </mesh>
      <group ref={flare} visible={false}>
        <mesh>
          <sphereGeometry args={[0.35, 10, 8]} />
          <meshBasicMaterial color="#ffd6c9" fog={false} />
        </mesh>
        <mesh scale={2.4}>
          <sphereGeometry args={[0.35, 10, 8]} />
          <meshBasicMaterial color="#ff3a22" transparent opacity={0.55} blending={AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
        <pointLight ref={flareLight} color="#ff3a22" distance={60} decay={1.2} intensity={0} />
      </group>
      <group ref={smoke} visible={false}>
        {puffs.map((i) => (
          <mesh key={i} visible={false}>
            <sphereGeometry args={[0.5, 12, 8]} />
            <meshLambertMaterial color="#d9584a" transparent opacity={0.38} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </>
  );
}

const UP = new Vector3(0, 1, 0);
