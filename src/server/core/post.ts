import { context, reddit, redis } from '@devvit/web/server';
import { causePair, dailyFor } from '../../shared/daily';

export const createPost = async () => {
  const d = dailyFor(new Date());
  const date = new Date(`${d.dayKey}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return await reddit.submitCustomPost({
    ...(context.subredditName ? { subredditName: context.subredditName } : {}),
    title: `Crash Day · ${date}: ${causePair(d)} over the jungle. Can you survive 5 days?`,
  });
};

// Called by the daily cron. Creates at most one post per UTC day, even if the job fires twice.
export const createDailyPost = async () => {
  const key = `cd:${dailyFor(new Date()).dayKey}:posted`;
  if (await redis.get(key)) return null;
  const post = await createPost();
  await redis.set(key, post.id);
  await redis.expire(key, 60 * 60 * 48);
  return post;
};
