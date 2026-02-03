import { loadGame } from "./index";
import * as THREE from "three";

// --- UTILS ---
function ensureAppMount() {
  let app = document.getElementById("app");
  if (!app) {
    app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
  }
  return app;
}

function showError(err) {
  const msg = String(err instanceof Error ? err.stack || err.message : err);
  const box = document.createElement("pre");
  box.style.cssText = "position:fixed;inset:12px;overflow:auto;padding:20px;background:rgba(20,0,0,0.9);color:#ff6666;font-family:monospace;border-radius:8px;z-index:1000000;border:2px solid red;";
  box.textContent = "❌ ARCADE SYSTEM ERROR:\n\n" + msg;
  document.body.appendChild(box);
}

// --- FIXED CHALKBOARD LOADER ---
function createArcadeLoader(app) {
  const overlay = document.createElement("div");
  overlay.id = "arcade-loading-ui";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: url('chalkboard.jpg') center center / cover no-repeat;
    background-color: #1a1a1a; 
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    transition: opacity 0.8s ease;
    pointer-events: none;
    font-family: 'Permanent Marker', 'Comic Sans MS', cursive;
  `;

  overlay.innerHTML = `
    <div style="width: 85%; max-width: 360px; filter: drop-shadow(2px 2px 2px rgba(0,0,0,0.5));">
      <div style="font-size: 8vw; color: rgba(255,255,255,0.9); margin-bottom: 4vh; letter-spacing: 2px; text-transform: uppercase; text-align: left;">
        Loading...
      </div>
      <div id="tally-row" style="display: flex; flex-wrap: wrap; gap: 6vw; justify-content: flex-start; align-items: flex-start; min-height: 120px;">
        </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const tallyRow = overlay.querySelector("#tally-row");

  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes chalkSnap { 
      from { opacity: 0; transform: scale(1.4) rotate(10deg); } 
      to { opacity: 1; transform: scale(1) rotate(var(--r)); } 
    }
  `;
  document.head.appendChild(style);

  let currentGroupDiv = null;

  const createStroke = (type) => {
    const stroke = document.createElement("div");
    const baseRot = (Math.random() * 8 - 4).toFixed(2);
    
    // Default vertical style
    stroke.style.cssText = `
      width: 1.2vw; height: 10vw; max-width: 6px; max-height: 55px;
      background: rgba(240,240,240,0.95); border-radius: 2px;
      animation: chalkSnap 0.1s ease-out forwards;
      --r: ${baseRot}deg;
    `;

    // Overwrite for diagonal
    if (type === 'diagonal') {
      const diagRot = -70;
      stroke.style.cssText += `
        position: absolute; 
        left: 40%; 
        top: -20%; 
        width: 1.4vw; 
        height: 12vw; 
        max-width: 7px;
        max-height: 65px;
        background: #fff; 
        z-index: 10;
        --r: ${diagRot}deg;
      `;
    }
    return stroke;
  };

  return {
    addNextStroke: (strokeIndex) => {
      const positionInGroup = (strokeIndex - 1) % 5;

      if (positionInGroup === 0) {
        currentGroupDiv = document.createElement("div");
        // We use relative positioning so the diagonal 'absolute' child stays inside
        currentGroupDiv.style.cssText = "display: flex; gap: 1.5vw; position: relative; margin-bottom: 2vh; flex-shrink: 0;";
        tallyRow.appendChild(currentGroupDiv);
      }

      if (positionInGroup < 4) {
        currentGroupDiv.appendChild(createStroke('vertical'));
      } else {
        currentGroupDiv.appendChild(createStroke('diagonal'));
      }
    },
    hide: () => {
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 800);
    }
  };
}

// --- BOOTSTRAP ---
const app = ensureAppMount();
const arcadeLoader = createArcadeLoader(app);

async function bootstrapGame(target) {
  let strokesDrawn = 0;
  const maxStrokes = 20;
  const msPerStroke = 250; 
  let gameLoaded = false;

  const tallyInterval = setInterval(() => {
    if (strokesDrawn < maxStrokes) {
      strokesDrawn++;
      arcadeLoader.addNextStroke(strokesDrawn);
    } else {
      clearInterval(tallyInterval);
      if (gameLoaded) finishLoading();
    }
  }, msPerStroke);

  function finishLoading() {
    setTimeout(() => arcadeLoader.hide(), 600);
  }

  try {
    const mountGame = await loadGame();
    mountGame(target, {
      onLoadingDone: () => {
        gameLoaded = true;
        if (strokesDrawn >= maxStrokes) finishLoading();
      },
    });
  } catch (e) {
    showError(e);
  }
}

bootstrapGame(app);