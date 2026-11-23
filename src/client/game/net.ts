import type { GameEvent, OkResponse, ResultResponse, RunResult, VoteResponse } from '../../shared/api';
import type { ChallengeId } from '../../shared/challenge';
import { earnedBadges } from './quest';
import { playerPos } from './shared';
import { run } from './state';

// Thin client for the Devvit server. Every call fails soft: the game must keep working
// offline (local preview) or when Reddit's backend hiccups.

async function post<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? '{}' : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 400 && res.status !== 401) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// one-shot events are only sent once per run (e.g. the first tiger encounter)
const sent = new Set<string>();

export function resetNet() {
  sent.clear();
}

export function track(name: GameEvent, detail?: string, once = false) {
  const key = `${name}:${detail ?? ''}`;
  if (once && sent.has(key)) return;
  sent.add(key);
  void post<OkResponse>('/api/event', detail ? { name, detail } : { name });
}

export function startRun() {
  void post<OkResponse>('/api/start');
}

export function submitResult(): Promise<ResultResponse | null> {
  const body: RunResult = {
    seconds: run.timeAlive,
    day: Math.min(5, run.day),
    rescued: run.phase === 'rescued',
    cause: run.deathCause,
    collected: run.collected,
    kills: run.kills,
    tigerDown: run.tigerDown,
    startItem: run.startItem,
    challengeDone: run.challengeDone,
    badges: earnedBadges(),
    x: playerPos.x,
    z: playerPos.z,
  };
  return post<ResultResponse>('/api/result', body);
}

export function shareResult() {
  return post<OkResponse>('/api/share');
}

export function joinSubreddit() {
  return post<OkResponse>('/api/subscribe');
}

export function voteFor(choice: ChallengeId) {
  return post<VoteResponse>('/api/vote', { choice });
}
