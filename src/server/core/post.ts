import { reddit, redis } from '@devvit/web/server';

const nextPostTitle = async () => {
  const seq = await redis.incr('dd:post-seq');
  return `Daily Darts #${seq}`;
};

export const createPost = async (titleOverride?: string) => {
  const title = titleOverride ?? (await nextPostTitle());
  return await reddit.submitCustomPost({
    title,
  });
};
