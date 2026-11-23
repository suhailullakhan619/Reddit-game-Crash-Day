import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type { EventRequest, InitResponse, OkResponse, ResultResponse, VoteRequest, VoteResponse } from '../../shared/api';
import { isChallenge } from '../../shared/challenge';
import { dailyFor } from '../../shared/daily';
import { bestToday, castVote, getChallenge, getGraves, getStats, getStreak, postDay, recordEvent, recordResult, recordStart, sanitize, shareText, voteState } from '../core/game';

// Usernames that get the in-game test panel (developer testing on real phones).
const TESTERS = new Set(['Big-Part-2274']);

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required but missing from context' }, 400);
  }
  try {
    const username = await reddit.getCurrentUsername();
    const day = await postDay(postId);
    const [stats, streak, best, challenge, graves, vote] = await Promise.all([
      getStats(day),
      username ? getStreak(username) : Promise.resolve({ count: 0, best: 0, last: null }),
      username ? bestToday(username, day) : Promise.resolve(null),
      getChallenge(day),
      getGraves(day),
      voteState(username),
    ]);
    return c.json<InitResponse>({
      type: 'init',
      postId,
      username: username ?? 'anonymous',
      daily: dailyFor(new Date(`${day}T12:00:00Z`)),
      stats,
      streak,
      bestToday: best,
      tester: !!username && TESTERS.has(username),
      challenge,
      graves,
      vote,
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// A run starts (the crash cinematic begins): counts toward "N crashed today".
api.post('/start', async (c) => {
  await recordStart(await postDay(context.postId));
  await recordEvent('crash_start');
  return c.json<OkResponse>({ ok: true });
});

// Journey-style funnel events, stored as daily Redis counters.
api.post('/event', async (c) => {
  const body = await c.req.json<EventRequest>().catch(() => null);
  if (!body || !(await recordEvent(body.name, body.detail))) {
    return c.json<OkResponse>({ ok: false, message: 'unknown event' }, 400);
  }
  return c.json<OkResponse>({ ok: true });
});

api.post('/result', async (c) => {
  const run = sanitize(await c.req.json().catch(() => null));
  if (!run) return c.json<ErrorResponse>({ status: 'error', message: 'bad result' }, 400);
  try {
    const username = await reddit.getCurrentUsername();
    await recordEvent(run.rescued ? 'rescued' : 'death', run.cause ?? undefined);
    const res = await recordResult(username, run, await postDay(context.postId));
    console.log(`result saved u=${username ?? 'anon'} score=${res.score} rank=${res.rank ?? '-'}/${res.players} streak=${res.streak.count} flair=${res.flair ?? '-'}`);
    return c.json<ResultResponse>(res);
  } catch (error) {
    console.error('result failed', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'could not save result' }, 500);
  }
});

// Posts the player's latest result as a comment on this post, as the player (they tapped Share).
api.post('/share', async (c) => {
  const { postId } = context;
  const username = await reddit.getCurrentUsername();
  if (!postId || !username) return c.json<OkResponse>({ ok: false, message: 'Sign in to share your result.' }, 401);
  const text = await shareText(username, await postDay(postId));
  if (!text) return c.json<OkResponse>({ ok: false, message: 'Finish a run first.' }, 400);
  try {
    await reddit.submitComment({ id: postId, text, runAs: 'USER' });
    await recordEvent('shared');
    return c.json<OkResponse>({ ok: true, message: 'Result posted to the comments.' });
  } catch (error) {
    // Posting as the user needs Reddit to grant SUBMIT_COMMENT; until then the app account posts it, naming the player.
    console.warn('share as user unavailable, posting as app', String(error).slice(0, 160));
    try {
      await reddit.submitComment({ id: postId, text: `u/${username}'s run · ${text}`, runAs: 'APP' });
      await recordEvent('shared', 'app');
      return c.json<OkResponse>({ ok: true, message: 'Result posted to the comments.' });
    } catch (e) {
      console.error('share failed', e);
      return c.json<OkResponse>({ ok: false, message: 'Could not post the comment.' }, 500);
    }
  }
});

// Vote for tomorrow's challenge (one vote per player, can be changed).
api.post('/vote', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username) return c.json<VoteResponse>({ ok: false, message: 'Sign in to vote.' }, 401);
  const body = await c.req.json<VoteRequest>().catch(() => null);
  if (!body || !isChallenge(body.choice)) return c.json<VoteResponse>({ ok: false, message: 'Unknown option.' }, 400);
  const vote = await castVote(username, body.choice);
  if (!vote) return c.json<VoteResponse>({ ok: false, message: 'That option is not on the ballot.' }, 400);
  return c.json<VoteResponse>({ ok: true, vote });
});

api.post('/subscribe', async (c) => {
  try {
    await reddit.subscribeToCurrentSubreddit();
    await recordEvent('subscribed');
    return c.json<OkResponse>({ ok: true, message: 'Joined! New crash every day.' });
  } catch (error) {
    // Joining for the user needs Reddit to grant SUBSCRIBE_TO_SUBREDDIT; fall back to opening the subreddit.
    console.warn('subscribe as user unavailable', String(error).slice(0, 160));
    return c.json<OkResponse>({ ok: false, message: 'Tap Join at the top of the subreddit.', fallback: 'open-subreddit' });
  }
});
