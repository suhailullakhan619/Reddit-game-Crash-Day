import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  MeshLambertMaterial,
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  type Group,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeStatic } from './shared';

// A procedurally built survivor (~1.78 m) with a simple hierarchical rig.
// Two-bone limbs (hip/knee, shoulder/elbow) give a natural walk without skinning.

export type SurvivorPose = {
  walk: number; // gait phase (radians)
  speed: number; // 0 idle .. 1 walk .. 1.6 run
  swim: boolean;
  time: number;
  attack?: number; // 0 = none, else swing progress 0..1
  dodge?: number; // 0 = none, else roll progress 0..1
};

export type SurvivorHandle = { pose: (p: SurvivorPose) => void };

const COLORS = {
  skin: '#c58c66',
  skinShade: '#a8714f',
  hair: '#2b1d14',
  shirt: '#b8552e', // faded rust work shirt, reads well against green
  shirtDark: '#8e3f22',
  undershirt: '#d9d2c0',
  pants: '#3a4658',
  belt: '#3b2a1c',
  boot: '#4a3423',
  sole: '#1f1a16',
  pack: '#5e6b45',
  packDark: '#434d31',
  mat: '#8a5a2b',
  strap: '#2f2a22',
  eye: '#1a1410',
};

// Lambert materials: the stylized look needs no PBR, and Lambert is far cheaper on phones.
function mat(color: string) {
  return new MeshLambertMaterial({ color: new Color(color) });
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}

// Faded red flannel: two crossing stripe sets over a rust base, with dirt smudges.
function flannel() {
  return canvasTex(
    128,
    128,
    (g) => {
      g.fillStyle = '#9c3b22';
      g.fillRect(0, 0, 128, 128);
      g.globalAlpha = 0.55;
      g.fillStyle = '#2a1712';
      for (const p of [0, 64]) {
        g.fillRect(p + 8, 0, 18, 128);
        g.fillRect(0, p + 8, 128, 18);
      }
      g.globalAlpha = 0.35;
      g.fillStyle = '#e0a070';
      for (const p of [0, 64]) {
        g.fillRect(p + 40, 0, 3, 128);
        g.fillRect(0, p + 40, 128, 3);
      }
      g.globalAlpha = 0.18;
      g.fillStyle = '#3b2a18';
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        g.ellipse(Math.random() * 128, Math.random() * 128, 4 + Math.random() * 10, 3 + Math.random() * 6, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    },
    3,
    2
  );
}

// Worn denim: diagonal twill lines over blue noise, lighter at the knees.
function denim() {
  return canvasTex(
    128,
    128,
    (g) => {
      g.fillStyle = '#34445c';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 1600; i++) {
        const v = 40 + Math.random() * 50;
        g.fillStyle = 'rgba(' + v + ',' + (v + 18) + ',' + (v + 45) + ',0.35)';
        g.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
      }
      g.strokeStyle = 'rgba(150, 170, 200, 0.14)';
      g.lineWidth = 1;
      for (let x = -128; x < 128; x += 4) {
        g.beginPath();
        g.moveTo(x, 128);
        g.lineTo(x + 128, 0);
        g.stroke();
      }
    },
    2,
    2
  );
}

// Olive canvas backpack fabric.
function canvasCloth() {
  return canvasTex(
    64,
    64,
    (g) => {
      g.fillStyle = '#5b6843';
      g.fillRect(0, 0, 64, 64);
      for (let y = 0; y < 64; y += 2) {
        g.fillStyle = y % 4 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
        g.fillRect(0, y, 64, 1);
      }
      for (let x = 0; x < 64; x += 2) {
        g.fillStyle = 'rgba(0,0,0,0.06)';
        g.fillRect(x, 0, 1, 64);
      }
    },
    3,
    3
  );
}

function lathe(points: [number, number][], segments = 12) {
  return new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    segments
  );
}

export type Weapon = 'none' | 'knife' | 'spear';

