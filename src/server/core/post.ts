import { reddit, redis } from '@devvit/web/server';

const reserveNextPostTitle = async () => {
  const seq = await redis.incr('dd:post-seq');
  return `Daily Darts #${seq}`;
};

const peekNextPostTitle = async () => {
  const currentRaw = await redis.get('dd:post-seq');
  const current = currentRaw ? Number.parseInt(currentRaw, 10) : 0;
  const next = Number.isFinite(current) ? current + 1 : 1;
  return `Daily Darts #${next}`;
};

export const suggestNextPostTitle = async () => peekNextPostTitle();

type CreatePostOptions = {
  title?: string;
};

export const createPost = async ({ title }: CreatePostOptions = {}) => {
  const resolvedTitle = title ?? (await reserveNextPostTitle());
  return await reddit.submitCustomPost({
    title: resolvedTitle,
  });
};
