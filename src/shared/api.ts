import type { BadgeId, ChallengeId } from './challenge';
import { CHALLENGE_BONUS } from './challenge';
import type { Daily } from './daily';

export type DeathCause = 'tiger' | 'snake' | 'venom' | 'boar' | 'gator' | 'wolf' | 'thirst' | 'hunger' | 'cold' | 'injuries';

export type LeaderEntry = {
  rank: number;
  username: string;
  score: number;
  seconds: number;
  rescued: boolean;
  snoovatar: string | null;
};

export type DayStats = {
  crashed: number; // runs started today
  survived: number; // runs that ended with a rescue
  players: number; // players with a result today
  causes: Partial<Record<DeathCause, number>>;
};

export type Streak = { count: number; best: number; last: string | null };

// Where a real player died today: rendered as a grave in everyone's jungle.
export type Grave = { username: string; x: number; z: number; cause: DeathCause; day: number };

// Tomorrow's challenge vote: three options, live counts, and this player's pick.
export type VoteState = { day: string; options: ChallengeId[]; counts: Record<string, number>; mine: ChallengeId | null };

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  daily: Daily;
  stats: DayStats;
  streak: Streak;
  bestToday: number | null;
  tester: boolean; // shows the owner-only test panel
  challenge: ChallengeId; // today's challenge (locked in from yesterday's vote)
  graves: Grave[];
  vote: VoteState;
};

export type RunResult = {
  seconds: number; // time survived
  day: number; // in-game day reached (1..5)
  rescued: boolean;
  cause: DeathCause | null;
  collected: number;
  kills: { snake: number; boar: number; gator: number; wolf: number };
  tigerDown: boolean;
  startItem: string | null;
  challengeDone: boolean;
  badges: BadgeId[];
  x: number; // where the run ended (a grave appears there for other players)
  z: number;
};

export type ResultResponse = {
  type: 'result';
  score: number;
  rank: number | null; // 1-based rank today (null when signed out)
  players: number;
  percentile: number | null; // share of players you beat, 0..100
  personalBest: boolean;
  streak: Streak;
  flair: string | null;
  stats: DayStats;
  leaderboard: LeaderEntry[];
  me: { username: string; snoovatar: string | null } | null;
  newBadges: BadgeId[]; // earned for the first time this run
  badgeCount: number; // total distinct badges this player owns
  vote: VoteState;
};

export type VoteRequest = { choice: ChallengeId };
export type VoteResponse = { ok: true; vote: VoteState } | { ok: false; message: string };

export type GameEvent =
  | 'crash_start'
  | 'item_grabbed'
  | 'brace'
  | 'day_survived'
  | 'tiger_encounter'
  | 'craft'
  | 'death'
  | 'rescued'
  | 'shared'
  | 'subscribed'
  | 'supply_crate';

export type EventRequest = { name: GameEvent; detail?: string };

// fallback 'open-subreddit': the app may not act as the user yet, so the client opens the subreddit instead
export type OkResponse = { ok: true; message?: string } | { ok: false; message: string; fallback?: 'open-subreddit' };

// Score: seconds survived, a big bonus for being rescued, a little for fighting back.
export function scoreFor(r: RunResult) {
  const kills = r.kills.snake + r.kills.boar + r.kills.gator + r.kills.wolf;
  return Math.round(r.seconds) + (r.rescued ? 500 : 0) + (r.tigerDown ? 100 : 0) + kills * 15 + (r.challengeDone ? CHALLENGE_BONUS : 0);
}
