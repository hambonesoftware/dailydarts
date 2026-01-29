export type InitResponse = {
  type: "init";
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: "increment";
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: "decrement";
  postId: string;
  count: number;
};

export type LeaderboardEntry = {
  userId: string;
  score: number;
  submittedAt: number;
  rank: number;
  metadata?: Record<string, string>;
};

export type LeaderboardSubmitRequest = {
  userId: string;
  score: number;
  limit?: number;
  metadata?: Record<string, string>;
};

export type LeaderboardSubmitResponse = {
  type: "leaderboard-submit";
  postId: string;
  top: LeaderboardEntry[];
  callerRank: number | null;
};

export type LeaderboardFetchRequest = {
  userId: string;
  limit?: number;
};

export type LeaderboardFetchResponse = {
  type: "leaderboard-fetch";
  postId: string;
  top: LeaderboardEntry[];
  callerRank: number | null;
};
