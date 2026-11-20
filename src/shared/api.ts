import type { Daily } from './daily';

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  daily: Daily;
};
