import { loadGame } from "./index";

function ensureAppMount(): HTMLDivElement {
  let app = document.getElementById("app") as HTMLDivElement | null;
  if (!app) {
    app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
  }
  return app;
}

function showError(err: unknown) {
  const msg = String(err instanceof Error ? err.stack || err.message : err);
  const box = document.createElement("pre");
  box.style.position = "fixed";
  box.style.left = "12px";
  box.style.right = "12px";
  box.style.bottom = "12px";
  box.style.maxHeight = "45%";
  box.style.overflow = "auto";
  box.style.padding = "12px";
  box.style.background = "rgba(0,0,0,0.75)";
  box.style.color = "white";
  box.style.fontSize = "12px";
  box.style.borderRadius = "8px";
  box.style.zIndex = "999999";
  box.textContent = "❌ Game load error:\n\n" + msg;
  document.body.appendChild(box);
}

const app = ensureAppMount();

function createLoadingOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "game-loading-overlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "url('/chalkboard.jpg') center/cover no-repeat";
  overlay.style.overflow = "hidden";
  overlay.style.color = "#fff";
  overlay.style.zIndex = "99999";
  overlay.style.fontFamily = "system-ui, sans-serif";
  overlay.style.transition = "opacity 250ms ease";

  const dimmer = document.createElement("div");
  dimmer.style.position = "absolute";
  dimmer.style.inset = "0";
  dimmer.style.background = "rgba(7, 8, 12, 0.55)";
  dimmer.style.pointerEvents = "none";

  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";

  overlay.appendChild(dimmer);
  overlay.appendChild(canvas);

  document.body.appendChild(overlay);

  const ctx = canvas.getContext("2d");
  let frameId = 0;
  let lastFrameTime = 0;
  let dashOffset = 0;
  const fpsInterval = 1000 / 15;

  const resizeCanvas = () => {
    const { innerWidth, innerHeight, devicePixelRatio } = window;
    canvas.width = Math.max(1, Math.floor(innerWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(innerHeight * devicePixelRatio));
    if (ctx) {
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
  };

  const drawChalkLine = (x1: number, y1: number, x2: number, y2: number) => {
    if (!ctx) return;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1 + 1, y1 + 1);
    ctx.lineTo(x2 + 1, y2 + 1);
    ctx.stroke();
  };

  const drawDart = (x: number, y: number, length: number) => {
    if (!ctx) return;
    const bodyLength = length * 0.65;
    const tipLength = length * 0.12;
    const tailLength = length * 0.23;

    drawChalkLine(x, y, x + bodyLength, y);
    drawChalkLine(x + bodyLength, y, x + bodyLength + tipLength, y);
    drawChalkLine(x + bodyLength + tipLength, y, x + bodyLength + tipLength - 6, y - 3);
    drawChalkLine(x + bodyLength + tipLength, y, x + bodyLength + tipLength - 6, y + 3);

    drawChalkLine(x - tailLength * 0.2, y, x, y);
    drawChalkLine(x - tailLength * 0.9, y - 6, x, y);
    drawChalkLine(x - tailLength * 0.9, y + 6, x, y);
  };

  const drawDartboard = (x: number, y: number, radius: number) => {
    if (!ctx) return;
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    drawChalkLine(x - radius, y, x + radius, y);
    drawChalkLine(x, y - radius, x, y + radius);
  };

  const drawTrajectory = (startX: number, startY: number, endX: number, endY: number) => {
    if (!ctx) return;
    ctx.save();
    ctx.setLineDash([8, 10]);
    ctx.lineDashOffset = -dashOffset;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
  };

  const render = (timestamp: number) => {
    frameId = window.requestAnimationFrame(render);
    if (timestamp - lastFrameTime < fpsInterval) {
      return;
    }
    lastFrameTime = timestamp;
    if (!ctx) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);

    const dartY = height * 0.55;
    const dartStart = width * 0.15;
    const dartLength = Math.min(120, width * 0.2);
    const boardX = width * 0.82;
    const boardY = height * 0.48;
    const boardRadius = Math.min(80, width * 0.08);

    drawTrajectory(dartStart + dartLength * 0.2, dartY, boardX - boardRadius, boardY);
    drawDart(dartStart, dartY, dartLength);
    drawDartboard(boardX, boardY, boardRadius);

    dashOffset += 6;
  };

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  frameId = window.requestAnimationFrame(render);

  const hide = () => {
    window.cancelAnimationFrame(frameId);
    window.removeEventListener("resize", resizeCanvas);
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    window.setTimeout(() => {
      overlay.remove();
    }, 260);
  };

  return {
    setMessage: () => {},
    hide,
  };
}

const loadingOverlay = createLoadingOverlay();

async function bootstrapGame(target: HTMLDivElement) {
  const mountGame = await loadGame();
  mountGame(target, {
    onLoadingProgress: ({ percent, message }) => {
      void percent;
      void message;
    },
    onLoadingDone: () => {
      loadingOverlay.hide();
    },
  });
}

bootstrapGame(app).catch(showError);
