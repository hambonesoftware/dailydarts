import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { createDartboard } from "./board.js";
import { createDart } from "./dart.js";
import { createFireworksSystem } from "./fireworks.js";
import { createConfettiSystem } from "./confetti.js";
import { createActionManager } from "./animation.js";

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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById("app").appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1.2));

const controls = new OrbitControls(camera, renderer.domElement);

// --- MODULES ---
const fireworks = createFireworksSystem(scene);
const confetti = createConfettiSystem(scene);
const actionManager = createActionManager(scene, camera, controls, fireworks, confetti);

// -----------------------------
// CAMERA POSE (placeholder)
// Computes a camera pose that faces the dartboard at an appropriate distance,
// based on the dartboard's world position + orientation.
// -----------------------------
function computeStartCameraPose(board, cameraRef, opts = {}) {
  const distance = typeof opts.distance === "number" ? opts.distance : 6.3;
  const height = typeof opts.height === "number" ? opts.height : 1.0;
  const rightOffset = typeof opts.right === "number" ? opts.right : 0.0;

  const target = new THREE.Vector3();
  board.getWorldPosition(target);

  const q = new THREE.Quaternion();
  board.getWorldQuaternion(q);

  // Dartboard "outward" normal in world space.
  // Our board is built so local +Z points out of the face.
  let normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();

  // Ensure we put the camera on the same side the current camera is already on.
  // This avoids accidentally placing the camera "behind" the wall.
  const camSide = new THREE.Vector3().copy(cameraRef.position).sub(target);
  if (camSide.dot(normal) < 0) normal.negate();

  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();

  const position = new THREE.Vector3()
    .copy(target)
    .addScaledVector(normal, distance)
    .addScaledVector(up, height)
    .addScaledVector(right, rightOffset);

  return { position, target };
}

// -----------------------------
// START SCREEN UI (DOM overlay)
// Shows a Start button once the chalkboard logo appears.
// -----------------------------
let gameStarted = false;

const startOverlay = document.createElement("div");
startOverlay.id = "dd-start-overlay";
startOverlay.style.position = "fixed";
startOverlay.style.left = "0";
startOverlay.style.top = "0";
startOverlay.style.width = "100%";
startOverlay.style.height = "100%";
startOverlay.style.display = "none";
startOverlay.style.alignItems = "flex-end";
startOverlay.style.justifyContent = "center";
startOverlay.style.pointerEvents = "none";
startOverlay.style.zIndex = "9999";

const startPanel = document.createElement("div");
startPanel.style.pointerEvents = "auto";
startPanel.style.marginBottom = "38px";
startPanel.style.padding = "14px 18px";
startPanel.style.borderRadius = "14px";
startPanel.style.background = "rgba(0,0,0,0.55)";
startPanel.style.border = "1px solid rgba(255,255,255,0.18)";
startPanel.style.backdropFilter = "blur(6px)";
startPanel.style.display = "flex";
startPanel.style.gap = "12px";
startPanel.style.alignItems = "center";

const startHint = document.createElement("div");
startHint.textContent = "Ready?";
startHint.style.color = "rgba(255,255,255,0.92)";
startHint.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
startHint.style.fontSize = "16px";
startHint.style.fontWeight = "600";
startHint.style.letterSpacing = "0.2px";

const startBtn = document.createElement("button");
startBtn.type = "button";
startBtn.textContent = "Start";
startBtn.style.cursor = "pointer";
startBtn.style.padding = "12px 18px";
startBtn.style.borderRadius = "12px";
startBtn.style.border = "1px solid rgba(255,255,255,0.22)";
startBtn.style.background = "rgba(255,255,255,0.10)";
startBtn.style.color = "rgba(255,255,255,0.95)";
startBtn.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
startBtn.style.fontSize = "16px";
startBtn.style.fontWeight = "700";
startBtn.style.letterSpacing = "0.3px";
startBtn.style.transition = "transform 120ms ease, background 120ms ease";

startBtn.addEventListener("mouseenter", () => {
  startBtn.style.transform = "translateY(-1px) scale(1.02)";
  startBtn.style.background = "rgba(255,255,255,0.16)";
});
startBtn.addEventListener("mouseleave", () => {
  startBtn.style.transform = "translateY(0) scale(1.0)";
  startBtn.style.background = "rgba(255,255,255,0.10)";
});

startPanel.appendChild(startHint);
startPanel.appendChild(startBtn);
startOverlay.appendChild(startPanel);
document.body.appendChild(startOverlay);

function showStartOverlay() {
  startOverlay.style.display = "flex";
}

function hideStartOverlay() {
  startOverlay.style.display = "none";
}

// -----------------------------
// DARTBOARD + AIM DISC
// -----------------------------
const dartboard = createDartboard({ includeWall: true });
dartboard.visible = false; // Keep hidden until synced
scene.add(dartboard);

let aimDisc = null;

// Aiming input state
let isHoldingAim = false;
let holdPointerId = null;

// Raycast helpers (click/touch must start on the board face)
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

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

