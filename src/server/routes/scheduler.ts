import { Hono } from 'hono';
import { createDailyPost } from '../core/post';

export const scheduler = new Hono();

// devvit.json: scheduler.tasks["daily-post"] runs this every day just after 00:00 UTC.
scheduler.post('/daily-post', async (c) => {
  try {
    const post = await createDailyPost();
    console.log(post ? `daily post created: ${post.id}` : 'daily post already exists');
    return c.json({ status: 'success' }, 200);
  } catch (error) {
    console.error('daily post failed', error);
    return c.json({ status: 'error' }, 500);
  }
});
