import crypto from "crypto";
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
import { createPost, suggestNextPostTitle } from "./core/post";

const app = express();

// Middleware for JSON body parsing
app.use(express.json({ limit: "3mb" }));
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

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "";
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function isMediaUploadRejected(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("too large") ||
    normalized.includes("file size") ||
    normalized.includes("unsupported") ||
    normalized.includes("file type") ||
    normalized.includes("format") ||
    normalized.includes("mime") ||
    normalized.includes("domain") ||
    normalized.includes("url")
  );
}

function isRateLimited(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("ratelimit") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  );
}

type MediaReadyParams = {
  mediaId: string;
  mediaUrl?: string;
};

type MediaReadyResult = { ok: true } | { ok: false; reason: "timeout" | "missing-url" };

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForMediaReady({
  mediaId,
  mediaUrl,
}: MediaReadyParams): Promise<MediaReadyResult> {
  if (!mediaUrl) {
    console.warn("share/comment missing mediaUrl for readiness check", { mediaId });
    return { ok: false, reason: "missing-url" };
  }

  const timeoutMs = 15_000;
  const start = Date.now();
  let attempt = 0;
  let delayMs = 250;

  while (Date.now() - start < timeoutMs) {
    attempt += 1;
    try {
      let response = await fetchWithTimeout(
        mediaUrl,
        {
          method: "HEAD",
          cache: "no-store",
        },
        4_000
      );

      if (response.status === 405) {
        response = await fetchWithTimeout(
          mediaUrl,
          {
            method: "GET",
            cache: "no-store",
          },
          4_000
        );
      }

      if (response.ok) {
        console.debug("share/comment media ready", { mediaId, attempt });
        return { ok: true };
      }

      if (response.status >= 500) {
        console.debug("share/comment media not ready", { mediaId, attempt, status: response.status });
      }
    } catch (error) {
      console.debug("share/comment media check failed", { mediaId, attempt, error });
    }

    const jitter = Math.floor(Math.random() * 150);
    const waitMs = Math.min(delayMs + jitter, 2_000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    delayMs = Math.min(delayMs * 2, 2_000);
  }

  console.warn("share/comment media readiness timed out", { mediaId });
  return { ok: false, reason: "timeout" };
}

function keyShareRateLimit(postId: string, userId: string) {
  return `dd:share:${postId}:${userId}`;
}

function keyShareImageCache(payloadHash: string) {
  return `dd:share:image:${payloadHash}`;
}

function hashShareImagePayload(payload: string) {
  return crypto.createHash("sha256").update(payload).digest("hex");
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

async function resolveServerIdentity(): Promise<{ userId: string; displayName: string } | null> {
  const ctx = context as { userName?: string; userId?: string };
  const contextUserId = ctx.userId !== undefined && ctx.userId !== null ? String(ctx.userId).trim() : "";
  const contextUserName = typeof ctx.userName === "string" ? ctx.userName.trim() : "";
  const redditUsernameRaw = await reddit.getCurrentUsername();
  const redditUsername = typeof redditUsernameRaw === "string" ? redditUsernameRaw.trim() : "";

  const userId = contextUserId || contextUserName || redditUsername;
  if (!userId) {
    return null;
  }

  const displayName = redditUsername || contextUserName || contextUserId || userId;
  return { userId, displayName };
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

  const identity = await resolveServerIdentity();
  if (!identity) {
    res.status(401).json({ status: "error", message: "authentication required" });
    return;
  }

  const limit = clampInt(body.limit, 1, 50, 5);

  const store = await readLeaderboardStore(postId);
  const { top, callerRank } = computeTopAndRank(store, identity.userId, limit);

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

  const identity = await resolveServerIdentity();
  if (!identity) {
    res.status(401).json({ status: "error", message: "authentication required" });
    return;
  }

  const scoreNum = typeof body.score === "number" ? body.score : Number(body.score);
  const score = Number.isFinite(scoreNum) ? Math.floor(scoreNum) : 0;

  const limit = clampInt(body.limit, 1, 50, 5);

  const { userId, displayName } = identity;

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
  const now = Date.now();
  const shareRateLimitMs = 500 * 1000;
  const shareImageCacheTtlSec = 60 * 60 * 24;

  if (!postId) {
    res.status(400).json({ status: "error", message: "postId is required" });
    return;
  }

  const scoreNum = typeof body.score === "number" ? body.score : Number(body.score);
  const score = Number.isFinite(scoreNum) ? Math.floor(scoreNum) : NaN;
  const userId =
    (body && typeof body.userId === "string" && body.userId.trim()) ||
    (await reddit.getCurrentUsername()) ||
    "anonymous";
  const username =
    (body && typeof body.username === "string" && body.username.trim()) ||
    (await reddit.getCurrentUsername()) ||
    "anonymous";
  const imageDataUrl = body && typeof body.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";
  if (!Number.isFinite(score)) {
    res.status(400).json({ status: "error", message: "score is required" });
    return;
  }

  if (!imageDataUrl) {
    res.status(400).json({ status: "error", message: "imageDataUrl is required" });
    return;
  }

  if (!username.trim()) {
    res.status(400).json({ status: "error", message: "username is required" });
    return;
  }

  const rateKey = keyShareRateLimit(postId, userId);
  const lastShareRaw = await (redis as any).get(rateKey);
  const lastShare = typeof lastShareRaw === "string" ? Number(lastShareRaw) : Number(lastShareRaw);
  if (Number.isFinite(lastShare) && now - lastShare < shareRateLimitMs) {
    const remainingSeconds = Math.ceil((shareRateLimitMs - (now - lastShare)) / 1000);
    const payload: ShareImageCommentResponse = {
      type: "share-image/post-comment",
      ok: false,
      message: `You're rate limited. Try again in ${remainingSeconds}s.`,
      stage: "comment",
    };
    res.status(429).json(payload);
    return;
  }

  const payloadHash = hashShareImagePayload(imageDataUrl);
  const cacheKey = keyShareImageCache(payloadHash);
  const cachedMediaIdRaw = await (redis as any).get(cacheKey);
  const cachedMediaId = typeof cachedMediaIdRaw === "string" ? cachedMediaIdRaw.trim() : "";

  let mediaId = cachedMediaId;
  let mediaUrl: string | undefined;
  if (!mediaId) {
    let upload: { mediaId: string; mediaUrl?: string };
    try {
      upload = await media.upload({
        url: imageDataUrl,
        type: inferMediaType(imageDataUrl),
      });
    } catch (error) {
      console.error("Share image upload failed:", error);
      const errorMessage = normalizeErrorMessage(error);
      const payload: ShareImageCommentResponse = {
        type: "share-image/post-comment",
        ok: false,
        message: isMediaUploadRejected(errorMessage)
          ? "Image too large/unsupported format."
          : errorMessage || "Failed to upload image",
        stage: "upload",
      };
      res.status(502).json(payload);
      return;
    }

    mediaId = upload.mediaId;
    mediaUrl = upload.mediaUrl;
    console.debug("share/comment upload", {
      mediaId: upload.mediaId,
      mediaUrl: (upload as { mediaUrl?: string }).mediaUrl,
    });

    await (redis as any).set(cacheKey, mediaId);
    await (redis as any).expire(cacheKey, shareImageCacheTtlSec);
  } else {
    console.debug("share/comment cache hit", { mediaId, cacheKey });
  }

  const readiness = await waitForMediaReady({ mediaId, mediaUrl });
  if (!readiness.ok && readiness.reason === "timeout") {
    const payload: ShareImageCommentResponse = {
      type: "share-image/post-comment",
      ok: false,
      message: "Your image is still processing. Please retry in a moment.",
      stage: "comment",
    };
    res.status(503).json(payload);
    return;
  }

  const resultLine = `Round result: ${username} scored ${score}.`;
  const richtextBuilder = new RichTextBuilder()
    .paragraph((paragraph) => paragraph.text({ text: resultLine }))
    .image({ mediaId });
  const richtext = typeof richtextBuilder.build === "function" ? richtextBuilder.build() : richtextBuilder;

  let comment: { id: string };
  try {
    const normalizedParentId = normalizePostId(postId);
    console.debug("share/comment parent", { parentId: normalizedParentId });
    const maxAttempts = 5;
    const baseDelayMs = 500;
    const maxDelayMs = 4_000;
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        console.debug("share/comment submit attempt", { attempt });
        comment = await reddit.submitComment({
          id: normalizedParentId,
          richtext,
          runAs: "APP",
        });
        break;
      } catch (error) {
        const errorMessage = normalizeErrorMessage(error);
        const errorStatus =
          typeof (error as { status?: number; statusCode?: number })?.status === "number"
            ? (error as { status?: number }).status
            : typeof (error as { statusCode?: number })?.statusCode === "number"
              ? (error as { statusCode?: number }).statusCode
              : undefined;
        const normalizedMessage = errorMessage.toLowerCase();
        const isTransientMessage =
          normalizedMessage.includes("timeout") ||
          normalizedMessage.includes("timed out") ||
          normalizedMessage.includes("etimedout") ||
          normalizedMessage.includes("econnreset") ||
          normalizedMessage.includes("econnrefused") ||
          normalizedMessage.includes("enotfound") ||
          normalizedMessage.includes("eai_again") ||
          normalizedMessage.includes("network") ||
          normalizedMessage.includes("socket hang up");
        const shouldRetry =
          errorMessage.includes("IMAGE_MEDIA_IN_COMMENTS_PROCESSING_FAILURE") ||
          (typeof errorStatus === "number" && errorStatus >= 500 && errorStatus < 600) ||
          isTransientMessage;
        const hasAttemptsLeft = attempt < maxAttempts;
        console.warn("share/comment submit failed", {
          attempt,
          error: errorMessage || error,
          status: errorStatus,
          retrying: shouldRetry && hasAttemptsLeft,
        });
        if (!shouldRetry || !hasAttemptsLeft) {
          console.error("share/comment submit failed permanently", {
            attempt,
            error: errorMessage || error,
            status: errorStatus,
          });
          throw error;
        }
        const backoffMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        const jitterMs = Math.floor(Math.random() * 250);
        const delayMs = backoffMs + jitterMs;
        console.info("share/comment retry delay", { attempt, delayMs });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } catch (error) {
    console.error("Share image comment submit failed:", error);
    const errorMessage = normalizeErrorMessage(error);
    if (isRateLimited(errorMessage)) {
      const payload: ShareImageCommentResponse = {
        type: "share-image/post-comment",
        ok: false,
        message: "You're rate limited. No comment was posted; please try again later.",
        stage: "comment",
      };
      res.status(429).json(payload);
      return;
    }
    const payload: ShareImageCommentResponse = {
      type: "share-image/post-comment",
      ok: false,
      message: errorMessage || "Failed to post comment",
      stage: "comment",
    };
    res.status(502).json(payload);
    return;
  }

  console.debug("share/comment submitted", { commentId: comment.id });
  await (redis as any).set(rateKey, String(now));

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

router.get("/api/post/fetch", async (_req, res): Promise<void> => {
  const { postId } = context;
  if (!postId) {
    res.status(400).json({ status: "error", message: "postId is required" });
    return;
  }

  try {
    const normalizedPostId = normalizePostId(postId);
    const post = await reddit.getPostById(normalizedPostId);
    const title = typeof post?.title === "string" ? post.title : "";
    res.json({ type: "post-fetch", postId: normalizedPostId, title });
  } catch (error) {
    console.error("Error fetching post data", error);
    res.status(502).json({ status: "error", message: "Failed to fetch post data" });
  }
});

router.get("/api/post-title/suggest", async (_req, res): Promise<void> => {
  try {
    const title = await suggestNextPostTitle();
    res.json({ title });
  } catch (error) {
    console.error(`Error suggesting post title: ${error}`);
    res.status(400).json({
      status: "error",
      message: "Failed to suggest post title",
    });
  }
});

router.post("/api/post-create", async (req, res): Promise<void> => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) {
      res.status(400).json({ status: "error", message: "Title is required" });
      return;
    }

    const post = await createPost({ title });
    res.json({
      postId: post.id,
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

router.post("/internal/menu/post-create", async (_req, res): Promise<void> => {
  try {
    const { appSlug, subredditName, appVersion } = context;
    if (!appSlug || !subredditName || !appVersion) {
      const post = await createPost();
      res.json({
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      });
      return;
    }
    res.json({
      navigateTo: `https://${appSlug}-${subredditName}-${appVersion}.devvit.net/post-create.html`,
    });
  } catch (error) {
    console.error(`Error opening post-create flow: ${error}`);
    res.status(400).json({
      status: "error",
      message: "Failed to open post create form",
    });
  }
});

app.use(router);

const server = createServer(app);
server.on("error", (err) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort());