export const Survivor = forwardRef<SurvivorHandle, { shadows: boolean; weapon: Weapon; bow?: boolean }>(function Survivor(
  { shadows, weapon, bow = false },
  ref,
) {
  const hips = useRef<Group>(null);
  const spine = useRef<Group>(null);
  const head = useRef<Group>(null);
  const thighL = useRef<Group>(null);
  const thighR = useRef<Group>(null);
  const shinL = useRef<Group>(null);
  const shinR = useRef<Group>(null);
  const upperL = useRef<Group>(null);
  const upperR = useRef<Group>(null);
  const foreL = useRef<Group>(null);
  const foreR = useRef<Group>(null);

  const m = useMemo(
    () => ({
      skin: mat(COLORS.skin),
      skinShade: mat(COLORS.skinShade),
      hair: mat(COLORS.hair),
      shirt: new MeshLambertMaterial({ map: flannel() }),
      shirtDark: mat(COLORS.shirtDark),
      under: mat(COLORS.undershirt),
      pants: new MeshLambertMaterial({ map: denim() }),
      belt: mat(COLORS.belt),
      boot: mat(COLORS.boot),
      sole: mat(COLORS.sole),
      pack: new MeshLambertMaterial({ map: canvasCloth() }),
      packDark: mat(COLORS.packDark),
      matRoll: mat(COLORS.mat),
      strap: mat(COLORS.strap),
      eye: mat(COLORS.eye),
      stone: mat('#77756c'),
      steel: mat('#8e949a'),
    }),
    []
  );

  const g = useMemo(() => {
    // torso: chest wider than waist, slightly flattened front-to-back
    const torso = lathe(
      [
        [0.0, 0.0],
        [0.15, 0.0],
        [0.165, 0.08],
        [0.17, 0.2],
        [0.19, 0.32],
        [0.2, 0.42],
        [0.19, 0.5],
        [0.13, 0.56],
        [0.06, 0.585],
        [0.0, 0.59],
      ],
      14
    );
    torso.scale(1.05, 1, 0.68);
    const pelvis = lathe(
      [
        [0.0, -0.02],
        [0.13, -0.02],
        [0.16, 0.05],
        [0.155, 0.14],
        [0.0, 0.14],
      ],
      12
    );
    pelvis.scale(1.05, 1, 0.72);
    const collar = new CylinderGeometry(0.075, 0.1, 0.06, 10, 1, true);
    const neck = new CylinderGeometry(0.052, 0.06, 0.12, 8);

    // head: egg-shaped skull, jaw, nose, ears merged
    const skull = new SphereGeometry(0.115, 14, 12);
    skull.scale(0.9, 1.08, 1.0);
    const jaw = new SphereGeometry(0.085, 10, 8);
    jaw.scale(0.95, 0.75, 0.95);
    jaw.translate(0, -0.06, 0.02);
    const nose = new SphereGeometry(0.022, 6, 5);
    nose.scale(0.8, 1.2, 1.1);
    nose.translate(0, -0.01, 0.112);
    const earL = new SphereGeometry(0.025, 6, 5);
    earL.scale(0.45, 1, 0.8);
    earL.translate(0.103, -0.005, 0);
    const earR = earL.clone();
    earR.translate(-0.206, 0, 0);
    const headGeo = mergeGeometries([skull, jaw, nose, earL, earR].map(clean))!;

    // short messy hair: cap + a few tufts
    const cap = new SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    cap.scale(0.93, 1.05, 1.06);
    cap.translate(0, 0.012, -0.008);
    const tufts: BufferGeometry[] = [cap];
    for (let i = 0; i < 7; i++) {
      const t = new IcosahedronGeometry(0.04, 0);
      const a = (i / 7) * Math.PI * 2;
      t.translate(Math.cos(a) * 0.07, 0.1 + (i % 2) * 0.015, Math.sin(a) * 0.07 - 0.01);
      tufts.push(t);
    }
    const hairGeo = mergeGeometries(tufts.map(clean))!;
    hairGeo.computeVertexNormals();

    const eye = new SphereGeometry(0.014, 6, 5);
    const brow = new CapsuleGeometry(0.008, 0.035, 2, 4);
    brow.rotateZ(Math.PI / 2);

    // limbs: tapered capsules pivoting at their top
    const thigh = new CapsuleGeometry(0.075, 0.33, 4, 10);
    thigh.scale(1, 1, 0.95);
    thigh.translate(0, -0.2, 0);
    const shin = new CapsuleGeometry(0.058, 0.34, 4, 10);
    shin.translate(0, -0.2, 0);
    const knee = new SphereGeometry(0.068, 8, 6);
    const boot = new CapsuleGeometry(0.058, 0.13, 4, 8);
    boot.rotateX(Math.PI / 2);
    boot.scale(1.05, 0.8, 1);
    boot.translate(0, -0.42, 0.04);
    const sole = new CylinderGeometry(0.06, 0.06, 0.03, 10);
    sole.scale(1.05, 1, 2.0);
    sole.translate(0, -0.465, 0.045);

    const upper = new CapsuleGeometry(0.058, 0.2, 4, 10);
    upper.translate(0, -0.14, 0);
    const sleeveCuff = new CylinderGeometry(0.066, 0.066, 0.05, 10);
    sleeveCuff.translate(0, -0.27, 0);
    const fore = new CapsuleGeometry(0.044, 0.2, 4, 8);
    fore.translate(0, -0.13, 0);
    const hand = new SphereGeometry(0.048, 8, 6);
    hand.scale(0.7, 1.15, 1);
    hand.translate(0, -0.3, 0.005);

    // backpack: rounded body, top flap, side pocket, rolled mat
    const packBody = new CapsuleGeometry(0.14, 0.2, 4, 10);
    packBody.scale(1.15, 1, 0.6);
    const flap = new SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    flap.scale(1.08, 0.45, 0.62);
    flap.translate(0, 0.2, 0);
    const pocket = new CapsuleGeometry(0.06, 0.08, 3, 8);
    pocket.translate(0, -0.05, -0.08);
    const roll = new CylinderGeometry(0.07, 0.07, 0.42, 10);
    roll.rotateZ(Math.PI / 2);
    roll.translate(0, 0.3, -0.01);
    const strap = new CylinderGeometry(0.105, 0.105, 0.025, 12, 1, true, -0.4, 0.8);

    return {
      torso,
      pelvis,
      collar,
      neck,
      headGeo,
      hairGeo,
      eye,
      brow,
      thigh,
      shin,
      knee,
      boot,
      sole,
      upper,
      sleeveCuff,
      fore,
      hand,
      packBody,
      flap,
      pocket,
      roll,
      strap,
    };
  }, []);

  useImperativeHandle(ref, () => ({
    pose({ walk, speed, swim, time, attack = 0, dodge = 0 }) {
      const s = Math.min(1.6, speed);
      const run = Math.max(0, s - 1) / 0.6; // 0 walk .. 1 sprint
      const amp = Math.min(1, s);
      const sw = Math.sin(walk);
      const cw = Math.cos(walk);

      if (swim) {
        // breaststroke-ish: body pitched forward, arms sweep, legs kick
        if (hips.current) {
          hips.current.position.y = 0.88;
          hips.current.rotation.x = 1.1;
        }
        const stroke = Math.sin(time * 4);
        upperL.current?.rotation.set(-2.4 + stroke * 0.5, 0, -0.5 - stroke * 0.3);
        upperR.current?.rotation.set(-2.4 + stroke * 0.5, 0, 0.5 + stroke * 0.3);
        foreL.current?.rotation.set(-0.4 - stroke * 0.3, 0, 0);
        foreR.current?.rotation.set(-0.4 - stroke * 0.3, 0, 0);
        thighL.current?.rotation.set(Math.sin(time * 6) * 0.35, 0, 0);
        thighR.current?.rotation.set(-Math.sin(time * 6) * 0.35, 0, 0);
        shinL.current?.rotation.set(0.4, 0, 0);
        shinR.current?.rotation.set(0.4, 0, 0);
        spine.current?.rotation.set(-0.2, 0, 0);
        head.current?.rotation.set(-0.7, 0, 0);
        return;
      }

      const legSwing = sw * (0.55 + run * 0.35) * amp;
      // knee bends while the leg swings forward (recovery phase)
      const kneeL = Math.max(0, -cw) * (0.9 + run * 0.7) * amp + 0.05;
      const kneeR = Math.max(0, cw) * (0.9 + run * 0.7) * amp + 0.05;
      thighL.current?.rotation.set(-legSwing, 0, 0);
      thighR.current?.rotation.set(legSwing, 0, 0);
      shinL.current?.rotation.set(kneeL, 0, 0);
      shinR.current?.rotation.set(kneeR, 0, 0);

      const armSwing = sw * (0.45 + run * 0.4) * amp;
      upperL.current?.rotation.set(armSwing, 0, -0.08);
      upperR.current?.rotation.set(-armSwing, 0, 0.08);
      foreL.current?.rotation.set(-0.25 - run * 0.9 - Math.max(0, armSwing) * 0.5, 0, 0);
      foreR.current?.rotation.set(-0.25 - run * 0.9 - Math.max(0, -armSwing) * 0.5, 0, 0);

      const breathe = Math.sin(time * 1.6) * 0.008 * (1 - amp);
      if (hips.current) {
        hips.current.position.y = 0.9 + Math.abs(cw) * 0.045 * amp - 0.02 * run + breathe;
        hips.current.rotation.set(0, sw * 0.1 * amp, 0);
      }
      spine.current?.rotation.set(0.06 + run * 0.2 + breathe * 2, -sw * 0.16 * amp, sw * 0.03 * amp);
      // idle: occasional glance around
      const look = amp < 0.2 ? Math.sin(time * 0.5) * 0.35 * Math.max(0, Math.sin(time * 0.23)) : 0;
      head.current?.rotation.set(-0.04 - run * 0.15, look + sw * 0.08 * amp, 0);

      if (attack > 0) {
        // wind back then thrust forward with the right arm
        const k = attack < 0.35 ? attack / 0.35 : 1 - (attack - 0.35) / 0.65;
        const thrust = attack < 0.35 ? 0.9 * k : -1.7 * Math.sin(Math.min(1, (attack - 0.35) / 0.3) * Math.PI * 0.5) * (1 - Math.max(0, attack - 0.65) / 0.35);
        upperR.current?.rotation.set(thrust, 0, 0.15);
        foreR.current?.rotation.set(-0.2 - k * 0.4, 0, 0);
        spine.current?.rotation.set(0.15, attack < 0.35 ? 0.35 * k : -0.3, 0);
      }
      if (dodge > 0) {
        const k = Math.sin(dodge * Math.PI);
        if (hips.current) hips.current.position.y -= k * 0.35;
        spine.current?.rotation.set(0.25 + k * 0.6, 0, 0);
        thighL.current?.rotation.set(-k * 1.1, 0, 0);
        thighR.current?.rotation.set(-k * 0.7, 0, 0);
        shinL.current?.rotation.set(k * 1.6, 0, 0);
        shinR.current?.rotation.set(k * 1.4, 0, 0);
        upperL.current?.rotation.set(-k * 0.8, 0, -0.3);
        upperR.current?.rotation.set(-k * 0.8, 0, 0.3);
      }
    },
  }));

  const cs = shadows;

  // each rig segment is rigid: merge its meshes (plain colours into one vertex-coloured draw)
  useLayoutEffect(() => (hips.current ? mergeStatic(hips.current) : undefined), [weapon, bow, cs]);

  return (
    <group ref={hips} position-y={0.9}>
      {/* pelvis + belt */}
      <mesh geometry={g.pelvis} material={m.pants} position-y={-0.08} castShadow={cs} />
      <mesh position-y={0.045} material={m.belt}>
        <cylinderGeometry args={[0.168, 0.168, 0.045, 14]} />
      </mesh>

      <group ref={spine} position-y={0.02}>
        <mesh geometry={g.torso} material={m.shirt} castShadow={cs} />
        {/* open collar + undershirt peek */}
        <mesh geometry={g.collar} material={m.shirtDark} position-y={0.6} />
        <mesh position={[0, 0.5, 0.1]} scale={[1, 1.3, 0.4]} material={m.under}>
          <sphereGeometry args={[0.06, 8, 6]} />
        </mesh>
        {/* pockets */}
        <mesh position={[0.09, 0.38, 0.125]} rotation-x={-0.15} material={m.shirtDark}>
          <boxGeometry args={[0.08, 0.08, 0.012]} />
        </mesh>
        <mesh position={[-0.09, 0.38, 0.125]} rotation-x={-0.15} material={m.shirtDark}>
          <boxGeometry args={[0.08, 0.08, 0.012]} />
        </mesh>

        {/* backpack + straps */}
        <group position={[0, 0.3, -0.2]} rotation-x={0.08}>
          <mesh geometry={g.packBody} material={m.pack} castShadow={cs} />
          <mesh geometry={g.flap} material={m.packDark} />
          <mesh geometry={g.pocket} material={m.packDark} />
          <mesh geometry={g.roll} material={m.matRoll} castShadow={cs} />
        </group>
        <mesh geometry={g.strap} material={m.strap} position={[0.1, 0.42, -0.02]} rotation={[0, 0, Math.PI / 2]} scale={[1.1, 1, 1.25]} />
        <mesh geometry={g.strap} material={m.strap} position={[-0.1, 0.42, -0.02]} rotation={[0, 0, Math.PI / 2]} scale={[1.1, 1, 1.25]} />

        {/* neck + head */}
        <mesh geometry={g.neck} material={m.skinShade} position-y={0.63} />
        <group ref={head} position-y={0.78}>
          <mesh geometry={g.headGeo} material={m.skin} castShadow={cs} />
          <mesh geometry={g.hairGeo} material={m.hair} />
          <mesh geometry={g.eye} material={m.eye} position={[0.04, 0.012, 0.098]} />
          <mesh geometry={g.eye} material={m.eye} position={[-0.04, 0.012, 0.098]} />
          <mesh geometry={g.brow} material={m.hair} position={[0.042, 0.042, 0.1]} rotation-z={0.12} />
          <mesh geometry={g.brow} material={m.hair} position={[-0.042, 0.042, 0.1]} rotation-z={-0.12} />
          {/* stubble shadow on the jaw */}
          <mesh position={[0, -0.065, 0.03]} scale={[0.86, 0.62, 0.86]} material={m.skinShade}>
            <sphereGeometry args={[0.09, 10, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55]} />
          </mesh>
        </group>

        {/* arms: shoulder -> elbow */}
        <group ref={upperL} position={[0.215, 0.5, 0]}>
          <mesh geometry={g.upper} material={m.shirt} castShadow={cs} />
          <mesh geometry={g.sleeveCuff} material={m.shirtDark} />
          <group ref={foreL} position-y={-0.29}>
            <mesh geometry={g.fore} material={m.skin} castShadow={cs} />
            <mesh geometry={g.hand} material={m.skinShade} />
            {bow && (
              // recurve bow held upright in the left hand, string toward the body
              // (arc in local XY with the grip at the hand; the group turns +X to forward +Z)
              <group position={[0, -0.26, 0]} rotation-y={-Math.PI / 2}>
                <mesh material={m.belt} castShadow={cs} rotation-z={-0.3 * Math.PI} position-x={-0.75}>
                  <torusGeometry args={[0.75, 0.018, 4, 16, Math.PI * 0.6]} />
                </mesh>
                <mesh position-x={-0.31} material={m.under}>
                  <cylinderGeometry args={[0.004, 0.004, 1.21, 3]} />
                </mesh>
              </group>
            )}
          </group>
        </group>
        <group ref={upperR} position={[-0.215, 0.5, 0]}>
          <mesh geometry={g.upper} material={m.shirt} castShadow={cs} />
          <mesh geometry={g.sleeveCuff} material={m.shirtDark} />
          <group ref={foreR} position-y={-0.29}>
            <mesh geometry={g.fore} material={m.skin} castShadow={cs} />
            <mesh geometry={g.hand} material={m.skinShade} />
            {weapon === 'spear' && (
              <group position={[0, -0.3, 0.02]} rotation-x={Math.PI / 2}>
                <mesh position-y={0.35} material={m.belt} castShadow={cs}>
                  <cylinderGeometry args={[0.022, 0.026, 1.7, 6]} />
                </mesh>
                <mesh position-y={1.3} material={m.stone}>
                  <coneGeometry args={[0.05, 0.22, 5]} />
                </mesh>
              </group>
            )}
            {weapon === 'knife' && (
              <group position={[0, -0.32, 0.03]} rotation-x={Math.PI / 2}>
                <mesh position-y={0.02} material={m.belt}>
                  <boxGeometry args={[0.03, 0.1, 0.03]} />
                </mesh>
                <mesh position-y={0.14} material={m.steel}>
                  <boxGeometry args={[0.012, 0.16, 0.035]} />
                </mesh>
              </group>
            )}
          </group>
        </group>
      </group>

      {/* legs: hip -> knee */}
      <group ref={thighL} position={[0.09, -0.04, 0]}>
        <mesh geometry={g.thigh} material={m.pants} castShadow={cs} />
        <group ref={shinL} position-y={-0.4}>
          <mesh geometry={g.knee} material={m.pants} />
          <mesh geometry={g.shin} material={m.pants} castShadow={cs} />
          <mesh geometry={g.boot} material={m.boot} castShadow={cs} />
          <mesh geometry={g.sole} material={m.sole} />
        </group>
      </group>
      <group ref={thighR} position={[-0.09, -0.04, 0]}>
        <mesh geometry={g.thigh} material={m.pants} castShadow={cs} />
        <group ref={shinR} position-y={-0.4}>
          <mesh geometry={g.knee} material={m.pants} />
          <mesh geometry={g.shin} material={m.pants} castShadow={cs} />
          <mesh geometry={g.boot} material={m.boot} castShadow={cs} />
          <mesh geometry={g.sole} material={m.sole} />
        </group>
      </group>
    </group>
  );
});

// mergeGeometries needs identical attribute sets; keep only position + normal.
function clean(geo: BufferGeometry) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  return g;
}
