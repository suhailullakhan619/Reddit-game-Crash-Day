import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type { InitResponse } from '../../shared/api';
import { dailyFor } from '../../shared/daily';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId is required but missing from context' },
      400
    );
  }

  try {
    const username = await reddit.getCurrentUsername();
    return c.json<InitResponse>({
      type: 'init',
      postId,
      username: username ?? 'anonymous',
      daily: dailyFor(new Date()),
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});
