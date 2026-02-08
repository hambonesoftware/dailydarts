import { navigateTo, context, requestExpandedMode } from "@devvit/web/client";

type LeaderboardEntry = {
  member: string;
  score: number;
};

const docsLink = document.getElementById("docs-link") as HTMLDivElement | null;
const playtestLink = document.getElementById("playtest-link") as HTMLDivElement | null;
const discordLink = document.getElementById("discord-link") as HTMLDivElement | null;
const startButton = document.getElementById("start-button") as HTMLButtonElement | null;

const titleElement = document.getElementById("title") as HTMLHeadingElement | null;

const canvas = document.getElementById("splash-canvas") as HTMLCanvasElement | null;
const ctx = canvas ? canvas.getContext("2d") : null;

// ---- Config ----
const LEADERBOARD_MAX_ROWS = 10;
const LEADERBOARD_FETCH_ENDPOINT = "/api/leaderboard/fetch";
const LEADERBOARD_REFRESH_MS = 15_000;

// Animation config (light + battery-friendly)
const TARGET_FPS = 30;
const FRAME_MS = 1000 / TARGET_FPS;

// ---- State ----
let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
let lastW = 0;
let lastH = 0;

let leaderboard: LeaderboardEntry[] = [];
let leaderboardStatus: "loading" | "ready" | "error" = "loading";
let leaderboardError = "";

let lastFrameTs = 0;
let animRunning = true;

// ---- Background Image ----
const bgImage = new Image();
let bgReady = false;

bgImage.src = "/chalkboard.jpg";
bgImage.onload = () => {
  bgReady = true;
};
bgImage.onerror = () => {
  bgReady = false;
};

// ---- Particles (chalk dust) ----
type Dust = {
  x: number;
  y: number;
  r: number;
  a: number;
  vy: number;
  vx: number;
};

const dust: Dust[] = [];
let dustInitialized = false;

function safeUsername(): string {
  return context.username ?? "user";
}

function safePostId(): string | undefined {
  const anyCtx = context as any;
  return anyCtx.postId ?? anyCtx.post?.id ?? anyCtx.post?.name ?? undefined;
}

function bindUI() {
  if (startButton) {
    startButton.addEventListener("click", (e) => {
      requestExpandedMode(e, "game");
    });
  }

  if (docsLink) {
    docsLink.addEventListener("click", () => navigateTo("https://developers.reddit.com/docs"));
  }
  if (playtestLink) {
    playtestLink.addEventListener("click", () => navigateTo("https://www.reddit.com/r/Devvit"));
  }
  if (discordLink) {
    discordLink.addEventListener("click", () => navigateTo("https://discord.com/invite/R7yu2wh9Qz"));
  }
}

function setTitleTextForHTML() {
  if (titleElement) titleElement.textContent = "";
}

function resizeCanvasToDisplaySize() {
  if (!canvas || !ctx) return;

  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.floor(rect.width || window.innerWidth));
  const cssH = Math.max(1, Math.floor(rect.height || window.innerHeight));

  const nextDpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const changed = cssW !== lastW || cssH !== lastH || nextDpr !== dpr;

  if (!changed) return;

  dpr = nextDpr;
  lastW = cssW;
  lastH = cssH;

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Re-init dust for new size so density feels right
  initDust(cssW, cssH);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function initDust(w: number, h: number) {
  dust.length = 0;

  // Density: fewer particles on mobile to keep it clean
  const area = w * h;
  const count = clamp(Math.floor(area / 18000), 18, 60);

  for (let i = 0; i < count; i++) {
    dust.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 1.9,
      a: 0.05 + Math.random() * 0.12,
      vy: 6 + Math.random() * 18, // pixels/sec upward
      vx: -3 + Math.random() * 6,
    });
  }

  dustInitialized = true;
}

function updateDust(dtSec: number, w: number, h: number) {
  if (!dustInitialized) initDust(w, h);

  for (let i = 0; i < dust.length; i++) {
    const p = dust[i];
    p.x += p.vx * dtSec;
    p.y -= p.vy * dtSec;

    if (p.y < -10) {
      p.y = h + 10;
      p.x = Math.random() * w;
    }
    if (p.x < -10) p.x = w + 10;
    if (p.x > w + 10) p.x = -10;
  }
}

