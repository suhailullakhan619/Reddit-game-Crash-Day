import { hashString } from './daily';

// Daily challenge: one twist per UTC day, the same for everyone. Players vote on tomorrow's
// challenge from three seeded options; the server locks in the winner when the day starts.

export type ChallengeId = 'pacifist' | 'bareHands' | 'vegetarian' | 'firekeeper' | 'blackbox' | 'hunter';

export const CHALLENGES: ChallengeId[] = ['pacifist', 'bareHands', 'vegetarian', 'firekeeper', 'blackbox', 'hunter'];

export const CHALLENGE_INFO: Record<ChallengeId, { title: string; goal: string }> = {
  pacifist: { title: 'Pacifist', goal: 'Reach day 3 without killing an animal' },
  bareHands: { title: 'Bare hands', goal: 'Reach day 3 without crafting a weapon' },
  vegetarian: { title: 'Vegetarian', goal: 'Reach day 3 without eating meat' },
  firekeeper: { title: 'Firekeeper', goal: 'Build 3 campfires' },
  blackbox: { title: 'Black box', goal: 'Find the flight recorder in the jungle' },
  hunter: { title: 'Hunter', goal: 'Bring down 2 boars' },
};

export const CHALLENGE_BONUS = 300;

export function isChallenge(v: unknown): v is ChallengeId {
  return typeof v === 'string' && (CHALLENGES as string[]).includes(v);
}

// Fallback when nobody voted (and for offline play).
export function defaultChallenge(dayKey: string): ChallengeId {
  return CHALLENGES[hashString(`challenge:${dayKey}`) % CHALLENGES.length] ?? 'pacifist';
}

// Three distinct seeded options to vote on for the given (future) day.
export function voteOptions(dayKey: string): ChallengeId[] {
  const pool = [...CHALLENGES];
  let h = hashString(`vote:${dayKey}`);
  const out: ChallengeId[] = [];
  while (out.length < 3 && pool.length) {
    const i = h % pool.length;
    out.push(pool.splice(i, 1)[0]!);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  }
  return out;
}

// Achievements earned in a single run; the server keeps each player's collection.
export type BadgeId = 'tiger' | 'pacifist' | 'archer' | 'chef' | 'builder' | 'wolf' | 'rescued' | 'challenge';

export const BADGES: BadgeId[] = ['rescued', 'tiger', 'challenge', 'wolf', 'archer', 'chef', 'builder', 'pacifist'];

export const BADGE_INFO: Record<BadgeId, { title: string; desc: string }> = {
  rescued: { title: 'Rescued', desc: 'Lifted out by the rescue helicopter' },
  tiger: { title: 'Tiger Tamer', desc: 'Drove the tiger away for good' },
  challenge: { title: 'Challenger', desc: "Completed the day's challenge" },
  wolf: { title: 'Pack Breaker', desc: 'Brought down a night wolf' },
  archer: { title: 'Sharpshooter', desc: 'Landed 3 arrows' },
  chef: { title: 'Camp Chef', desc: 'Cooked meat over a fire' },
  builder: { title: 'Homesteader', desc: 'Built a shelter and a campfire' },
  pacifist: { title: 'Gentle Soul', desc: 'Reached day 3 without a kill' },
};

export function isBadge(v: unknown): v is BadgeId {
  return typeof v === 'string' && (BADGES as string[]).includes(v);
}
