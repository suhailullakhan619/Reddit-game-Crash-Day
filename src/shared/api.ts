import type { Daily } from './daily';

export type DeathCause = 'tiger' | 'snake' | 'venom' | 'boar' | 'gator' | 'thirst' | 'hunger' | 'cold' | 'injuries';

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

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  daily: Daily;
  stats: DayStats;
  streak: Streak;
  bestToday: number | null;
  tester: boolean; // shows the owner-only test panel
};

export type RunResult = {
  seconds: number; // time survived
  day: number; // in-game day reached (1..5)
  rescued: boolean;
  cause: DeathCause | null;
  collected: number;
  kills: { snake: number; boar: number; gator: number };
  tigerDown: boolean;
  startItem: string | null;
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
};

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
  const kills = r.kills.snake + r.kills.boar + r.kills.gator;
  return Math.round(r.seconds) + (r.rescued ? 500 : 0) + (r.tigerDown ? 100 : 0) + kills * 15;
}
