// Survival stats (0..100). Simulated per frame, rendered by <StatRings> via DOM refs.
// Rates: one 60 s day costs roughly 30 thirst and 18 hunger, so the player must forage.

import { atmo } from './fx';

export const survival = {
  health: 100,
  hunger: 85,
  thirst: 70,
  warmth: 90,
  drinking: false,
};

export type DrainCause = 'thirst' | 'hunger' | 'cold' | null;

// Returns the stat that is currently hurting the player (for the death cause), or null.
// `drain` and `cold` scale with the day (see difficulty.ts): later days are harsher.
export function tickSurvival(dt: number, inWater: boolean, nearFire: boolean, drain = 1, cold = 1): DrainCause {
  const s = survival;
  s.drinking = inWater && s.thirst < 99.5;
  if (s.drinking) s.thirst = Math.min(100, s.thirst + dt * 18);
  else s.thirst = Math.max(0, s.thirst - dt * 0.5 * drain);
  s.hunger = Math.max(0, s.hunger - dt * 0.3 * drain);

  // cold at night and while wet; fire warms
  const coldRate = atmo.night * 1.1 * cold + (inWater ? 0.9 : 0);
  if (nearFire) s.warmth = Math.min(100, s.warmth + dt * 7);
  else if (coldRate > 0.05) s.warmth = Math.max(0, s.warmth - dt * coldRate);
  else s.warmth = Math.min(100, s.warmth + dt * 0.4);

  let cause: DrainCause = null;
  if (s.thirst <= 0) cause = 'thirst';
  else if (s.hunger <= 0) cause = 'hunger';
  else if (s.warmth <= 0) cause = 'cold';
  if (!cause && s.hunger > 50 && s.thirst > 50 && s.warmth > 30) s.health = Math.min(100, s.health + dt * 0.3);
  return cause;
}
