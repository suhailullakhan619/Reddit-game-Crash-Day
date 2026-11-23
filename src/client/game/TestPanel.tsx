import { useState } from 'react';
import { gameClock, playerPos } from './shared';
import { combat, creatures, debugReq, emit, rescue, run, type CreatureKind } from './state';
import { survival } from './survival';

// Owner-only test panel (the server sets `tester` for allow-listed usernames).
// Lets the developer reach animals and late-game moments on a real phone without
// wandering the map for minutes. Invisible to every other player.

function nearest(kind: CreatureKind) {
  let best: (typeof creatures)[number] | null = null;
  let bestD = Infinity;
  for (const c of creatures) {
    if (c.kind !== kind || !c.alive) continue;
    const d = Math.hypot(c.x - playerPos.x, c.z - playerPos.z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// stand a few metres in front of the animal, on the camera's side so it is in view
function goTo(kind: CreatureKind, dist: number) {
  const c = nearest(kind);
  if (!c) return;
  const fx = -Math.sin(combat.camYaw);
  const fz = -Math.cos(combat.camYaw);
  debugReq.player = { x: c.x - fx * dist, z: c.z - fz * dist };
}

export function TestPanel() {
  const [open, setOpen] = useState(false);
  if (run.phase !== 'play') return null;

  const act = (fn: () => void) => () => {
    fn();
    emit();
  };

  return (
    <div className="testpanel">
      <button type="button" className="chip test-toggle" onClick={() => setOpen((v) => !v)}>
        TEST
      </button>
      {open && (
        <div className="test-grid">
          <button
            type="button"
            onClick={act(() => {
              // tiger appears 12 m in front and is allowed to hunt immediately
              run.timeAlive = Math.max(run.timeAlive, 30);
              const fx = -Math.sin(combat.camYaw);
              const fz = -Math.cos(combat.camYaw);
              debugReq.tiger = { x: playerPos.x + fx * 12, z: playerPos.z + fz * 12 };
            })}
          >
            Tiger here
          </button>
          <button type="button" onClick={act(() => goTo('snake', 2.2))}>
            To snake
          </button>
          <button type="button" onClick={act(() => goTo('boar', 8))}>
            To boar
          </button>
          <button type="button" onClick={act(() => goTo('gator', 5))}>
            To gator
          </button>
          <button
            type="button"
            onClick={act(() => {
              // jump to dusk of day 5: rescue arrives at the next dawn
              const target = 4 + 0.55;
              gameClock.elapsed = Math.max(gameClock.elapsed, (target - gameClock.startPhase) * gameClock.dayLength);
            })}
          >
            Day 5 dusk
          </button>
          <button
            type="button"
            onClick={act(() => {
              // jump to the start of day 3 to feel the difficulty ramp
              const target = 2 + 0.05;
              gameClock.elapsed = Math.max(gameClock.elapsed, (target - gameClock.startPhase) * gameClock.dayLength);
            })}
          >
            Day 3
          </button>
          <button
            type="button"
            onClick={act(() => {
              run.bow = true;
              run.arrows += 10;
            })}
          >
            Bow +10
          </button>
          <button
            type="button"
            onClick={act(() => {
              // crate falls 1.6 m ahead (ground taken as the player's height) so it can be opened at once
              const x = playerPos.x - Math.sin(combat.camYaw) * 1.6;
              const z = playerPos.z - Math.cos(combat.camYaw) * 1.6;
              run.drops.push({ x, z, ground: playerPos.y, y: playerPos.y + 25, landed: false, opened: false });
            })}
          >
            Drop crate
          </button>
          <button
            type="button"
            onClick={act(() => {
              run.inv.wood += 10;
              run.inv.stone += 6;
              run.inv.herb += 6;
              run.inv.meat += 2;
            })}
          >
            Materials
          </button>
          <button type="button" onClick={act(() => rescue())}>
            Rescue now
          </button>
          <button
            type="button"
            onClick={act(() => {
              survival.health = 100;
              survival.thirst = 100;
              survival.hunger = 100;
              survival.warmth = 100;
              run.poisoned = false;
            })}
          >
            Heal all
          </button>
        </div>
      )}
    </div>
  );
}
