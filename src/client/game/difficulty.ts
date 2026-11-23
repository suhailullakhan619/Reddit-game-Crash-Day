import { run } from './state';

// Survival gets harder every day: animals sense you from further away, telegraph less,
// charge faster and hit harder; you get thirsty and hungry faster, nights get colder and
// campfires burn out sooner. Day 1 is gentler than before, day 5 is brutal.

// 0 on day 1 .. 1 on day 5
export function threat() {
  return Math.min(1, Math.max(0, (run.day - 1) / 4));
}

export const hard = {
  /** animal damage multiplier: 0.8x on day 1 .. 1.45x on day 5 */
  dmg: () => 0.8 + 0.65 * threat(),
  /** charge / hunt speed multiplier */
  speed: () => 1 + 0.25 * threat(),
  /** wind-up (telegraph) time multiplier: shorter warnings later */
  windup: () => 1 - 0.3 * threat(),
  /** detection range multiplier */
  sense: () => 1 + 0.6 * threat(),
  /** thirst / hunger drain multiplier */
  drain: () => 1 + 0.7 * threat(),
  /** night cold multiplier */
  cold: () => 1 + 0.6 * threat(),
  /** seconds a campfire burns */
  fireLife: () => 150 - 60 * threat(),
};

export const DAY_WARNING: Record<number, string> = {
  2: 'Day 2. The animals have caught your scent.',
  3: 'Day 3. Water runs low and the nights are colder.',
  4: 'Day 4. The tiger is hungry. Fires burn out faster.',
  5: 'Day 5. The jungle wants you dead. Hold on until dawn.',
};
