import { reddit, redis } from '@devvit/web/server';

const postSeqKey = 'dd:post-seq';

const isIntegerString = (value: string) => /^\d+$/.test(value);

const ensurePostSeqInteger = async () => {
  const currentRaw = await redis.get(postSeqKey);
  if (currentRaw === null || isIntegerString(currentRaw)) {
    return;
  }

  await redis.set(postSeqKey, '0');
};

const reserveNextPostTitle = async () => {
  await ensurePostSeqInteger();
  const seq = await redis.incr(postSeqKey);
  return `Daily Darts #${seq}`;
};

const peekNextPostTitle = async () => {
  const currentRaw = await redis.get(postSeqKey);
  const current = currentRaw && isIntegerString(currentRaw) ? Number.parseInt(currentRaw, 10) : 0;
  const next = current + 1;
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
