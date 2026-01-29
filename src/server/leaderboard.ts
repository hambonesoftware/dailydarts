type RedisLike = {
  zAdd: (key: string, ...members: { member: string; score: number }[]) => Promise<number>;
  zRange: (
    key: string,
    start: number,
    stop: number,
    options: { by: "rank"; reverse?: boolean }
  ) => Promise<{ member: string; score: number }[]>;
  zRank: (key: string, member: string) => Promise<number | undefined>;
  zCard: (key: string) => Promise<number>;
  hGet: (key: string, field: string) => Promise<string | undefined>;
  hMGet: (key: string, fields: string[]) => Promise<(string | null)[]>;
  hSet: (key: string, fieldValues: Record<string, string>) => Promise<number>;
};

export type LeaderboardEntry = {
  userId: string;
  score: number;
  submittedAt: number;
  rank: number;
  metadata?: Record<string, string>;
};

type StoredLeaderboardRecord = Omit<LeaderboardEntry, "userId" | "rank">;

const SCORE_MULTIPLIER = 1_000_000_000_000;

const leaderboardKey = (postId: string): string => `leaderboard:${postId}`;
const leaderboardMetaKey = (postId: string): string => `leaderboard:${postId}:meta`;

const encodeMetadata = (record: StoredLeaderboardRecord): string => JSON.stringify(record);

const decodeMetadata = (value: string | null | undefined): StoredLeaderboardRecord | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as StoredLeaderboardRecord;
  } catch (error) {
    console.warn("Failed to parse leaderboard metadata", error);
    return null;
  }
};

const toCompositeScore = (score: number, submittedAt: number): number =>
  score * SCORE_MULTIPLIER - submittedAt;

export const upsertScore = async (
  redis: RedisLike,
  postId: string,
  userId: string,
  score: number,
  metadata?: Record<string, string>
): Promise<StoredLeaderboardRecord> => {
  const metaKey = leaderboardMetaKey(postId);
  const existing = decodeMetadata(await redis.hGet(metaKey, userId));
  if (existing && existing.score >= score) {
    return existing;
  }

  const submittedAt = Date.now();
  const record = { score, submittedAt, metadata };
  await Promise.all([
    redis.hSet(metaKey, { [userId]: encodeMetadata(record) }),
    redis.zAdd(leaderboardKey(postId), {
      member: userId,
      score: toCompositeScore(score, submittedAt),
    }),
  ]);
  return record;
};

export const fetchTopN = async (
  redis: RedisLike,
  postId: string,
  limit: number
): Promise<LeaderboardEntry[]> => {
  if (limit <= 0) return [];
  const key = leaderboardKey(postId);
  const topEntries = await redis.zRange(key, 0, limit - 1, { by: "rank", reverse: true });
  if (!topEntries.length) return [];

  const metaKey = leaderboardMetaKey(postId);
  const members = topEntries.map((entry) => entry.member);
  const metaValues = await redis.hMGet(metaKey, members);

  return topEntries.map((entry, index) => {
    const meta = decodeMetadata(metaValues[index]);
    return {
      userId: entry.member,
      score: meta?.score ?? entry.score,
      submittedAt: meta?.submittedAt ?? 0,
      metadata: meta?.metadata,
      rank: index + 1,
    };
  });
};

export const getRankForUser = async (
  redis: RedisLike,
  postId: string,
  userId: string
): Promise<number | null> => {
  const key = leaderboardKey(postId);
  const [rank, total] = await Promise.all([redis.zRank(key, userId), redis.zCard(key)]);
  if (rank === undefined) return null;
  return total - rank;
};
