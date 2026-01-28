/**
 * hud.js
 *
 * Stylish, non-blocking HUD for the Daily Darts 10-dart scoring mode.
 *
 * - No Three.js dependency
 * - Creates DOM elements + provides small API:
 *
 *   const hud = createRoundHud({ maxDarts: 10 });
 *   hud.setVisible(true);
 *   hud.setState({ dartsThrown: 0, totalScore: 0, lastText: "—" });
 *   hud.flashScore(); // optional
 *   hud.showToast("T20 +60"); // optional
 *   hud.destroy();
 *
 * Notes:
 * - HUD is pointer-events: none by default so it never blocks aiming.
 * - The round-end overlay is clickable, so that part uses pointer-events: auto.
 */

function safeInt(n, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.trunc(x);
}

function safeNum(n, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return x;
}

function safeStr(s, fallback = "") {
  if (typeof s === "string") return s;
  return fallback;
}

function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Inject minimal CSS for HUD + toast + round-end overlay.
 * If you already put these in splash.css you can skip calling this,
 * but it’s safe (it checks for an existing style tag).
 */
function ensureHudStyles() {
  const STYLE_ID = "dd-hud-style";
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
/* -----------------------------------------
   Daily Darts HUD (non-blocking overlay)
----------------------------------------- */
#dd-hud {
  position: fixed;
  left: 12px;
  top: 12px;
  z-index: 9998;
  pointer-events: none;
}

#dd-hud .dd-hud-card {
  display: flex;
  flex-direction: column;
  gap: 8px;

  padding: 10px 12px;
  border-radius: 14px;

  background: rgba(10, 10, 10, 0.38);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);

  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

#dd-hud .dd-hud-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
}

#dd-hud .dd-hud-score {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-weight: 800;
  font-size: 20px;
  letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1;
  transform: translateZ(0);
}

#dd-hud .dd-hud-meta {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-weight: 650;
  font-size: 12px;
  letter-spacing: 0.3px;
  color: rgba(255, 255, 255, 0.80);
  line-height: 1.1;
  white-space: nowrap;
}

#dd-hud .dd-hud-dots {
  display: flex;
  align-items: center;
  gap: 6px;
}

#dd-hud .dd-hud-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;

  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

#dd-hud .dd-hud-dot.is-used {
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.25);
}

#dd-hud .dd-hud-last {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.2;
}

/* score flash */
#dd-hud .dd-hud-score.is-flash {
  animation: ddHudScoreFlash 260ms ease-out;
}
@keyframes ddHudScoreFlash {
  0%   { transform: scale(1);   }
  45%  { transform: scale(1.10);}
  100% { transform: scale(1);   }
}

#dd-hud.is-hidden {
  display: none;
}

/* -----------------------------------------
   Toast (momentary hit feedback)
----------------------------------------- */
#dd-toast {
  position: fixed;
  left: 50%;
  top: 14px;
  transform: translateX(-50%);
  z-index: 9997;
  pointer-events: none;
}

#dd-toast .dd-toast-chip {
  padding: 10px 14px;
  border-radius: 999px;

  background: rgba(10, 10, 10, 0.46);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.38);

  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-weight: 750;
  font-size: 14px;
  letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.95);

  opacity: 0;
  transform: translateY(-8px);
}

#dd-toast .dd-toast-chip.is-show {
  animation: ddToastInOut 900ms ease-in-out forwards;
}

@keyframes ddToastInOut {
  0%   { opacity: 0; transform: translateY(-10px); }
  18%  { opacity: 1; transform: translateY(0px); }
  75%  { opacity: 1; transform: translateY(0px); }
  100% { opacity: 0; transform: translateY(-10px); }
}

/* -----------------------------------------
   Round End Overlay (clickable)
----------------------------------------- */
#dd-roundend {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: none;
  pointer-events: auto;
}

#dd-roundend.is-show {
  display: grid;
  place-items: center;
}

#dd-roundend .dd-roundend-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.55);
}

#dd-roundend .dd-roundend-card {
  position: relative;
  width: min(520px, calc(100vw - 28px));
  border-radius: 18px;
  padding: 16px 16px 14px 16px;

  background: rgba(12, 12, 12, 0.82);
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow: 0 18px 60px rgba(0,0,0,0.55);

  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

#dd-roundend .dd-roundend-title {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-weight: 850;
  font-size: 16px;
  letter-spacing: 0.3px;
  color: rgba(255,255,255,0.92);
  margin-bottom: 10px;
}

