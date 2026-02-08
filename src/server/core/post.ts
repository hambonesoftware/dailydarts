import { context, reddit, redis } from '@devvit/web/server';

export const createPost = async () => {
  const counterKey = `dd:postCount:${context.subredditName}`;
  const nextNumber = await redis.incrBy(counterKey, 1);
  const title = `Daily Darts #${nextNumber}`;

  return await reddit.submitCustomPost({
    title,
  });
};