function drawDust(w: number, h: number, timeMs: number) {
  if (!ctx) return;

  // Slight pulse to avoid looking like static snow
  const pulse = 0.75 + 0.25 * Math.sin(timeMs * 0.0007);

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,1)";
  for (let i = 0; i < dust.length; i++) {
    const p = dust[i];
    ctx.globalAlpha = p.a * pulse;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBackgroundImageCover(w: number, h: number, timeMs: number) {
  if (!ctx) return;

  // Fallback if image isn’t ready
  ctx.fillStyle = "#070809";
  ctx.fillRect(0, 0, w, h);

  if (!bgReady) return;

  const iw = bgImage.naturalWidth || bgImage.width;
  const ih = bgImage.naturalHeight || bgImage.height;
  if (!iw || !ih) return;

  // Slow drift (tiny), plus slight scale so edges never show
  const driftX = Math.sin(timeMs * 0.00010) * 8;
  const driftY = Math.cos(timeMs * 0.00013) * 6;
  const extraScale = 1.04;

  const scale = Math.max(w / iw, h / ih) * extraScale;
  const dw = iw * scale;
  const dh = ih * scale;

  const dx = (w - dw) * 0.5 + driftX;
  const dy = (h - dh) * 0.5 + driftY;

  ctx.drawImage(bgImage, dx, dy, dw, dh);

  // Darken just a touch so chalk pops
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Vignette for depth
  const vg = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.15, w * 0.5, h * 0.45, Math.max(w, h) * 0.85);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.65)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // Frame border
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.restore();
}
 
 function chalkText(
  text: string,
  x: number,
  y: number,
  sizePx: number,
  align: CanvasTextAlign,
  weight: number,
  glowAlpha: number
) {
  if (!ctx) return;

  const font = `${weight} ${sizePx}px ui-rounded, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.font = font;

  // STATIC text: no per-frame random offsets
  ctx.save();

  // Main fill
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillText(text, x, y);

  // Soft edge glow (still static)
  ctx.globalAlpha = glowAlpha;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.strokeText(text, x, y);

  ctx.restore();
}


function drawLeaderboard(w: number, h: number, timeMs: number) {
  if (!ctx) return;

  // Reserve bottom space so canvas never competes with START + footer
  const bottomReserve = h < 720 ? 190 : 220;

  const centerX = w * 0.5;

  // Responsive title sizing for mobile
  const titleSize = clamp(Math.floor(w * 0.12), 38, 70);
  const subSize = clamp(Math.floor(w * 0.042), 14, 22);

  const topY = clamp(Math.floor(h * 0.18), 92, 150);

  // Tiny breathing glow
  const titleGlow = 0.14 + 0.08 * (0.5 + 0.5 * Math.sin(timeMs * 0.0012));

  chalkText("Daily Darts", centerX, topY, titleSize, "center", 900, titleGlow);
  chalkText(`Hey ${safeUsername()} 👋`, centerX, topY + Math.floor(titleSize * 0.62), subSize, "center", 700, 0.12);

  // Panel
  const boxW = Math.min(660, w * 0.90);
  const boxX = Math.floor(centerX - boxW / 2);
  const boxY = Math.floor(topY + titleSize + 36);
  const boxH = Math.max(180, Math.min(420, h - boxY - bottomReserve));

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.restore();

  // Header
  chalkText("Leaderboard", boxX + 18, boxY + 44, 26, "left", 900, 0.12);

  // Status line (kept tight for mobile)
  let statusLine = "";
  if (leaderboardStatus === "loading") statusLine = "Loading scores…";
  if (leaderboardStatus === "ready" && leaderboard.length === 0) statusLine = "No scores yet — be the first!";
  if (leaderboardStatus === "error") statusLine = "Couldn't load leaderboard";
  if (statusLine) {
    chalkText(statusLine, boxX + 18, boxY + 70, 16, "left", 700, 0.10);
  }
  if (leaderboardStatus === "error" && leaderboardError) {
    const msg = leaderboardError.length > 60 ? leaderboardError.slice(0, 60) + "…" : leaderboardError;
    chalkText(msg, boxX + 18, boxY + 92, 13, "left", 600, 0.08);
  }

  // Determine how many rows can fit cleanly
  const headerPad = 108;
  const usableH = boxH - headerPad - 18;
  const rowGap = 30;
  const maxRowsByHeight = clamp(Math.floor(usableH / rowGap), 1, LEADERBOARD_MAX_ROWS);

  const rows = leaderboard.slice(0, maxRowsByHeight);

  const rowStartY = boxY + headerPad;
  const colRankX = boxX + 20;
  const colNameX = boxX + 72;
  const colScoreX = boxX + boxW - 20;

  // Column labels (smaller + cleaner)
  ctx.save();
  ctx.globalAlpha = 0.70;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `700 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
  ctx.textAlign = "left";
  ctx.fillText("#", colRankX, rowStartY - 14);
  ctx.fillText("Player", colNameX, rowStartY - 14);
  ctx.textAlign = "right";
  ctx.fillText("Score", colScoreX, rowStartY - 14);
  ctx.restore();

  for (let i = 0; i < rows.length; i++) {
    const y = rowStartY + i * rowGap;
    const rank = i + 1;
    const name = rows[i].member || "Unknown";
    const score = rows[i].score ?? 0;

    // Separator
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boxX + 14, y + 10);
    ctx.lineTo(boxX + boxW - 14, y + 10);
    ctx.stroke();
    ctx.restore();

    // Draw values
    chalkText(String(rank), colRankX, y, 18, "left", 900, 0.10);

    const maxNameLen = w < 380 ? 14 : 18;
    const shownName = name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + "…" : name;
    chalkText(shownName, colNameX, y, 18, "left", 800, 0.10);

    chalkText(String(score), colScoreX, y, 18, "right", 900, 0.10);
  }

  // Remove the old "Press Start to play" line (it competes with footer on mobile)
}

