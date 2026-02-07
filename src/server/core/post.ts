import { reddit, redis } from '@devvit/web/server';

const reserveNextPostTitle = async () => {
  const seq = await redis.incr('dd:post-seq');
  return `Daily Darts #${seq}`;
};

export const suggestNextPostTitle = async () => reserveNextPostTitle();

type CreatePostOptions = {
  title?: string;
};

export const createPost = async ({ title }: CreatePostOptions = {}) => {
  const resolvedTitle = title ?? (await reserveNextPostTitle());
  return await reddit.submitCustomPost({
    title: resolvedTitle,
  });
};
