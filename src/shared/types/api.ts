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
  member: string;
  score: number;
};

export type LeaderboardFetchRequest = {
  userId: string;
  limit?: number;
};

export type LeaderboardFetchResponse = {
  type: "leaderboard-fetch";
  top: LeaderboardEntry[];
  callerRank: number | null;
};

export type LeaderboardSubmitRequest = {
  userId: string;
  score: number;
  limit?: number;
  metadata?: {
    username?: string;
  };
};

export type LeaderboardSubmitResponse = {
  type: "leaderboard-submit";
  accepted: boolean;
  bestScore: number;
  top: LeaderboardEntry[];
  callerRank: number | null;
};

export type ShareImageCommentRequest = {
  score: number;
  username: string;
  imageDataUrl: string;
};

export type ShareImageCommentResponse = {
  type: "share-image/post-comment";
  ok: boolean;
  degraded?: true;
  commentId?: string;
  message?: string;
  stage?: "upload" | "comment" | "unknown";
};