function createAimDisc(board, opts = {}) {
  const boardRadius = typeof board.userData.boardRadius === "number" ? board.userData.boardRadius : 2.05;

  const maxRadius = typeof opts.maxRadius === "number" ? opts.maxRadius : 0.75;
  const minRadius = typeof opts.minRadius === "number" ? opts.minRadius : 0.06;
  const shrinkTime = typeof opts.shrinkTime === "number" ? opts.shrinkTime : 1.25;

  const discZ = typeof opts.z === "number" ? opts.z : AIM_DISC_Z;

  const geom = new THREE.CircleGeometry(1, 80);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff2a2a,
    transparent: true,
    opacity: 0.20,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = "AimDisc";
  mesh.renderOrder = 20000;
  mesh.visible = false;

  board.add(mesh);

  const state = {
    enabled: false,
    time: 0,
    holding: false,
    holdTime: 0,
    centerX: 0,
    centerY: 0,
    radius: maxRadius,
  };

  function clampCenterForRadius(x, y, r) {
    const margin = 0.04;
    const limit = Math.max(0.001, boardRadius - r - margin);
    const len = Math.hypot(x, y);
    if (len > limit) {
      const s = limit / len;
      return { x: x * s, y: y * s };
    }
    return { x, y };
  }

  function setEnabled(enabled) {
    state.enabled = !!enabled;
    mesh.visible = state.enabled;

    if (!state.enabled) {
      state.holding = false;
      state.holdTime = 0;
      state.radius = maxRadius;
    }
  }

  function beginHold() {
    state.holding = true;
    state.holdTime = 0;
    state.radius = maxRadius;
    mesh.scale.set(state.radius, state.radius, 1);
  }

  function cancelHold() {
    state.holding = false;
    state.holdTime = 0;
    state.radius = maxRadius;
    mesh.scale.set(state.radius, state.radius, 1);
  }

  function releaseAndSampleHit() {
    // Freeze final radius
    const finalRadius = state.radius;

    // Sample a landing point uniformly inside the circle.
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * finalRadius;

    const hitX = state.centerX + Math.cos(angle) * r;
    const hitY = state.centerY + Math.sin(angle) * r;

    // Reset for next move cycle
    state.holding = false;
    state.holdTime = 0;
    state.radius = maxRadius;

    return {
      centerX: state.centerX,
      centerY: state.centerY,
      radius: finalRadius,
      hitX,
      hitY,
    };
  }

  function update(delta) {
    if (!state.enabled) return;

    state.time += delta;

    // If not holding, move the center using a simple "LFO" style motion.
    if (!state.holding) {
      state.radius = maxRadius;

      // LFO motion (feels like the disc is "floating around" the board)
      const t = state.time;
      const w1 = 0.85;
      const w2 = 1.33;
      const w3 = 0.73;
      const w4 = 1.91;

      const base = boardRadius * 0.55;

      let x =
        base * (0.65 * Math.sin(t * w1) + 0.35 * Math.sin(t * w2 + 1.7));
      let y =
        base * (0.65 * Math.cos(t * w3) + 0.35 * Math.sin(t * w4 + 0.9));

      const clamped = clampCenterForRadius(x, y, maxRadius);
      state.centerX = clamped.x;
      state.centerY = clamped.y;
    } else {
      // While holding, shrink radius over time.
      state.holdTime += delta;
      const p = clamp01(state.holdTime / shrinkTime);
      state.radius = maxRadius + (minRadius - maxRadius) * p;
    }

    // Optional: tiny "breathing" float in/out
    const bob = Math.sin(state.time * 1.8) * 0.01;

    mesh.position.set(state.centerX, state.centerY, discZ + bob);
    mesh.scale.set(state.radius, state.radius, 1);
  }

  return {
    mesh,
    setEnabled,
    beginHold,
    cancelHold,
    releaseAndSampleHit,
    update,
  };
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
// INPUT: Stardew-style aim hold/shrink/release
// -----------------------------
function onAimPointerDown(ev) {
  if (!gameStarted) return;
  if (!aimDisc) return;
  if (actionManager.isBusy && actionManager.isBusy()) return;
  if (isHoldingAim) return;

  // Must start on the board face
  const hit = getBoardFaceHitFromPointerEvent(ev);
  if (!hit) return;

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
startBtn.addEventListener("click", () => {
  if (gameStarted) return;

  gameStarted = true;
  hideStartOverlay();

  // Tell the action manager to transition from the intro to gameplay.
  actionManager.startGame();

  // Snap camera to a good gameplay view immediately on Start.
  // (Camera will still use the same "intro throw" style during throws.)
  const startPose = computeStartCameraPose(dartboard, camera, { distance: 6.3, height: 1.0, right: 0.0 });
  camera.position.copy(startPose.position);
  camera.lookAt(startPose.target);
  controls.target.copy(startPose.target);
  controls.update();

  // Keep OrbitControls disabled during gameplay.
  controls.enabled = false;

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

  // Compute a start camera pose relative to the placed dartboard
  // (placeholder: tweak distance/height/right until it feels perfect).
  const startPose = computeStartCameraPose(dartboard, camera, { distance: 6.3, height: 1.0, right: 0.0 });

  camera.position.copy(startPose.position);
  camera.lookAt(startPose.target);
  controls.target.copy(startPose.target);
  controls.update();

  // Tell the action manager what "start camera" means for this placed board
  // so its reset behavior returns to the correct spot AND it can derive an action pose.
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
  // Wait 500ms after sync so the user sees the board before the dart flies
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
    showStartOverlay();
  }

  // Gameplay: keep aim disc active when the game has started and no throw is in progress.
  if (aimDisc) {
    const busy = actionManager.isBusy && actionManager.isBusy();
    const shouldEnable = gameStarted && !busy;

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
