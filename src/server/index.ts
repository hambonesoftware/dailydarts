import express from "express";
import type { Request } from "express";

import {
  InitResponse,
  IncrementResponse,
  DecrementResponse,
  LeaderboardFetchRequest,
  LeaderboardFetchResponse,
  LeaderboardSubmitRequest,
  LeaderboardSubmitResponse,
  LeaderboardEntry,
  ShareImageCommentRequest,
  ShareImageCommentResponse,
} from "../shared/types/api";

import { RichTextBuilder } from "@devvit/public-api";
import { redis, reddit, media, createServer, context, getServerPort } from "@devvit/web/server";
import { createPost } from "./core/post";

const app = express();

// Middleware for JSON body parsing
app.use(express.json({ limit: "2mb" }));
// Middleware for URL-encoded body parsing
app.use(express.urlencoded({ extended: true }));
// Middleware for plain text body parsing
app.use(express.text());

const router = express.Router();

/**
 * ------------------------------
 * Leaderboard storage (Redis)
 * ------------------------------
 * We store per-post leaderboard in a single JSON blob:
 * key: dd:lb:<postId>
 *
 * {
 *   version: 1,
 *   users: {
 *     "<userId>": { member: "<displayName>", score: 123, updatedAt: 1700000000000 }
 *   }
 * }
 */

type LeaderboardStoreV1 = {
  version: 1;
  users: Record<
    string,
    {
      member: string;
      score: number;
      updatedAt: number;
    }
  >;
};

function keyLeaderboard(postId: string) {
  return `dd:lb:${postId}`;
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  const i = Math.floor(v);
  return Math.max(min, Math.min(max, i));
}

function normalizePostId(postId: string) {
  if (postId.startsWith("t3_")) {
    return postId;
  }
  return `t3_${postId}`;
}

function inferMediaType(imageDataUrl: string): "image" | "gif" {
  if (imageDataUrl.startsWith("data:image/gif")) {
    return "gif";
  }
  return "image";
}

async function readLeaderboardStore(postId: string): Promise<LeaderboardStoreV1> {
  const key = keyLeaderboard(postId);

  try {
    const raw = await (redis as any).get(key);
    if (!raw || typeof raw !== "string") {
      return { version: 1, users: {} };
    }

    const parsed = JSON.parse(raw) as any;
    if (!parsed || parsed.version !== 1 || typeof parsed.users !== "object" || parsed.users === null) {
      return { version: 1, users: {} };
    }

    return parsed as LeaderboardStoreV1;
  } catch (_err) {
    // If parse fails, start fresh.
    return { version: 1, users: {} };
  }
}

async function writeLeaderboardStore(postId: string, store: LeaderboardStoreV1): Promise<void> {
  const key = keyLeaderboard(postId);
  await (redis as any).set(key, JSON.stringify(store));
}

function computeTopAndRank(store: LeaderboardStoreV1, callerUserId: string, limit: number) {
  const all: Array<{ userId: string; member: string; score: number }> = Object.entries(store.users).map(
    ([userId, v]) => ({
      userId,
      member: String(v.member ?? userId),
      score: Number(v.score ?? 0) || 0,
    })
  );

  all.sort((a, b) => b.score - a.score);

  const top: LeaderboardEntry[] = all.slice(0, limit).map((x) => ({ member: x.member, score: x.score }));

  let callerRank: number | null = null;
  for (let i = 0; i < all.length; i++) {
    if (all[i].userId === callerUserId) {
      callerRank = i + 1;
      break;
    }
  }

  return { top, callerRank };
}

// ---------- Existing sample endpoints ----------
router.get<{ postId: string }, InitResponse | { status: string; message: string }>(
  "/api/init",
  async (_req, res): Promise<void> => {
    const { postId } = context;

    if (!postId) {
      console.error("API Init Error: postId not found in devvit context");
      res.status(400).json({
        status: "error",
        message: "postId is required but missing from context",
      });
      return;
    }

    try {
      const [count, username] = await Promise.all([redis.get("count"), reddit.getCurrentUsername()]);

      res.json({
        type: "init",
        postId: postId,
        count: count ? parseInt(count) : 0,
        username: username ?? "anonymous",
      });
    } catch (error) {
      console.error(`API Init Error for post ${postId}:`, error);
      let errorMessage = "Unknown error during initialization";
      if (error instanceof Error) {
        errorMessage = `Initialization failed: ${error.message}`;
      }
      res.status(400).json({ status: "error", message: errorMessage });
    }
  }
);

router.post<{ postId: string }, IncrementResponse | { status: string; message: string }, unknown>(
  "/api/increment",
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: "error",
        message: "postId is required",
      });
      return;
    }

    res.json({
      count: await redis.incrBy("count", 1),
      postId,
      type: "increment",
    });
  }
);

router.post<{ postId: string }, DecrementResponse | { status: string; message: string }, unknown>(
  "/api/decrement",
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: "error",
        message: "postId is required",
      });
      return;
    }

    res.json({
      count: await redis.incrBy("count", -1),
      postId,
      type: "decrement",
    });
  }
);

