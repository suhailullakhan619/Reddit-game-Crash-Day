import { useEffect, useRef } from 'react';
import { input, setJoystick } from './input';

const RADIUS = 56; // joystick travel in px

// Full-screen pointer layer.
// Touch: left half = floating joystick, right half = drag to look.
// Mouse: drag anywhere to look; WASD to move.
export function Controls() {
  const layer = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = layer.current!;
    let stickId: number | null = null;
    let lookId: number | null = null;
    let ox = 0;
    let oy = 0;
    let lx = 0;
    let ly = 0;

    const showStick = (x: number, y: number) => {
      const b = base.current!;
      b.style.transform = `translate(${x - RADIUS}px, ${y - RADIUS}px)`;
      b.style.opacity = '1';
      knob.current!.style.transform = 'translate(0px, 0px)';
    };

    const down = (e: PointerEvent) => {
      const isTouch = e.pointerType !== 'mouse';
      if (isTouch && e.clientX < window.innerWidth * 0.5 && stickId === null) {
        stickId = e.pointerId;
        ox = e.clientX;
        oy = e.clientY;
        showStick(ox, oy);
        setJoystick(true, 0, 0);
      } else if (lookId === null) {
        lookId = e.pointerId;
        lx = e.clientX;
        ly = e.clientY;
      } else return;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId === stickId) {
        let dx = e.clientX - ox;
        let dy = e.clientY - oy;
        const d = Math.hypot(dx, dy);
        if (d > RADIUS) {
          // drag the base along so the stick never feels stuck
          const over = d - RADIUS;
          ox += (dx / d) * over;
          oy += (dy / d) * over;
          base.current!.style.transform = `translate(${ox - RADIUS}px, ${oy - RADIUS}px)`;
          dx = e.clientX - ox;
          dy = e.clientY - oy;
        }
        knob.current!.style.transform = `translate(${dx}px, ${dy}px)`;
        const nx = dx / RADIUS;
        const ny = -dy / RADIUS;
        const m = Math.hypot(nx, ny);
        // small dead zone
        if (m < 0.12) setJoystick(true, 0, 0);
        else setJoystick(true, nx, ny);
      } else if (e.pointerId === lookId) {
        input.lookDX += e.clientX - lx;
        input.lookDY += e.clientY - ly;
        lx = e.clientX;
        ly = e.clientY;
      }
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId === stickId) {
        stickId = null;
        setJoystick(false, 0, 0);
        base.current!.style.opacity = '0';
      } else if (e.pointerId === lookId) {
        lookId = null;
      }
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);

  return (
    <div ref={layer} className="controls">
      <div ref={base} className="stick-base">
        <div ref={knob} className="stick-knob" />
      </div>
    </div>
  );
}