async function fetchLeaderboard(): Promise<void> {
  leaderboardStatus = "loading";
  leaderboardError = "";

  try {
    const postId = safePostId();
    const username = safeUsername();

    const res = await fetch(LEADERBOARD_FETCH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        postId,
        userId: username,
        limit: LEADERBOARD_MAX_ROWS,
        metadata: { username },
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as any;

    const entriesRaw =
      Array.isArray(data?.top) ? data.top :
      Array.isArray(data) ? data :
      Array.isArray(data?.leaderboard) ? data.leaderboard :
      Array.isArray(data?.entries) ? data.entries :
      [];

    const parsed: LeaderboardEntry[] = entriesRaw
      .filter((x: any) => x && typeof x === "object")
      .map((x: any) => ({
        member: String(x.member ?? x.username ?? x.user ?? "Unknown"),
        score: Number(x.score ?? x.value ?? 0) || 0,
      }))
      .sort((a, b) => b.score - a.score);

    leaderboard = parsed;
    leaderboardStatus = "ready";
    leaderboardError = "";
  } catch (err) {
    leaderboard = [];
    leaderboardStatus = "error";
    leaderboardError = err instanceof Error ? err.message : String(err);
  }
}

function installResizeHandler() {
  let t: number | null = null;
  window.addEventListener("resize", () => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => {
      // Reset timing so the next frame is crisp
      lastFrameTs = 0;
      t = null;
    }, 60);
  });
}

function installVisibilityHandler() {
  document.addEventListener("visibilitychange", () => {
    animRunning = !document.hidden;
    if (animRunning) {
      lastFrameTs = 0;
      requestAnimationFrame(onFrame);
    }
  });
}

function onFrame(ts: number) {
  if (!canvas || !ctx) return;
  if (!animRunning) return;

  if (!lastFrameTs) lastFrameTs = ts;
  const dt = ts - lastFrameTs;

  if (dt >= FRAME_MS) {
    lastFrameTs = ts;

    resizeCanvasToDisplaySize();

    const w = Math.floor(canvas.width / dpr);
    const h = Math.floor(canvas.height / dpr);

    const dtSec = dt / 1000;

    // Update + draw
    updateDust(dtSec, w, h);
    drawBackgroundImageCover(w, h, ts);
    drawDust(w, h, ts);
    drawLeaderboard(w, h, ts);
  }

  requestAnimationFrame(onFrame);
}

function startLeaderboardRefresh() {
  void fetchLeaderboard();
  window.setInterval(() => void fetchLeaderboard(), LEADERBOARD_REFRESH_MS);
}

function init() {
  bindUI();
  setTitleTextForHTML();
  installResizeHandler();
  installVisibilityHandler();

  if (!canvas || !ctx) {
    if (titleElement) titleElement.textContent = `Daily Darts — Hey ${safeUsername()} 👋`;
    return;
  }

  // Initial dust init
  initDust(window.innerWidth, window.innerHeight);

  // Start fetching leaderboard + animation loop
  startLeaderboardRefresh();
  requestAnimationFrame(onFrame);
}

init();
