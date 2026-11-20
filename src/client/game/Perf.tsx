import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { dayPhase } from './Atmosphere';
import { gameClock } from './shared';

// Writes FPS / draw stats into DOM nodes directly (no React re-render per frame).
export function PerfProbe({ statsEl, clockEl }: { statsEl: HTMLElement | null; clockEl: HTMLElement | null }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, time: 0, worst: 0 });
  const gpu = useRef('');

  useEffect(() => {
    const ctx = gl.getContext();
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown GPU';
    gpu.current = raw.replace(/ANGLE \(|\)$/g, '').slice(0, 48);
  }, [gl]);

  useFrame((_, dt) => {
    const a = acc.current;
    a.frames++;
    a.time += dt;
    a.worst = Math.max(a.worst, dt);
    if (a.time >= 0.5) {
      const fps = a.frames / a.time;
      if (statsEl) {
        const info = gl.info.render;
        statsEl.textContent =
          `${fps.toFixed(0)} fps · worst ${(a.worst * 1000).toFixed(0)}ms · ` +
          `${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris · dpr ${gl.getPixelRatio().toFixed(2)}\n` +
          gpu.current;
      }
      if (clockEl) {
        const phase = dayPhase();
        const day = 1 + Math.floor((gameClock.startPhase + gameClock.elapsed / gameClock.dayLength));
        // phase 0 = 05:00, 1 = next 05:00
        const mins = Math.floor(((phase * 24 + 5) % 24) * 60);
        const hh = String(Math.floor(mins / 60)).padStart(2, '0');
        const mm = String(Math.floor((mins % 60) / 10) * 10).padStart(2, '0');
        clockEl.textContent = `Day ${day} · ${hh}:${mm}`;
      }
      a.frames = 0;
      a.time = 0;
      a.worst = 0;
    }
  });

  return null;
}
