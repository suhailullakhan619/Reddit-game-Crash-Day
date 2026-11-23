import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Pickup } from './loot';
import { playerPos } from './shared';
import { combat, getVersion, ITEM_LABEL, run, subscribe, type ItemKind } from './state';
import { WATER_LEVEL, WORLD_HALF, type World } from './world';

// Item map. Shows loot, the wreck, campfires and the player — never the tiger or other threats.

const ITEM_COLOR: Record<ItemKind, string> = {
  wood: '#c08a52',
  stone: '#b9b6ab',
  berries: '#e0475f',
  water: '#5cc4f0',
  herb: '#b07ae6',
  medkit: '#ffffff',
  flare: '#ff9a3c',
  meat: '#a8443a',
};

const LEGEND: ItemKind[] = ['water', 'berries', 'wood', 'stone', 'herb', 'medkit', 'flare'];

const BG_RES = 320;
const SMALL_SPAN = 70; // world units shown across the corner map

// Paint the terrain once into an offscreen canvas (top-down, north up).
function renderTerrain(world: World) {
  const c = document.createElement('canvas');
  c.width = c.height = BG_RES;
  const g = c.getContext('2d')!;
  const img = g.createImageData(BG_RES, BG_RES);
  const step = (WORLD_HALF * 2) / BG_RES;
  for (let py = 0; py < BG_RES; py++) {
    for (let px = 0; px < BG_RES; px++) {
      const x = -WORLD_HALF + (px + 0.5) * step;
      const z = -WORLD_HALF + (py + 0.5) * step;
      const h = world.heightAt(x, z);
      const d = world.detail(x, z);
      let r: number;
      let gg: number;
      let b: number;
      if (h < WATER_LEVEL) {
        r = 46;
        gg = 110;
        b = 120;
      } else if (Math.abs(x - world.riverX(z)) < 7) {
        r = 150;
        gg = 132;
        b = 92;
      } else if (h > 9) {
        const k = Math.min(1, (h - 9) / 10);
        r = 110 + k * 40;
        gg = 112 + k * 35;
        b = 96 + k * 35;
      } else {
        r = 58 + d * 30;
        gg = 96 + d * 34;
        b = 50 + d * 14;
      }
      // shade slopes for relief
      const hx = world.heightAt(x + step, z) - h;
      const shade = Math.max(-28, Math.min(28, -hx * 22));
      const i = (py * BG_RES + px) * 4;
      img.data[i] = r + shade;
      img.data[i + 1] = gg + shade;
      img.data[i + 2] = b + shade;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // forest canopy dots
  g.fillStyle = 'rgba(22, 52, 26, 0.55)';
  for (const t of world.trees) {
    const px = ((t.x + WORLD_HALF) / (WORLD_HALF * 2)) * BG_RES;
    const py = ((t.z + WORLD_HALF) / (WORLD_HALF * 2)) * BG_RES;
    g.beginPath();
    g.arc(px, py, 1.6 * t.s + 0.6, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

// supply crate: red square with a white cross, ringed so it stands out from loot dots
function drawCrate(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save();
  g.fillStyle = '#d93a2b';
  g.strokeStyle = '#f2ead8';
  g.lineWidth = r * 0.22;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.strokeRect(x - r, y - r, r * 2, r * 2);
  g.beginPath();
  g.moveTo(x - r * 0.55, y);
  g.lineTo(x + r * 0.55, y);
  g.moveTo(x, y - r * 0.55);
  g.lineTo(x, y + r * 0.55);
  g.stroke();
  g.restore();
}

// shelter: small brown roof triangle
function drawShelter(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y + r * 0.7);
  g.lineTo(x - r, y + r * 0.7);
  g.closePath();
  g.fillStyle = '#c9a26b';
  g.fill();
}

function drawWreck(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = '#f2ead8';
  g.lineWidth = 2 * s;
  g.lineCap = 'round';
  // little plane glyph
  g.beginPath();
  g.moveTo(0, -6 * s);
  g.lineTo(0, 6 * s);
  g.moveTo(-6 * s, -1 * s);
  g.lineTo(6 * s, -1 * s);
  g.moveTo(-3 * s, 5 * s);
  g.lineTo(3 * s, 5 * s);
  g.stroke();
  g.restore();
}

function drawItem(g: CanvasRenderingContext2D, kind: ItemKind, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = ITEM_COLOR[kind];
  g.fill();
  g.lineWidth = Math.max(1, r * 0.35);
  g.strokeStyle = 'rgba(10, 14, 10, 0.85)';
  g.stroke();
  if (kind === 'medkit') {
    g.fillStyle = '#d2392f';
    g.fillRect(x - r * 0.55, y - r * 0.18, r * 1.1, r * 0.36);
    g.fillRect(x - r * 0.18, y - r * 0.55, r * 0.36, r * 1.1);
  }
}

function drawPlayer(g: CanvasRenderingContext2D, x: number, y: number, angle: number, s: number) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(0, -8 * s);
  g.lineTo(5.5 * s, 6 * s);
  g.lineTo(0, 3 * s);
  g.lineTo(-5.5 * s, 6 * s);
  g.closePath();
  g.fillStyle = '#f0a35e';
  g.fill();
  g.lineWidth = 1.5 * s;
  g.strokeStyle = '#1b1408';
  g.stroke();
  g.restore();
}

export function Minimap({ world, pickups }: { world: World; pickups: Pickup[] }) {
  useSyncExternalStore(subscribe, getVersion);
  const [open, setOpen] = useState(false);
  const small = useRef<HTMLCanvasElement>(null);
  const big = useRef<HTMLCanvasElement>(null);
  const terrain = useMemo(() => renderTerrain(world), [world]);

  useEffect(() => {
    let alive = true;
    const toCanvas = (wx: number, wz: number, size: number) => [
      ((wx + WORLD_HALF) / (WORLD_HALF * 2)) * size,
      ((wz + WORLD_HALF) / (WORLD_HALF * 2)) * size,
    ];

    const drawSmall = () => {
      const c = small.current;
      if (!c) return;
      const g = c.getContext('2d')!;
      const W = c.width;
      const scale = W / SMALL_SPAN; // px per world unit
      g.clearRect(0, 0, W, W);
      g.save();
      g.beginPath();
      g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = '#1d2a20';
      g.fillRect(0, 0, W, W);
      // heading-up: rotate the world so the camera's forward points up the map
      g.translate(W / 2, W / 2);
      const fx = -Math.sin(combat.camYaw);
      const fz = -Math.cos(combat.camYaw);
      g.rotate(-Math.PI / 2 - Math.atan2(fz, fx));
      g.scale(scale, scale);
      g.translate(-playerPos.x, -playerPos.z);
      g.imageSmoothingEnabled = true;
      g.drawImage(terrain, -WORLD_HALF, -WORLD_HALF, WORLD_HALF * 2, WORLD_HALF * 2);
      drawWreck(g, world.wreck.x, world.wreck.z, 0.45);
      for (const f of run.campfires) {
        g.beginPath();
        g.arc(f.x, f.z, 1.3, 0, Math.PI * 2);
        g.fillStyle = f.out ? '#7d7a70' : '#ffb347';
        g.fill();
      }
      for (const h of run.shelters) drawShelter(g, h.x, h.z, 1.8);
      for (const d of run.drops) if (!d.opened) drawCrate(g, d.x, d.z, 2.4);
      for (const p of pickups) {
        if (p.taken) continue;
        if (Math.abs(p.x - playerPos.x) > SMALL_SPAN * 0.75 || Math.abs(p.z - playerPos.z) > SMALL_SPAN * 0.75) continue;
        drawItem(g, p.kind, p.x, p.z, 1.6);
      }
      g.restore();
      // player is always centered, pointing in their facing relative to the camera
      drawPlayer(g, W / 2, W / 2, combat.camYaw - combat.facing + Math.PI, W / 130);
      // north tick
      g.save();
      g.translate(W / 2, W / 2);
      const north = -Math.PI / 2 - Math.atan2(fz, fx);
      g.rotate(north);
      g.fillStyle = '#f2ead8';
      g.font = `bold ${Math.round(W / 11)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText('N', 0, -W / 2 + W / 9);
      g.restore();
    };

    const drawBig = () => {
      const c = big.current;
      if (!c) return;
      const g = c.getContext('2d')!;
      const W = c.width;
      g.clearRect(0, 0, W, W);
      g.imageSmoothingEnabled = true;
      g.drawImage(terrain, 0, 0, W, W);
      const s = W / 400;
      const [wx, wy] = toCanvas(world.wreck.x, world.wreck.z, W);
      drawWreck(g, wx!, wy!, s * 1.6);
      for (const f of run.campfires) {
        const [x, y] = toCanvas(f.x, f.z, W);
        g.beginPath();
        g.arc(x!, y!, 5 * s, 0, Math.PI * 2);
        g.fillStyle = f.out ? '#7d7a70' : '#ffb347';
        g.fill();
      }
      for (const h of run.shelters) {
        const [x, y] = toCanvas(h.x, h.z, W);
        drawShelter(g, x!, y!, 6 * s);
      }
      for (const d of run.drops) {
        if (d.opened) continue;
        const [x, y] = toCanvas(d.x, d.z, W);
        drawCrate(g, x!, y!, 8 * s);
      }
      for (const p of pickups) {
        if (p.taken) continue;
        const [x, y] = toCanvas(p.x, p.z, W);
        drawItem(g, p.kind, x!, y!, 4.2 * s);
      }
      const [px, py] = toCanvas(playerPos.x, playerPos.z, W);
      drawPlayer(g, px!, py!, Math.PI - combat.facing, s * 1.5);
    };

    // skip canvas work when nothing moved (forced refresh every ~1.2 s for pickups/campfires)
    let last = '';
    let idle = 0;
    const tick = () => {
      if (!alive) return;
      const key = `${playerPos.x.toFixed(1)},${playerPos.z.toFixed(1)},${combat.camYaw.toFixed(2)},${combat.facing.toFixed(2)}`;
      if (key === last && ++idle < 10) return;
      last = key;
      idle = 0;
      drawSmall();
      if (open) drawBig();
    };
    tick();
    const id = window.setInterval(tick, 120);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [terrain, world, pickups, open]);

  if (run.phase !== 'play') return null;

  const remaining = LEGEND.map((k) => [k, pickups.filter((p) => p.kind === k && !p.taken).length] as const).filter(([, n]) => n > 0);

  return (
    <>
      <button className="minimap" onClick={() => setOpen(true)} aria-label="Open map">
        <canvas ref={small} width={240} height={240} />
      </button>
      {open && (
        <div className="bigmap" onClick={() => setOpen(false)}>
          <div className="bigmap-card" onClick={(e) => e.stopPropagation()}>
            <div className="bigmap-head">
              <span>Map · items nearby</span>
              <button className="chip" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <canvas ref={big} width={800} height={800} className="bigmap-canvas" />
            <div className="legend">
              {remaining.map(([k, n]) => (
                <span key={k} className="legend-item">
                  <i style={{ background: ITEM_COLOR[k] }} />
                  {ITEM_LABEL[k]} <b>{n}</b>
                </span>
              ))}
              <span className="legend-item">
                <i className="legend-you" />
                You
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