#dd-roundend .dd-roundend-score {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-weight: 900;
  font-size: 34px;
  letter-spacing: 0.2px;
  color: rgba(255,255,255,0.98);
  margin-bottom: 12px;
}

#dd-roundend .dd-roundend-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 10px;
  margin-bottom: 12px;
}

#dd-roundend .dd-roundend-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;

  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);

  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-weight: 650;
  font-size: 12px;
  letter-spacing: 0.2px;
  color: rgba(255,255,255,0.85);
}

#dd-roundend .dd-roundend-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

#dd-roundend .dd-roundend-btn {
  appearance: none;
  border: 0;
  cursor: pointer;

  padding: 10px 14px;
  border-radius: 14px;

  background: rgba(255,255,255,0.14);
  border: 1px solid rgba(255,255,255,0.16);

  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.2px;

  color: rgba(255,255,255,0.95);
}

#dd-roundend .dd-roundend-btn:active {
  transform: translateY(1px);
}

@media (max-width: 420px) {
  #dd-hud { left: 10px; top: 10px; }
  #dd-hud .dd-hud-card { padding: 9px 11px; border-radius: 12px; }
  #dd-hud .dd-hud-score { font-size: 18px; }
  #dd-roundend .dd-roundend-grid { grid-template-columns: 1fr; }
}
`;
  document.head.appendChild(style);
}

/**
 * Create the round HUD + optional toast + round end overlay.
 */
export function createRoundHud(options = {}) {
  const maxDarts = clamp(safeInt(options.maxDarts, 10), 1, 60);
  const injectStyles = options.injectStyles !== undefined ? !!options.injectStyles : true;

  if (injectStyles) {
    ensureHudStyles();
  }

  // -------------------------
  // HUD container + content
  // -------------------------
  const hud = document.createElement("div");
  hud.id = "dd-hud";
  hud.className = "is-hidden";

  const card = document.createElement("div");
  card.className = "dd-hud-card";

  const rowTop = document.createElement("div");
  rowTop.className = "dd-hud-row";

  const scoreEl = document.createElement("div");
  scoreEl.className = "dd-hud-score";
  scoreEl.textContent = "Score: 0";

  const dartsEl = document.createElement("div");
  dartsEl.className = "dd-hud-meta";
  dartsEl.textContent = `Darts: 0/${maxDarts}`;

  rowTop.appendChild(scoreEl);
  rowTop.appendChild(dartsEl);

  const dotsRow = document.createElement("div");
  dotsRow.className = "dd-hud-dots";

  const dotEls = [];
  for (let i = 0; i < maxDarts; i++) {
    const dot = document.createElement("div");
    dot.className = "dd-hud-dot";
    dotsRow.appendChild(dot);
    dotEls.push(dot);
  }

  const lastEl = document.createElement("div");
  lastEl.className = "dd-hud-last";
  lastEl.textContent = "Last: —";

  card.appendChild(rowTop);
  card.appendChild(dotsRow);
  card.appendChild(lastEl);
  hud.appendChild(card);

  document.body.appendChild(hud);

  // -------------------------
  // Toast (optional)
  // -------------------------
  const toast = document.createElement("div");
  toast.id = "dd-toast";

  const toastChip = document.createElement("div");
  toastChip.className = "dd-toast-chip";
  toastChip.textContent = "";

  toast.appendChild(toastChip);
  document.body.appendChild(toast);

  let toastTimer = null;

  function showToast(text) {
    const t = safeStr(text, "");
    if (!t) return;

    toastChip.textContent = t;

    // retrigger animation
    toastChip.classList.remove("is-show");
    // eslint-disable-next-line no-unused-expressions
    toastChip.offsetHeight; // force reflow
    toastChip.classList.add("is-show");

    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    // remove animation class after duration so it can re-trigger cleanly
    toastTimer = setTimeout(() => {
      toastChip.classList.remove("is-show");
      toastTimer = null;
    }, 950);
  }

  // -------------------------
  // Round End Overlay (clickable)
  // -------------------------
  const roundEnd = document.createElement("div");
  roundEnd.id = "dd-roundend";

  const roundEndBackdrop = document.createElement("div");
  roundEndBackdrop.className = "dd-roundend-backdrop";

  const roundEndCard = document.createElement("div");
  roundEndCard.className = "dd-roundend-card";

  const roundEndTitle = document.createElement("div");
  roundEndTitle.className = "dd-roundend-title";
  roundEndTitle.textContent = "Round Complete";

  const roundEndScore = document.createElement("div");
  roundEndScore.className = "dd-roundend-score";
  roundEndScore.textContent = "Score: 0";

  const roundEndGrid = document.createElement("div");
  roundEndGrid.className = "dd-roundend-grid";

  const roundEndFooter = document.createElement("div");
  roundEndFooter.className = "dd-roundend-footer";

  const btnAgain = document.createElement("button");
  btnAgain.className = "dd-roundend-btn";
  btnAgain.type = "button";
  btnAgain.textContent = "Play Again";

  const btnClose = document.createElement("button");
  btnClose.className = "dd-roundend-btn";
  btnClose.type = "button";
  btnClose.textContent = "Close";

  roundEndFooter.appendChild(btnClose);
  roundEndFooter.appendChild(btnAgain);

  roundEndCard.appendChild(roundEndTitle);
  roundEndCard.appendChild(roundEndScore);
  roundEndCard.appendChild(roundEndGrid);
  roundEndCard.appendChild(roundEndFooter);

  roundEnd.appendChild(roundEndBackdrop);
  roundEnd.appendChild(roundEndCard);

  document.body.appendChild(roundEnd);

  let onPlayAgainCb = null;

  function setOnPlayAgain(cb) {
    onPlayAgainCb = typeof cb === "function" ? cb : null;
  }

  function hideRoundEnd() {
    roundEnd.classList.remove("is-show");
  }

  function showRoundEnd(summary = {}) {
    const totalScore = safeInt(summary.totalScore, 0);
    const throwsArr = Array.isArray(summary.throws) ? summary.throws : [];

    roundEndScore.textContent = `Score: ${totalScore}`;

    // Clear old rows
    while (roundEndGrid.firstChild) {
      roundEndGrid.removeChild(roundEndGrid.firstChild);
    }

    // Add items
    // Expect entries like { label:"T20", points:60 } OR strings
    for (let i = 0; i < throwsArr.length; i++) {
      const t = throwsArr[i];
      let label = "";
      let pts = 0;

      if (typeof t === "string") {
        label = t;
        pts = 0;
      } else if (t && typeof t === "object") {
        label = safeStr(t.label, "");
        pts = safeInt(t.points, 0);
      }

      const item = document.createElement("div");
      item.className = "dd-roundend-item";

      const left = document.createElement("div");
      left.textContent = `${i + 1}. ${label || "—"}`;

      const right = document.createElement("div");
      right.textContent = `+${pts}`;

      item.appendChild(left);
      item.appendChild(right);
      roundEndGrid.appendChild(item);
    }

    roundEnd.classList.add("is-show");
  }

  btnClose.addEventListener("click", () => {
    hideRoundEnd();
  });

  btnAgain.addEventListener("click", () => {
    hideRoundEnd();
    if (onPlayAgainCb) onPlayAgainCb();
  });

  // Also close if user clicks the dim backdrop
  roundEndBackdrop.addEventListener("click", () => {
    hideRoundEnd();
  });

  // -------------------------
  // HUD API
  // -------------------------
  function setVisible(isVisible) {
    if (isVisible) {
      hud.classList.remove("is-hidden");
    } else {
      hud.classList.add("is-hidden");
    }
  }

  function setState(state) {
    const dartsThrown = clamp(safeInt(state?.dartsThrown, 0), 0, maxDarts);
    const totalScore = safeInt(state?.totalScore, 0);
    const lastText = safeStr(state?.lastText, "—");

    scoreEl.textContent = `Score: ${totalScore}`;
    dartsEl.textContent = `Darts: ${dartsThrown}/${maxDarts}`;
    lastEl.textContent = `Last: ${lastText}`;

    for (let i = 0; i < dotEls.length; i++) {
      if (i < dartsThrown) {
        dotEls[i].classList.add("is-used");
      } else {
        dotEls[i].classList.remove("is-used");
      }
    }
  }

  function flashScore() {
    scoreEl.classList.remove("is-flash");
    // eslint-disable-next-line no-unused-expressions
    scoreEl.offsetHeight; // force reflow
    scoreEl.classList.add("is-flash");
  }

  function destroy() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    if (roundEnd && roundEnd.parentNode) roundEnd.parentNode.removeChild(roundEnd);

    // We intentionally do NOT remove injected styles because other reloads
    // in dev may share them; if you want to remove, do it here.
  }

  return {
    maxDarts,

    setVisible,
    setState,
    flashScore,

    showToast,

    showRoundEnd,
    hideRoundEnd,
    setOnPlayAgain,

    destroy,
  };
}
