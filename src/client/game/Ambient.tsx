import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, type Points, type PointsMaterial } from 'three';
import { atmo, fxTime } from './fx';
import { playerPos } from './shared';
import { mulberry32 } from './world';

const COUNT = 90;
const SPAN = 26;
// ground height under each particle is refreshed on 1 of every HEIGHT_EVERY frames (staggered)
const HEIGHT_EVERY = 4;
const FIREFLY = new Color('#d8ff7a');
const POLLEN = new Color('#fff6d8');

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

// Fireflies at night, drifting pollen by day. Particles wrap around the player.
export function Ambient({ heightAt }: { heightAt: (x: number, z: number) => number }) {
  const ref = useRef<Points<BufferGeometry, PointsMaterial>>(null);
  const data = useMemo(() => {
    const rng = mulberry32(4242);
    const seeds = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT * 4; i++) seeds[i] = rng();
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(COUNT * 3), 3));
    return { seeds, geo, tex: glowTexture(), ground: new Float32Array(COUNT).fill(Number.NaN), frame: 0, night: false };
  }, []);

  useFrame(() => {
    const pts = ref.current;
    if (!pts) return;
    const t = fxTime.value;
    const night = atmo.night;
    const pos = data.geo.attributes.position!;
    const slot = data.frame++ % HEIGHT_EVERY;
    for (let i = 0; i < COUNT; i++) {
      const s0 = data.seeds[i * 4]!;
      const s1 = data.seeds[i * 4 + 1]!;
      const s2 = data.seeds[i * 4 + 2]!;
      const s3 = data.seeds[i * 4 + 3]!;
      // anchor on a grid that scrolls with the player so particles never run out
      let x = s0 * SPAN + Math.sin(t * (0.3 + s2 * 0.4) + s3 * 9) * 1.2;
      let z = s1 * SPAN + Math.cos(t * (0.25 + s3 * 0.4) + s2 * 7) * 1.2;
      x = playerPos.x + ((((x - playerPos.x) % SPAN) + SPAN * 1.5) % SPAN) - SPAN / 2;
      z = playerPos.z + ((((z - playerPos.z) % SPAN) + SPAN * 1.5) % SPAN) - SPAN / 2;
      let ground = data.ground[i]!;
      if (i % HEIGHT_EVERY === slot || Number.isNaN(ground)) {
        ground = heightAt(x, z);
        data.ground[i] = ground;
      }
      const y = ground + 0.6 + s2 * 2.2 + Math.sin(t * 0.8 + s0 * 20) * 0.3;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    const m = pts.material;
    const blink = 0.75 + Math.sin(t * 3) * 0.25;
    const isNight = night > 0.3;
    if (isNight !== data.night || data.frame === 1) {
      data.night = isNight;
      m.color.copy(isNight ? FIREFLY : POLLEN);
      m.size = isNight ? 0.32 : 0.09;
    }
    m.opacity = isNight ? Math.min(1, (night - 0.3) * 2) * blink : 0.5 * (1 - night);
  });

  return (
    <points ref={ref} geometry={data.geo} frustumCulled={false}>
      <pointsMaterial map={data.tex} transparent depthWrite={false} blending={AdditiveBlending} sizeAttenuation />
    </points>
  );
}
