import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { createDartboard } from "./board.js";
import { createDart } from "./dart.js";
import { createFireworksSystem } from "./fireworks.js";
import { createConfettiSystem } from "./confetti.js";
import { createActionManager } from "./animation.js";

import { scoreFromBoardXY, formatHitForHud } from "./scoring.js";
import { createRoundHud } from "./hud.js";

// ✅ NEW (requested)
import { createHitGlow } from "./hitGlow.js";

// ✅ NEW helper module (refactor)
import {
  computeStartCameraPose,
  createStartOverlay,
  createAimDisc,
} from "./script_helpers.js";

// -----------------------------
// SETUP
// -----------------------------
const GLB_URL = "assets/bar_diorama.glb";
const WALL_ANCHOR_NAME = "Object_7";

// This offset is used by the throw animation to place the dart slightly in front
// of the board face along the board's forward normal.
const DART_TARGET_OFFSET = 0.28;

// Aim disc sits a little further out than the dart stick point so it doesn't z-fight.
const AIM_DISC_Z = DART_TARGET_OFFSET + 0.06;

// Round settings
const MAX_DARTS_PER_ROUND = 10;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.05,
  1000
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Slightly brighter overall look (helps with darker GLB/PBR scenes)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.getElementById("app").appendChild(renderer.domElement);

// IMPORTANT: prevents mobile browsers from treating holds/drags as page scroll/zoom
renderer.domElement.style.touchAction = "none";

scene.add(new THREE.AmbientLight(0xffffff, 2.2));

const controls = new OrbitControls(camera, renderer.domElement);

// --- MODULES ---
const fireworks = createFireworksSystem(scene);
const confetti = createConfettiSystem(scene);
const actionManager = createActionManager(
  scene,
  camera,
  controls,
  fireworks,
  confetti
);

// -----------------------------
// START SCREEN UI (DOM overlay)
// Shows a Start button once the chalkboard logo appears.
// -----------------------------
let gameStarted = false;

const startUI = createStartOverlay();
startUI.hide();

// cache of the "start pose" after the board is synced
let startPose = null;

// -----------------------------
// HUD + ROUND STATE (10 darts)
// -----------------------------
const roundHud = createRoundHud({
  maxDarts: MAX_DARTS_PER_ROUND,
  injectStyles: false, // styles live in splash.css
});

roundHud.setVisible(false);
roundHud.setState({ dartsThrown: 0, totalScore: 0, lastText: "—" });

let roundActive = false;
let dartsThrown = 0;
let totalScore = 0;
let throwHistory = []; // array of { label, points, ring, mult, wedge }

function resetRound() {
  dartsThrown = 0;
  totalScore = 0;
  throwHistory = [];
  roundActive = true;

  roundHud.setVisible(true);
  roundHud.setState({
    dartsThrown,
    totalScore,
    lastText: "—",
  });
}

function endRound() {
  roundActive = false;

  // Ensure aim disc is not enabled after round ends
  if (aimDisc) {
    aimDisc.setEnabled(false);
    aimDisc.cancelHold();
  }

  roundHud.showToast("Round complete!");
  roundHud.showRoundEnd({
    totalScore,
    throws: throwHistory.map((t) => ({ label: t.label, points: t.points })),
  });
}

roundHud.setOnPlayAgain(() => {
  resetRound();
});

// -----------------------------
// DARTBOARD + AIM DISC
// -----------------------------
const dartboard = createDartboard({ includeWall: true });
dartboard.visible = false; // Keep hidden until synced
scene.add(dartboard);

let aimDisc = null;

// ✅ NEW (requested): hitGlow created once after board exists
let hitGlow = null;

// Hold the most recent scored throw glow data until the dart actually lands.
let pendingHitGlow = null;

// Apply hitGlow only AFTER the dart is snapped into its final landed pose.
if (typeof actionManager.setOnDartLanded === "function") {
  actionManager.setOnDartLanded(() => {
    if (!pendingHitGlow) return;
    if (!hitGlow) return;

    try {
      hitGlow.setFromScore(pendingHitGlow);
    } catch (err) {
      console.warn("hitGlow.setFromScore failed", err);
    } finally {
      pendingHitGlow = null;
    }
  });
}

// Aiming input state
let isHoldingAim = false;
let holdPointerId = null;

// Raycast helpers (optional; currently not required because we allow hold anywhere)
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function getBoardFaceHitFromPointerEvent(ev) {
  if (!dartboard || !dartboard.userData || !dartboard.userData.faceMesh) return null;

  const rect = renderer.domElement.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / rect.width;
  const y = (ev.clientY - rect.top) / rect.height;

  ndc.x = x * 2 - 1;
  ndc.y = -(y * 2 - 1);

  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObject(dartboard.userData.faceMesh, true);
  return hits && hits.length > 0 ? hits[0] : null;
}

