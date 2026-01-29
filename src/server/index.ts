import express from 'express';
import {
  InitResponse,
  IncrementResponse,
  DecrementResponse,
  LeaderboardSubmitRequest,
  LeaderboardSubmitResponse,
  LeaderboardFetchRequest,
  LeaderboardFetchResponse,
} from '../shared/types/api';
import { redis, reddit, createServer, context, getServerPort } from '@devvit/web/server';
import { createPost } from './core/post';
import { fetchTopN, getRankForUser, upsertScore } from './leaderboard';

const app = express();

// Middleware for JSON body parsing
app.use(express.json());
// Middleware for URL-encoded body parsing
app.use(express.urlencoded({ extended: true }));
// Middleware for plain text body parsing
app.use(express.text());

const router = express.Router();

router.get<{ postId: string }, InitResponse | { status: string; message: string }>(
  '/api/init',
  async (_req, res): Promise<void> => {
    const { postId } = context;

    if (!postId) {
      console.error('API Init Error: postId not found in devvit context');
      res.status(400).json({
        status: 'error',
        message: 'postId is required but missing from context',
      });
      return;
    }

    try {
      const [count, username] = await Promise.all([
        redis.get('count'),
        reddit.getCurrentUsername(),
      ]);

      res.json({
        type: 'init',
        postId: postId,
        count: count ? parseInt(count) : 0,
        username: username ?? 'anonymous',
      });
    } catch (error) {
      console.error(`API Init Error for post ${postId}:`, error);
      let errorMessage = 'Unknown error during initialization';
      if (error instanceof Error) {
        errorMessage = `Initialization failed: ${error.message}`;
      }
      res.status(400).json({ status: 'error', message: errorMessage });
    }
  }
);

router.post<{ postId: string }, IncrementResponse | { status: string; message: string }, unknown>(
  '/api/increment',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: 'error',
        message: 'postId is required',
      });
      return;
    }

    res.json({
      count: await redis.incrBy('count', 1),
      postId,
      type: 'increment',
    });
  }
);

router.post<{ postId: string }, DecrementResponse | { status: string; message: string }, unknown>(
  '/api/decrement',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: 'error',
        message: 'postId is required',
      });
      return;
    }

    res.json({
      count: await redis.incrBy('count', -1),
      postId,
      type: 'decrement',
    });
  }
);

router.post<
  { postId: string },
  LeaderboardSubmitResponse | { status: string; message: string },
  LeaderboardSubmitRequest
>('/api/leaderboard/submit', async (req, res): Promise<void> => {
  const { postId } = context;
  if (!postId) {
    res.status(400).json({
      status: 'error',
      message: 'postId is required',
    });
    return;
  }

  const { userId, score, limit, metadata } = req.body;
  if (!userId?.trim()) {
    res.status(400).json({
      status: 'error',
      message: 'userId is required',
    });
    return;
  }
  if (typeof score !== 'number' || Number.isNaN(score)) {
    res.status(400).json({
      status: 'error',
      message: 'score must be a number',
    });
    return;
  }

  const topLimit = Math.max(1, Math.min(limit ?? 10, 100));

  try {
    await upsertScore(redis, postId, userId, score, metadata);
    const [top, callerRank] = await Promise.all([
      fetchTopN(redis, postId, topLimit),
      getRankForUser(redis, postId, userId),
    ]);

    res.json({
      type: 'leaderboard-submit',
      postId,
      top,
      callerRank,
    });
  } catch (error) {
    console.error('Leaderboard submit error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to submit leaderboard score',
    });
  }
});

router.post<
  { postId: string },
  LeaderboardFetchResponse | { status: string; message: string },
  LeaderboardFetchRequest
>('/api/leaderboard/fetch', async (req, res): Promise<void> => {
  const { postId } = context;
  if (!postId) {
    res.status(400).json({
      status: 'error',
      message: 'postId is required',
    });
    return;
  }

  const { userId, limit } = req.body;
  if (!userId?.trim()) {
    res.status(400).json({
      status: 'error',
      message: 'userId is required',
    });
    return;
  }

  const topLimit = Math.max(1, Math.min(limit ?? 10, 100));

  try {
    const [top, callerRank] = await Promise.all([
      fetchTopN(redis, postId, topLimit),
      getRankForUser(redis, postId, userId),
    ]);
    res.json({
      type: 'leaderboard-fetch',
      postId,
      top,
      callerRank,
    });
  } catch (error) {
    console.error('Leaderboard fetch error:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to fetch leaderboard',
    });
  }
});

router.post('/internal/on-app-install', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      status: 'success',
      message: `Post created in subreddit ${context.subredditName} with id ${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

router.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

app.use(router);

const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort());
