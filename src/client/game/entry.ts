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

  const text = document.createElement("div");
  text.style.position = "absolute";
  text.style.opacity = "0";
  text.style.pointerEvents = "none";
  text.textContent = "Loading assets…";

  overlay.appendChild(dimmer);

  document.body.appendChild(overlay);

  const hide = () => {
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    window.setTimeout(() => {
      overlay.remove();
    }, 260);
  };

  return {
    setMessage: (message: string) => {
      text.textContent = message;
    },
    hide,
  };
}

const loadingOverlay = createLoadingOverlay();

async function bootstrapGame(target: HTMLDivElement) {
  const mountGame = await loadGame();
  mountGame(target, {
    onLoadingProgress: ({ percent, message }) => {
      if (typeof percent === "number") {
        loadingOverlay.setMessage(
          `${message ?? "Loading assets…"} ${Math.round(percent)}%`
        );
        return;
      }
      loadingOverlay.setMessage(message ?? "Loading assets…");
    },
    onLoadingDone: () => {
      loadingOverlay.hide();
    },
  });
}

bootstrapGame(app).catch(showError);