// -----------------------------
// GAMEPLAY: throw at a specific board-local XY
// -----------------------------
function throwDartAtBoardLocalXY(x, y) {
  const localTarget = new THREE.Vector3(x, y, DART_TARGET_OFFSET);
  const worldTarget = localTarget.clone();
  dartboard.localToWorld(worldTarget);

  const dart = createDart();
  actionManager.throw(dart, dartboard, DART_TARGET_OFFSET, worldTarget);
}

// -----------------------------
// SCORING: compute points + update HUD
// -----------------------------
function scoreHitAtBoardLocalXY(hitX, hitY) {
  if (!dartboard || !dartboard.userData) {
    return { points: 0, label: "MISS" };
  }

  const boardRadius = dartboard.userData.boardRadius;
  const baseScoring = dartboard.userData.scoring;

  if (!baseScoring) {
    return { points: 0, label: "MISS" };
  }

  const scoringConfig = {
    ...baseScoring,
    boardRadius: boardRadius,
  };

  return scoreFromBoardXY(hitX, hitY, scoringConfig);
}

function registerThrowScore(scoreResult) {
  const pts = typeof scoreResult?.points === "number" ? scoreResult.points : 0;
  const lbl = typeof scoreResult?.label === "string" ? scoreResult.label : "MISS";

  dartsThrown += 1;
  totalScore += pts;

  throwHistory.push({
    label: lbl,
    points: pts,
    ring: scoreResult?.ring,
    mult: scoreResult?.mult,
    wedge: scoreResult?.wedge,
  });

  const lastText = formatHitForHud(scoreResult);

  roundHud.setState({
    dartsThrown,
    totalScore,
    lastText,
  });

  // Queue the glow payload, but DO NOT render it yet.
  // The glow is applied only after the dart visually lands (actionManager onDartLanded).
  if (dartboard && dartboard.userData) {
    const nums = dartboard?.userData?.scoring?.numbers;
    const wedgeVal =
      typeof scoreResult?.wedge === "number" ? scoreResult.wedge : null;

    let wedgeIndex = null;
    if (wedgeVal !== null && Array.isArray(nums)) {
      const idx = nums.indexOf(wedgeVal);
      wedgeIndex = idx >= 0 ? idx : null;
    }

    const br = dartboard?.userData?.boardRadius;
    let rNorm = undefined;
    if (
      typeof scoreResult?.radius === "number" &&
      typeof br === "number" &&
      br > 0
    ) {
      rNorm = scoreResult.radius / br;
    }

    pendingHitGlow = {
      ...scoreResult,
      wedgeIndex,
      rNorm,
    };
  }

  roundHud.flashScore();

  roundHud.showToast(lastText);

  // If the final dart was just thrown, end the round immediately.
  if (dartsThrown >= MAX_DARTS_PER_ROUND) {
    endRound();
  }
}

// -----------------------------
// INPUT: Stardew-style aim hold/shrink/release
// -----------------------------
function onAimPointerDown(ev) {
  if (!gameStarted) return;
  if (!roundActive) return;
  if (!aimDisc) return;
  if (actionManager.isBusy && actionManager.isBusy()) return;
  if (isHoldingAim) return;

  // ✅ NEW (requested): Clear glow at start of next toss
  if (hitGlow) {
    try {
      hitGlow.clear(); // <-- clears only when the NEXT toss begins
    } catch (err) {
      console.warn("hitGlow.clear failed", err);
    }
  }

  // Also clear any queued glow from a prior throw.
  pendingHitGlow = null;

  // Allow hold ANYWHERE (not just on the board).
  ev.preventDefault?.();

  isHoldingAim = true;
  holdPointerId = ev.pointerId;

  try {
    renderer.domElement.setPointerCapture(ev.pointerId);
  } catch (e) {
    // Ignore if not supported
  }

  aimDisc.beginHold();
}

function onAimPointerUp(ev) {
  if (!gameStarted) return;
  if (!roundActive) return;
  if (!aimDisc) return;
  if (!isHoldingAim) return;
  if (ev.pointerId !== holdPointerId) return;

  isHoldingAim = false;
  holdPointerId = null;

  try {
    renderer.domElement.releasePointerCapture(ev.pointerId);
  } catch (e) {
    // Ignore
  }

  // If a dart is currently in progress (shouldn't happen), just cancel.
  if (actionManager.isBusy && actionManager.isBusy()) {
    aimDisc.cancelHold();
    return;
  }

  // Sample hit point from the remaining disc size and throw.
  const shot = aimDisc.releaseAndSampleHit();

  // Hide disc until the throw resolves
  aimDisc.setEnabled(false);

  // Score immediately (the dart is being thrown exactly to that sampled location)
  const scoreResult = scoreHitAtBoardLocalXY(shot.hitX, shot.hitY);
  registerThrowScore(scoreResult);

  // Throw the dart visually.
  throwDartAtBoardLocalXY(shot.hitX, shot.hitY);
}

