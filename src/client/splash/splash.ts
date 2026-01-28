import { navigateTo, context } from "@devvit/web/client";

declare global {
  interface Window {
    __DD_MODE__?: "inline";
    __DD_GAMEPLAY_ENABLED__?: boolean;

    // script.js can set this once it finishes creating the actionManager
    __DD_START_GAME__?: () => void;
  }
}

const docsLink = document.getElementById("docs-link") as HTMLDivElement | null;
const playtestLink = document.getElementById("playtest-link") as HTMLDivElement | null;
const discordLink = document.getElementById("discord-link") as HTMLDivElement | null;
const startButton = document.getElementById("start-button") as HTMLButtonElement | null;
const titleElement = document.getElementById("title") as HTMLHeadingElement | null;

if (docsLink) docsLink.addEventListener("click", () => navigateTo("https://developers.reddit.com/docs"));
if (playtestLink) playtestLink.addEventListener("click", () => navigateTo("https://www.reddit.com/r/Devvit"));
if (discordLink) discordLink.addEventListener("click", () => navigateTo("https://discord.com/invite/R7yu2wh9Qz"));

function ensureAppMount(): HTMLDivElement {
  let el = document.getElementById("app") as HTMLDivElement | null;
  if (el) return el;

  el = document.createElement("div");
  el.id = "app";
  el.style.position = "fixed";
  el.style.left = "0";
  el.style.top = "0";
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.zIndex = "0";
  document.body.appendChild(el);
  return el;
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
  box.textContent = "❌ Inline game load error:\n\n" + msg;
  document.body.appendChild(box);
}

async function init() {
  if (titleElement) {
    titleElement.textContent = `Hey ${context.username ?? "user"} 👋`;
  }

  // Inline mode: gameplay is enabled in this same webview
  window.__DD_MODE__ = "inline";
  window.__DD_GAMEPLAY_ENABLED__ = true;

  // Make sure Three.js has a mount
  ensureAppMount();

  // Optional: if you keep a HTML start button, it should start the Three.js game,
  // NOT requestExpandedMode.
  if (startButton) {
    startButton.disabled = true;
    startButton.textContent = "Loading…";
    startButton.addEventListener("click", () => {
      if (typeof window.__DD_START_GAME__ === "function") {
        window.__DD_START_GAME__();
      }
    });
  }

  try {
    // If you moved your game code next to splash.ts in a ./src folder:
    await import("./src/script.js");

    // If you want the game to auto-start inline (no HTML Start button),
    // have script.js start immediately, or call __DD_START_GAME__ here if set.
    if (typeof window.__DD_START_GAME__ === "function") {
      window.__DD_START_GAME__();
    }

    if (startButton) {
      startButton.disabled = false;
      startButton.textContent = "Start";
    }
  } catch (err) {
    showError(err);
    if (startButton) {
      startButton.disabled = false;
      startButton.textContent = "Start";
    }
  }
}

init();
