import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  MeshLambertMaterial,
  MeshBasicMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type Group,
} from 'three';
import { sfxHiss, sfxHit } from './audio';
import { playerPos } from './shared';
import { combat, createCreature, creatureSlot, damage, emit, run, toast } from './state';
import { mulberry32, WATER_LEVEL, WORLD_HALF, type World } from './world';

// Pit vipers coiled in the undergrowth. They never chase: walk around them.
// Get too close and they rear up and hiss (dodge window), then strike. A bite poisons you
// until you use a med kit or herbal poultice. One weapon hit kills.

const COUNT = 18;
const VISIBLE = 55;

// Coiled body: a tapered tube along a flat spiral that rises into the neck.
function coilGeometry(): BufferGeometry {
  const pts: Vector3[] = [];
  const turns = 1.8;
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = 0.36 - t * 0.2;
    pts.push(new Vector3(Math.cos(a) * r, 0.05 + t * 0.06, Math.sin(a) * r));
  }
  // neck rises from the centre of the coil
  pts.push(new Vector3(0.05, 0.2, 0.06));
  pts.push(new Vector3(0.06, 0.32, 0.16));
  const curve = new CatmullRomCurve3(pts);
  const tube = new TubeGeometry(curve, 90, 0.055, 7, false);
  // taper: thin tail at the start, thicker body, slightly thinner neck
  const p = tube.attributes.position!;
  const cols = new Float32Array(p.count * 3);
  const olive = new Color('#6f6a2e');
  const dark = new Color('#2a2814');
  const belly = new Color('#d8cc94');
  const c = new Color();
  const ringVerts = 8;
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / ringVerts);
    const t = ring / 90;
    const center = curve.getPointAt(Math.min(1, t));
    const taper = t < 0.25 ? 0.35 + (t / 0.25) * 0.65 : t > 0.85 ? 1 - (t - 0.85) * 1.6 : 1;
    const vx = p.getX(i) - center.x;
    const vy = p.getY(i) - center.y;
    const vz = p.getZ(i) - center.z;
    p.setXYZ(i, center.x + vx * taper, center.y + vy * taper * 0.85, center.z + vz * taper);
    // diamond-back pattern
    const around = (i % ringVerts) / ringVerts;
    const diamond = Math.abs(((t * 34) % 2) - 1) + Math.abs(around - 0.25) * 2;
    c.copy(olive);
    if (diamond < 0.75) c.copy(dark);
    if (vy < -0.025) c.copy(belly);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  tube.setAttribute('color', new BufferAttribute(cols, 3));
  tube.computeVertexNormals();
  return tube;
}

type SnakeSpot = { x: number; z: number; r: number };

function placeSnakes(world: World): SnakeSpot[] {
  const rng = mulberry32(world.seed ^ 0x2c1b3c6d);
  const out: SnakeSpot[] = [];
  for (let i = 0; i < 4000 && out.length < COUNT; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 12);
    const z = (rng() * 2 - 1) * (WORLD_HALF - 12);
    const h = world.heightAt(x, z);
    if (h < WATER_LEVEL + 0.4 || h > 8) continue;
    if (Math.hypot(x - world.wreck.x, z - world.wreck.z) < 20) continue;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 14)) continue;
    // vipers like the forest edge
    if (world.detail(x, z) < 0.35 && rng() < 0.6) continue;
    out.push({ x, z, r: rng() * Math.PI * 2 });
  }
  return out;
}

