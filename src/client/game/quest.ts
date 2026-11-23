import { CHALLENGE_INFO, defaultChallenge, type BadgeId, type ChallengeId } from '../../shared/challenge';
import { dayKeyFor, hashString } from '../../shared/daily';
import { emit, run, toast } from './state';
import { mulberry32, WATER_LEVEL, WORLD_HALF, type World } from './world';

// Today's challenge (set from /api/init; seeded default offline) and live completion checks.
export const quest = { id: defaultChallenge(dayKeyFor(new Date())) as ChallengeId };

function killCount() {
  return run.kills.snake + run.kills.boar + run.kills.gator + run.kills.wolf + (run.tigerHits > 0 ? 1 : 0);
}

function met(id: ChallengeId): boolean {
  switch (id) {
    case 'pacifist':
      return run.day >= 3 && killCount() === 0;
    case 'bareHands':
      return run.day >= 3 && !run.craftedWeapon;
    case 'vegetarian':
      return run.day >= 3 && !run.ateMeat;
    case 'firekeeper':
      return run.firesBuilt >= 3;
    case 'blackbox':
      return run.blackbox?.taken === true;
    case 'hunter':
      return run.kills.boar >= 2;
  }
}

// Called every frame while playing: locks the challenge in the moment it is achieved.
export function tickChallenge() {
  if (run.challengeDone || !met(quest.id)) return;
  run.challengeDone = true;
  toast(`Challenge complete: ${CHALLENGE_INFO[quest.id].title}! +300`);
  emit();
}

// Progress line for the HUD pill, e.g. "Fires 1/3".
export function challengeProgress(): string {
  if (run.challengeDone) return 'Done';
  switch (quest.id) {
    case 'firekeeper':
      return `${run.firesBuilt}/3 fires`;
    case 'hunter':
      return `${run.kills.boar}/2 boars`;
    case 'blackbox':
      return 'Search';
    default:
      return run.day >= 3 ? 'Failed' : `Day ${run.day}/3`;
  }
}

export function earnedBadges(): BadgeId[] {
  const out: BadgeId[] = [];
  if (run.phase === 'rescued') out.push('rescued');
  if (run.tigerDown) out.push('tiger');
  if (run.challengeDone) out.push('challenge');
  if (run.kills.wolf > 0) out.push('wolf');
  if (run.arrowHits >= 3) out.push('archer');
  if (run.cooked) out.push('chef');
  if (run.shelters.length > 0 && run.firesBuilt > 0) out.push('builder');
  if (run.day >= 3 && killCount() === 0) out.push('pacifist');
  return out;
}

// Black box challenge: the flight recorder lies 50-80 m from the wreck (same spot for everyone).
export function placeBlackbox(world: World) {
  run.blackbox = null;
  if (quest.id !== 'blackbox') return;
  const rng = mulberry32(hashString(`blackbox:${world.seed}`));
  for (let i = 0; i < 200; i++) {
    const a = rng() * Math.PI * 2;
    const r = 50 + rng() * 30;
    const x = world.wreck.x + Math.cos(a) * r;
    const z = world.wreck.z + Math.sin(a) * r;
    if (Math.abs(x) > WORLD_HALF - 10 || Math.abs(z) > WORLD_HALF - 10) continue;
    const h = world.heightAt(x, z);
    if (h < WATER_LEVEL + 0.4 || h > 9) continue;
    const res = world.collide(x, z, 0.8);
    if (Math.hypot(res.x - x, res.z - z) > 0.05) continue;
    run.blackbox = { x, z, taken: false };
    return;
  }
}
