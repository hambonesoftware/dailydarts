import * as THREE from "three";

// -----------------------------
// CAMERA POSE (placeholder)
// Computes a camera pose that faces the dartboard at an appropriate distance,
// based on the dartboard's world position + orientation.
// -----------------------------
export function computeStartCameraPose(board, cameraRef, opts = {}) {
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
// START OVERLAY UI
// -----------------------------
export function createStartOverlay() {
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
  startHint.style.fontFamily =
    "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
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
  startBtn.style.fontFamily =
    "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
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

  function show() {
    startOverlay.style.display = "flex";
  }

  function hide() {
    startOverlay.style.display = "none";
  }

  return {
    overlay: startOverlay,
    panel: startPanel,
    button: startBtn,
    show,
    hide,
  };
}

// -----------------------------
// AIM DISC (Stardew-style hold/shrink)
// -----------------------------
function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

export function createAimDisc(board, opts = {}) {
  const boardRadius =
    typeof board.userData.boardRadius === "number"
      ? board.userData.boardRadius
      : 2.05;

  const maxRadius = typeof opts.maxRadius === "number" ? opts.maxRadius : 0.75;
  const minRadius = typeof opts.minRadius === "number" ? opts.minRadius : 0.06;
  const shrinkTime = typeof opts.shrinkTime === "number" ? opts.shrinkTime : 1.25;

  const discZ = typeof opts.z === "number" ? opts.z : 0.34;

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
    // Smaller margin allows the center to get closer to the rim,
    // which makes double ring reachable during gameplay.
    const margin = 0.02;

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
    const finalRadius = state.radius;

    // Sample a landing point uniformly inside the circle.
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * finalRadius;

    const hitX = state.centerX + Math.cos(angle) * r;
    const hitY = state.centerY + Math.sin(angle) * r;

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

    if (!state.holding) {
      state.radius = maxRadius;

      const t = state.time;
      const w1 = 0.85;
      const w2 = 1.33;
      const w3 = 0.73;
      const w4 = 1.91;

      // Increased base => disc center travels closer to rim (reach doubles)
      const base = boardRadius * 0.82;

      let x = base * (0.65 * Math.sin(t * w1) + 0.35 * Math.sin(t * w2 + 1.7));
      let y = base * (0.65 * Math.cos(t * w3) + 0.35 * Math.sin(t * w4 + 0.9));

      const clamped = clampCenterForRadius(x, y, maxRadius);
      state.centerX = clamped.x;
      state.centerY = clamped.y;
    } else {
      state.holdTime += delta;
      const p = clamp01(state.holdTime / shrinkTime);
      state.radius = maxRadius + (minRadius - maxRadius) * p;
    }

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