function Snake({ spot, world, geo, mats }: { spot: SnakeSpot; world: World; geo: ReturnType<typeof useGeos>; mats: ReturnType<typeof useMats> }) {
  const root = useRef<Group>(null);
  const head = useRef<Group>(null);
  const tongue = useRef<Group>(null);
  const me = useMemo(() => createCreature('snake', spot.x, spot.z), [spot]);
  useEffect(creatureSlot(me), [me]);
  const st = useRef({ mode: 'coiled' as 'coiled' | 'alert' | 'strike' | 'cooldown' | 'dead', t: 0, rear: 0, lunge: 0, facing: spot.r, bit: false });
  const y = useMemo(() => world.heightAt(spot.x, spot.z), [world, spot]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    const g = root.current;
    if (!g) return;
    const dx = playerPos.x - spot.x;
    const dz = playerPos.z - spot.z;
    const dist = Math.hypot(dx, dz);
    g.visible = dist < VISIBLE && run.phase !== 'intro';
    if (!g.visible) {
      me.danger = 0;
      me.windup = false;
      return;
    }
    s.t += dt;
    const playing = run.phase === 'play';

    if (me.pendingHit > 0 && s.mode !== 'dead') {
      me.pendingHit = 0;
      s.mode = 'dead';
      s.t = 0;
      me.alive = false;
      run.kills.snake++;
      sfxHit();
      toast('Viper killed.');
      emit();
    }

    switch (s.mode) {
      case 'coiled':
        if (playing && dist < 4.6) {
          s.mode = 'alert';
          s.t = 0;
          sfxHiss();
        }
        break;
      case 'alert':
        s.facing = Math.atan2(dx, dz);
        if (dist > 6.5) {
          s.mode = 'coiled';
        } else if (s.t > 0.75 && dist < 2.7) {
          s.mode = 'strike';
          s.t = 0;
          s.bit = false;
        }
        break;
      case 'strike':
        if (!s.bit && s.t > 0.09) {
          s.bit = true;
          if (dist < 2.8 && combat.invuln <= 0 && playing) {
            damage(10, 'snake');
            if (!run.poisoned) {
              run.poisoned = true;
              toast('Venom! Use a med kit or make a poultice from herbs.');
              emit();
            }
          }
        }
        if (s.t > 0.35) {
          s.mode = 'cooldown';
          s.t = 0;
        }
        break;
      case 'cooldown':
        if (s.t > 2.2) {
          s.mode = dist < 4.6 ? 'alert' : 'coiled';
          s.t = 0;
          if (s.mode === 'alert') sfxHiss();
        }
        break;
      case 'dead':
        break;
    }

    // creature entry
    me.windup = s.mode === 'alert' && s.t > 0.25 && dist < 3.5;
    me.danger = s.mode === 'dead' ? 0 : s.mode === 'coiled' ? 0 : 0.55 + (me.windup ? 0.4 : 0);

    // animation
    const rearTarget = s.mode === 'alert' || s.mode === 'strike' ? 1 : 0;
    s.rear += (rearTarget - s.rear) * Math.min(1, dt * 8);
    const lungeTarget = s.mode === 'strike' ? Math.sin(Math.min(1, s.t / 0.35) * Math.PI) : 0;
    s.lunge = lungeTarget;
    g.position.set(spot.x, y + (s.mode === 'dead' ? -0.05 : 0), spot.z);
    let d = s.facing - g.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g.rotation.y += d * Math.min(1, dt * 6);
    g.rotation.z = s.mode === 'dead' ? Math.min(Math.PI, g.rotation.z + dt * 6) : 0;
    if (head.current) {
      const t = state.clock.elapsedTime;
      const sway = s.mode === 'alert' ? Math.sin(t * 5) * 0.06 : Math.sin(t * 1.2 + spot.r) * 0.02;
      head.current.position.set(0.06 + sway, 0.32 + s.rear * 0.22, 0.18 + s.rear * 0.05 + s.lunge * 0.9);
      head.current.rotation.x = -0.15 + s.rear * 0.1 - s.lunge * 0.3;
    }
    if (tongue.current) {
      const flick = s.mode !== 'dead' && Math.sin(state.clock.elapsedTime * (s.mode === 'alert' ? 16 : 6) + spot.r) > 0.6;
      tongue.current.visible = flick;
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh geometry={geo.coil} material={mats.body} />
      {/* rearing neck segment links coil to head */}
      <group ref={head}>
        <mesh geometry={geo.head} material={mats.head} />
        <mesh geometry={geo.eye} material={mats.eye} position={[0.045, 0.03, 0.06]} />
        <mesh geometry={geo.eye} material={mats.eye} position={[-0.045, 0.03, 0.06]} />
        <group ref={tongue} position={[0, -0.01, 0.15]}>
          <mesh geometry={geo.tongue} material={mats.tongue} rotation-y={0.25} />
          <mesh geometry={geo.tongue} material={mats.tongue} rotation-y={-0.25} />
        </group>
      </group>
    </group>
  );
}

function useGeos() {
  return useMemo(() => {
    // flat, triangular viper head
    const head = new SphereGeometry(0.085, 10, 8);
    head.scale(0.95, 0.55, 1.35);
    const eye = new SphereGeometry(0.018, 6, 5);
    const tongue = new ConeGeometry(0.006, 0.09, 3);
    tongue.rotateX(Math.PI / 2);
    tongue.translate(0, 0, 0.045);
    return { coil: coilGeometry(), head, eye, tongue };
  }, []);
}

function useMats() {
  return useMemo(
    () => ({
      body: new MeshLambertMaterial({ vertexColors: true }),
      head: new MeshLambertMaterial({ color: '#5d5824' }),
      eye: new MeshBasicMaterial({ color: '#d9b62c' }),
      tongue: new MeshBasicMaterial({ color: '#b0222c' }),
    }),
    []
  );
}

export function Snakes({ world }: { world: World }) {
  const spots = useMemo(() => placeSnakes(world), [world]);
  const geo = useGeos();
  const mats = useMats();
  return (
    <>
      {spots.map((s, i) => (
        <Snake key={i} spot={s} world={world} geo={geo} mats={mats} />
      ))}
    </>
  );
}
