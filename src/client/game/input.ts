// Shared mutable input state. Written by DOM handlers, read inside useFrame.
// Kept outside React state so per-frame reads never trigger re-renders.

export const input = {
  moveX: 0, // -1..1, right positive
  moveY: 0, // -1..1, forward positive
  lookDX: 0, // accumulated look delta in px since last frame
  lookDY: 0,
  sprint: false,
  touchedOnce: false,
};

const keys = new Set<string>();

function syncKeys() {
  if (joystickActive) return;
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const len = Math.hypot(x, y) || 1;
  input.moveX = x / len;
  input.moveY = y / len;
  input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
}

let joystickActive = false;
export function setJoystick(active: boolean, x: number, y: number) {
  joystickActive = active;
  input.moveX = active ? x : 0;
  input.moveY = active ? y : 0;
  if (active && (x !== 0 || y !== 0)) input.touchedOnce = true;
  if (!active) syncKeys();
}

export function attachKeyboard(): () => void {
  const down = (e: KeyboardEvent) => {
    keys.add(e.code);
    syncKeys();
    if (input.moveX || input.moveY) input.touchedOnce = true;
  };
  const up = (e: KeyboardEvent) => {
    keys.delete(e.code);
    syncKeys();
  };
  const blur = () => {
    keys.clear();
    syncKeys();
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}
