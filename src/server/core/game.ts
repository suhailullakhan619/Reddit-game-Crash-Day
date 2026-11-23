import { context, reddit, redis } from '@devvit/web/server';
import type { DayStats, DeathCause, GameEvent, LeaderEntry, ResultResponse, RunResult, Streak } from '../../shared/api';
import { scoreFor } from '../../shared/api';
import { dayKeyFor } from '../../shared/daily';

// Redis layout (all per UTC day unless noted):
//   cd:{day}:lb            sorted set  username -> best score today
//   cd:{day}:meta          hash        username -> JSON {seconds, rescued} of their best run
//   cd:{day}:stats         hash        crashed, survived, players, cause:{name}
//   cd:{day}:events        hash        analytics counters (journey funnel)
//   cd:{day}:last:{user}   string      JSON of the user's latest result (for the comment share)
//   cd:streak:{user}       string      JSON Streak (no expiry)
//   cd:snoo:{user}         string      cached snoovatar URL (1 day)

const DAY_TTL = 60 * 60 * 24 * 8; // keep a week of history

const CAUSES: DeathCause[] = ['tiger', 'snake', 'venom', 'boar', 'gator', 'thirst', 'hunger', 'cold', 'injuries'];
const EVENTS: GameEvent[] = ['crash_start', 'item_grabbed', 'brace', 'day_survived', 'tiger_encounter', 'craft', 'death', 'rescued', 'shared', 'subscribed', 'supply_crate'];

export function today() {
  return dayKeyFor(new Date());
}

function yesterday() {
  return dayKeyFor(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

async function touch(key: string) {
  await redis.expire(key, DAY_TTL);
}

export async function getStats(day = today()): Promise<DayStats> {
  const raw = await redis.hGetAll(`cd:${day}:stats`);
  const causes: DayStats['causes'] = {};
  for (const c of CAUSES) {
    const n = Number(raw[`cause:${c}`] ?? 0);
    if (n > 0) causes[c] = n;
  }
  return {
    crashed: Number(raw.crashed ?? 0),
    survived: Number(raw.survived ?? 0),
    players: Number(raw.players ?? 0),
    causes,
  };
}

export async function getStreak(username: string): Promise<Streak> {
  const raw = await redis.get(`cd:streak:${username}`);
  if (!raw) return { count: 0, best: 0, last: null };
  try {
    const s = JSON.parse(raw) as Partial<Streak>;
    // a streak only counts if you played today or yesterday
    const alive = s.last === today() || s.last === yesterday();
    return { count: alive ? Number(s.count ?? 0) : 0, best: Number(s.best ?? 0), last: s.last ?? null };
  } catch {
    return { count: 0, best: 0, last: null };
  }
}

async function bumpStreak(username: string): Promise<Streak> {
  const s = await getStreak(username);
  if (s.last === today()) return s;
  const count = s.last === yesterday() ? s.count + 1 : 1;
  const next: Streak = { count, best: Math.max(s.best, count), last: today() };
  await redis.set(`cd:streak:${username}`, JSON.stringify(next));
  return next;
}

export async function snoovatarFor(username: string): Promise<string | null> {
  const key = `cd:snoo:${username}`;
  const cached = await redis.get(key);
  if (cached !== undefined && cached !== null) return cached || null;
  let url: string | null;
  try {
    url = (await reddit.getSnoovatarUrl(username)) ?? null;
  } catch {
    url = null;
  }
  await redis.set(key, url ?? '');
  await redis.expire(key, 60 * 60 * 24);
  return url;
}

export async function bestToday(username: string): Promise<number | null> {
  const s = await redis.zScore(`cd:${today()}:lb`, username);
  return s === undefined ? null : s;
}

export async function recordStart() {
  const day = today();
  await redis.hIncrBy(`cd:${day}:stats`, 'crashed', 1);
  await touch(`cd:${day}:stats`);
}

export async function recordEvent(name: string, detail?: string) {
  if (!EVENTS.includes(name as GameEvent)) return false;
  const day = today();
  const key = `cd:${day}:events`;
  await redis.hIncrBy(key, name, 1);
  if (detail && /^[a-z0-9_-]{1,24}$/i.test(detail)) await redis.hIncrBy(key, `${name}:${detail}`, 1);
  await touch(key);
  return true;
}

// Clamp everything the client sends: the score only depends on these bounded numbers.
export function sanitize(input: unknown): RunResult | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
  };
  const kills = (r.kills ?? {}) as Record<string, unknown>;
  const cause = typeof r.cause === 'string' && CAUSES.includes(r.cause as DeathCause) ? (r.cause as DeathCause) : null;
  const rescued = r.rescued === true;
  return {
    seconds: num(r.seconds, 0, 420),
    day: Math.round(num(r.day, 1, 5)),
    rescued,
    cause: rescued ? null : cause,
    collected: Math.round(num(r.collected, 0, 500)),
    kills: {
      snake: Math.round(num(kills.snake, 0, 18)),
      boar: Math.round(num(kills.boar, 0, 8)),
      gator: Math.round(num(kills.gator, 0, 7)),
    },
    tigerDown: r.tigerDown === true,
    startItem: typeof r.startItem === 'string' ? r.startItem.slice(0, 12) : null,
  };
}