function onAimPointerCancel(ev) {
  if (!isHoldingAim) return;
  if (ev.pointerId !== holdPointerId) return;

  isHoldingAim = false;
  holdPointerId = null;

  if (aimDisc) aimDisc.cancelHold();

  try {
    renderer.domElement.releasePointerCapture(ev.pointerId);
  } catch (e) {
    // Ignore
  }
}

// Attach input listeners once
renderer.domElement.addEventListener("pointerdown", onAimPointerDown);
renderer.domElement.addEventListener("pointerup", onAimPointerUp);
renderer.domElement.addEventListener("pointercancel", onAimPointerCancel);
renderer.domElement.addEventListener("pointerleave", onAimPointerCancel);

// -----------------------------
// START BUTTON: transition to gameplay
// -----------------------------
startUI.button.addEventListener("click", () => {
  if (gameStarted) return;

  gameStarted = true;
  startUI.hide();

  // Tell the action manager to transition from the intro to gameplay.
  actionManager.startGame();

  // Snap camera to a good gameplay view immediately on Start.
  if (startPose) {
    camera.position.copy(startPose.position);
    camera.lookAt(startPose.target);
    controls.target.copy(startPose.target);
    controls.update();
  }

  // Keep OrbitControls disabled during gameplay.
  controls.enabled = false;

  // Start a fresh 10-dart round
  resetRound();

  // Enable aim disc if available
  if (aimDisc) {
    aimDisc.setEnabled(true);
  }
});

// -----------------------------
// SCENE SYNC & AUTO-PLAY (intro throw)
// -----------------------------
function syncBoardToWall(anchor) {
  anchor.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(anchor);
  const center = new THREE.Vector3();
  box.getCenter(center);
  dartboard.position.copy(center);

  const q = new THREE.Quaternion();
  anchor.getWorldQuaternion(q);
  dartboard.quaternion.copy(q);
  dartboard.rotateX(Math.PI / 2);
  dartboard.rotateY(Math.PI / 2);

  const forwardVec = new THREE.Vector3(0, 0, 1).applyQuaternion(dartboard.quaternion);
  dartboard.position.add(forwardVec.clone().multiplyScalar(-0.50));

  dartboard.visible = true;
  anchor.visible = false;

  // ✅ NEW (requested): Create once after your board exists
  if (!hitGlow) {
    hitGlow = createHitGlow(dartboard, { opacity: 0.42, color: 0xffd34d });
  }

  // Compute a start camera pose relative to the placed dartboard
  startPose = computeStartCameraPose(dartboard, camera, {
    distance: 6.3,
    height: 1.0,
    right: 0.0,
  });

  camera.position.copy(startPose.position);
  camera.lookAt(startPose.target);
  controls.target.copy(startPose.target);
  controls.update();

  // Tell the action manager what "start camera" means for this placed board
  if (typeof actionManager.setStartCameraPose === "function") {
    actionManager.setStartCameraPose(startPose.position, 75, dartboard);
  }

  controls.enabled = false;

  // Create the aim disc now that the board exists in the final pose.
  if (!aimDisc) {
    aimDisc = createAimDisc(dartboard, {
      z: AIM_DISC_Z,
      maxRadius: 0.75,
      minRadius: 0.06,
      shrinkTime: 1.25,
    });
  }

  // --- TRIGGER AUTO-PLAY (intro throw) ---
  // Wait 500ms after sync so the user sees the board before the dart flies.
  // This intro throw does NOT affect scoring because scoring only starts after Start is clicked.
  setTimeout(() => {
    const dart = createDart();
    actionManager.throw(dart, dartboard, DART_TARGET_OFFSET);
  }, 500);
}

new GLTFLoader().load(GLB_URL, (gltf) => {
  scene.add(gltf.scene);
  const anchor = gltf.scene.getObjectByName(WALL_ANCHOR_NAME);
  if (anchor) {
    syncBoardToWall(anchor);
  }
});

// -----------------------------
// RENDER LOOP
// -----------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  fireworks.update(delta);
  confetti.update(delta);
  actionManager.update(delta, dartboard);

  // Show the Start button once the chalkboard logo is on screen
  if (!gameStarted && actionManager.isLogoVisible && actionManager.isLogoVisible()) {
    startUI.show();
  }

  // Gameplay: keep aim disc active when the game has started, round is active,
  // and no throw is in progress.
  if (aimDisc) {
    const busy = actionManager.isBusy && actionManager.isBusy();
    const shouldEnable = gameStarted && roundActive && !busy;

    // Only enable if not holding (avoid flicker on the frame we release)
    if (!isHoldingAim) {
      aimDisc.setEnabled(shouldEnable);
    }

    aimDisc.update(delta);
  }

  // OrbitControls stays disabled in gameplay; only update if enabled
  if (controls.enabled) controls.update();

  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
