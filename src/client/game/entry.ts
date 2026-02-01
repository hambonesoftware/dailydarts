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
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.background = "rgba(7, 8, 12, 0.92)";
  overlay.style.color = "#fff";
  overlay.style.zIndex = "99999";
  overlay.style.fontFamily = "system-ui, sans-serif";
  overlay.style.transition = "opacity 250ms ease";

  const content = document.createElement("div");
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.alignItems = "center";
  content.style.gap = "12px";

  const spinner = document.createElement("div");
  spinner.style.width = "48px";
  spinner.style.height = "48px";
  spinner.style.borderRadius = "50%";
  spinner.style.border = "4px solid rgba(255, 255, 255, 0.35)";
  spinner.style.borderTopColor = "#fff";
  spinner.style.animation = "dd-spin 1s linear infinite";

  const text = document.createElement("div");
  text.style.fontSize = "16px";
  text.style.letterSpacing = "0.02em";
  text.textContent = "Loading assets…";

  content.appendChild(spinner);
  content.appendChild(text);
  overlay.appendChild(content);

  const styleTag = document.createElement("style");
  styleTag.textContent = `
    @keyframes dd-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleTag);

  document.body.appendChild(overlay);

  const hide = () => {
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    window.setTimeout(() => {
      overlay.remove();
      styleTag.remove();
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