function flairFor(r: RunResult, streak: Streak): string | null {
  const parts: string[] = [];
  if (r.tigerDown) parts.push('Tiger Slayer');
  else if (r.rescued) parts.push('Survivor');
  else if (r.day >= 3) parts.push('Castaway');
  if (streak.count >= 2) parts.push(`${streak.count}-Day Streak`);
  return parts.length ? parts.join(' · ') : null;
}

export async function leaderboard(limit = 5): Promise<LeaderEntry[]> {
  const day = today();
  const top = await redis.zRange(`cd:${day}:lb`, 0, limit - 1, { by: 'rank', reverse: true });
  return Promise.all(
    top.map(async (m, i) => {
      let seconds = 0;
      let rescued = false;
      try {
        const meta = JSON.parse((await redis.hGet(`cd:${day}:meta`, m.member)) ?? '{}') as { seconds?: number; rescued?: boolean };
        seconds = Number(meta.seconds ?? 0);
        rescued = meta.rescued === true;
      } catch {
        // ignore malformed meta
      }
      return { rank: i + 1, username: m.member, score: m.score, seconds, rescued, snoovatar: await snoovatarFor(m.member) };
    })
  );
}

export async function recordResult(username: string | undefined, r: RunResult): Promise<ResultResponse> {
  const day = today();
  const statsKey = `cd:${day}:stats`;
  const score = scoreFor(r);
  if (r.rescued) await redis.hIncrBy(statsKey, 'survived', 1);
  else if (r.cause) await redis.hIncrBy(statsKey, `cause:${r.cause}`, 1);
  await touch(statsKey);

  let rank: number | null = null;
  let percentile: number | null = null;
  let personalBest = false;
  let streak: Streak = { count: 0, best: 0, last: null };
  let flair: string | null = null;
  const lbKey = `cd:${day}:lb`;

  if (username) {
    const prev = await redis.zScore(lbKey, username);
    if (prev === undefined) await redis.hIncrBy(statsKey, 'players', 1);
    if (prev === undefined || score > prev) {
      personalBest = true;
      await redis.zAdd(lbKey, { member: username, score });
      await redis.hSet(`cd:${day}:meta`, { [username]: JSON.stringify({ seconds: Math.round(r.seconds), rescued: r.rescued }) });
      await touch(lbKey);
      await touch(`cd:${day}:meta`);
    }
    await redis.set(`cd:${day}:last:${username}`, JSON.stringify({ ...r, score }));
    await redis.expire(`cd:${day}:last:${username}`, DAY_TTL);

    streak = await bumpStreak(username);
    const players = await redis.zCard(lbKey);
    const asc = await redis.zRank(lbKey, username); // 0 = lowest score
    if (asc !== undefined) {
      rank = players - asc;
      percentile = players > 1 ? Math.round((asc / (players - 1)) * 100) : 100;
    }

    flair = flairFor(r, streak);
    if (flair && context.subredditName) {
      try {
        await reddit.setUserFlair({ subredditName: context.subredditName, username, text: flair, backgroundColor: '#f0a35e', textColor: 'dark' });
      } catch (e) {
        console.error('flair failed', e);
        flair = null;
      }
    }
  }

  return {
    type: 'result',
    score,
    rank,
    players: await redis.zCard(lbKey),
    percentile,
    personalBest,
    streak,
    flair,
    stats: await getStats(day),
    leaderboard: await leaderboard(5),
    me: username ? { username, snoovatar: await snoovatarFor(username) } : null,
  };
}

const CAUSE_TEXT: Record<DeathCause, string> = {
  tiger: 'mauled by the tiger',
  snake: 'bitten by a viper',
  venom: 'killed by snake venom',
  boar: 'gored by a boar',
  gator: 'dragged under by an alligator',
  thirst: 'died of thirst',
  hunger: 'starved',
  cold: 'died of exposure',
  injuries: 'succumbed to injuries',
};

// Builds the comment from the stored result so players can't post arbitrary text through the app.
export async function shareText(username: string): Promise<string | null> {
  const raw = await redis.get(`cd:${today()}:last:${username}`);
  if (!raw) return null;
  const r = JSON.parse(raw) as RunResult & { score: number };
  const mins = Math.floor(r.seconds / 60);
  const secs = String(Math.round(r.seconds % 60)).padStart(2, '0');
  const outcome = r.rescued ? 'Rescued on day 5!' : `Day ${r.day}, ${CAUSE_TEXT[r.cause ?? 'injuries']}.`;
  const extras: string[] = [];
  if (r.tigerDown) extras.push('drove off the tiger');
  const kills = r.kills.snake + r.kills.boar + r.kills.gator;
  if (kills) extras.push(`${kills} animal${kills > 1 ? 's' : ''} fought off`);
  return [
    `**Crash Day ${today()}** · ${outcome}`,
    '',
    `Survived ${mins}:${secs} · ${r.collected} items found${extras.length ? ' · ' + extras.join(' · ') : ''} · score ${r.score}`,
  ].join('\n');
}