// ---------- NEW: Leaderboard endpoints ----------
router.post("/api/leaderboard/fetch", async (req: Request, res): Promise<void> => {
  const { postId } = context;

  if (!postId) {
    res.status(400).json({ status: "error", message: "postId is required" });
    return;
  }

  const body = (req.body ?? {}) as LeaderboardFetchRequest;

  const userId =
    (body && typeof body.userId === "string" && body.userId.trim()) ||
    (await reddit.getCurrentUsername()) ||
    "anonymous";

  const limit = clampInt(body.limit, 1, 50, 5);

  const store = await readLeaderboardStore(postId);
  const { top, callerRank } = computeTopAndRank(store, userId, limit);

  const payload: LeaderboardFetchResponse = {
    type: "leaderboard-fetch",
    top,
    callerRank,
  };

  res.json(payload);
});

router.post("/api/leaderboard/submit", async (req: Request, res): Promise<void> => {
  const { postId } = context;

  if (!postId) {
    res.status(400).json({ status: "error", message: "postId is required" });
    return;
  }

  const body = (req.body ?? {}) as LeaderboardSubmitRequest;

  const userId =
    (body && typeof body.userId === "string" && body.userId.trim()) ||
    (await reddit.getCurrentUsername()) ||
    "anonymous";

  const scoreNum = typeof body.score === "number" ? body.score : Number(body.score);
  const score = Number.isFinite(scoreNum) ? Math.floor(scoreNum) : 0;

  const limit = clampInt(body.limit, 1, 50, 5);

  // display name
  const displayName =
    (body.metadata && typeof body.metadata.username === "string" && body.metadata.username.trim()) ||
    (await reddit.getCurrentUsername()) ||
    userId;

  const store = await readLeaderboardStore(postId);

  const existing = store.users[userId];
  const prevBest = existing ? (Number(existing.score) || 0) : 0;

  const now = Date.now();
  let accepted = false;
  let bestScore = prevBest;
  let storeChanged = false;

  // Only accept if score improves
  if (!existing || score > prevBest) {
    store.users[userId] = {
      member: displayName,
      score: score,
      updatedAt: now,
    };
    accepted = true;
    bestScore = score;
    storeChanged = true;
  } else if (
    existing &&
    typeof displayName === "string" &&
    displayName.trim() &&
    displayName !== existing.member
  ) {
    store.users[userId] = {
      ...existing,
      member: displayName,
      updatedAt: now,
    };
    storeChanged = true;
  }

  if (storeChanged) {
    await writeLeaderboardStore(postId, store);
  }

  const { top, callerRank } = computeTopAndRank(store, userId, limit);

  const payload: LeaderboardSubmitResponse = {
    type: "leaderboard-submit",
    accepted,
    bestScore,
    top,
    callerRank,
  };

  res.json(payload);
});

router.post("/api/share/comment", async (req: Request, res): Promise<void> => {
  const { postId } = context;
  const body = (req.body ?? {}) as ShareImageCommentRequest;

  if (!postId) {
    res.status(400).json({ status: "error", message: "postId is required" });
    return;
  }

  const scoreNum = typeof body.score === "number" ? body.score : Number(body.score);
  const score = Number.isFinite(scoreNum) ? Math.floor(scoreNum) : NaN;
  const username =
    (body && typeof body.username === "string" && body.username.trim()) ||
    (await reddit.getCurrentUsername()) ||
    "anonymous";
  const imageDataUrl = body && typeof body.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";

  if (!Number.isFinite(score)) {
    res.status(400).json({ status: "error", message: "score is required" });
    return;
  }

  if (!username.trim()) {
    res.status(400).json({ status: "error", message: "username is required" });
    return;
  }

  if (!imageDataUrl) {
    res.status(400).json({ status: "error", message: "imageDataUrl is required" });
    return;
  }

  let upload: { mediaId: string };
  try {
    upload = await media.upload({
      url: imageDataUrl,
      type: inferMediaType(imageDataUrl),
    });
  } catch (error) {
    console.error("Share image upload failed:", error);
    const payload: ShareImageCommentResponse = {
      type: "share-image/post-comment",
      ok: false,
      message: error instanceof Error ? error.message : "Failed to upload image",
      stage: "upload",
    };
    res.status(502).json(payload);
    return;
  }

  const caption = `Score: ${score} • ${username}`;
  const richtext = new RichTextBuilder();
  if (caption) {
    richtext.paragraph((paragraph) => {
      paragraph.rawText(caption);
    });
  }
  richtext.image({ mediaId: upload.mediaId });

  let comment: { id: string };
  try {
    comment = await reddit.submitComment({
      id: normalizePostId(postId),
      richtext,
      runAs: "APP",
    });
  } catch (error) {
    console.error("Share image comment submit failed:", error);
    const payload: ShareImageCommentResponse = {
      type: "share-image/post-comment",
      ok: false,
      message: error instanceof Error ? error.message : "Failed to post comment",
      stage: "comment",
    };
    res.status(502).json(payload);
    return;
  }

  const payload: ShareImageCommentResponse = {
    type: "share-image/post-comment",
    ok: true,
    commentId: comment.id,
  };

  res.json(payload);
});

// ---------- Devvit internal endpoints ----------
router.post("/internal/on-app-install", async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      status: "success",
      message: `Post created in subreddit ${context.subredditName} with id ${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: "error",
      message: "Failed to create post",
    });
  }
});

router.post("/internal/menu/post-create", async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: "error",
      message: "Failed to create post",
    });
  }
});

app.use(router);

const server = createServer(app);
server.on("error", (err) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort());
