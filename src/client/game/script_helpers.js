import * as THREE from "three";

// -----------------------------
// CAMERA POSE
// -----------------------------
export function computeStartCameraPose(board, cameraRef, opts = {}) {
  const distance = typeof opts.distance === "number" ? opts.distance : 6.3;
  const height = typeof opts.height === "number" ? opts.height : 1.0;
  const rightOffset = typeof opts.right === "number" ? opts.right : 0.0;

  const target = new THREE.Vector3();
  board.getWorldPosition(target);

  const q = new THREE.Quaternion();
  board.getWorldQuaternion(q);

  let normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();

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
  startOverlay.style.cssText =
    "position:fixed;left:0;top:0;width:100%;height:100%;display:none;align-items:flex-end;justify-content:center;pointer-events:none;z-index:9999;";

  const startPanel = document.createElement("div");
  startPanel.style.cssText =
    "pointer-events:auto;margin-bottom:38px;padding:14px 18px;border-radius:14px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.18);backdrop-filter:blur(6px);display:flex;gap:12px;align-items:center;";

  const startHint = document.createElement("div");
  startHint.textContent = "Ready?";
  startHint.style.cssText =
    "color:rgba(255,255,255,0.92);font-family:system-ui,sans-serif;font-size:16px;font-weight:600;letter-spacing:0.2px;";

  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.textContent = "Start";
  startBtn.style.cssText =
    "cursor:pointer;padding:12px 18px;border-radius:12px;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.10);color:rgba(255,255,255,0.95);font-family:system-ui,sans-serif;font-size:16px;font-weight:700;letter-spacing:0.3px;transition:transform 120ms ease, background 120ms ease;";

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

  return {
    overlay: startOverlay,
    panel: startPanel,
    button: startBtn,
    show: () => { startOverlay.style.display = "flex"; },
    hide: () => { startOverlay.style.display = "none"; },
  };
}

// -----------------------------
// NOISE GENERATOR
// -----------------------------
function makeSimplexNoise(seed) {
  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32((seed >>> 0) || 1);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  function dot(g, x, y) { return g[0] * x + g[1] * y; }

  return {
    noise2D(xin, yin) {
      const F2 = 0.5 * (Math.sqrt(3) - 1);
      const G2 = (3 - Math.sqrt(3)) / 6;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s);
      const j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t);
      const y0 = yin - (j - t);
      let i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      const g0 = grad2[perm[ii + perm[jj]] % 8];
      const g1 = grad2[perm[ii + i1 + perm[jj + j1]] % 8];
      const g2 = grad2[perm[ii + 1 + perm[jj + 1]] % 8];
      let n0 = Math.max(0, 0.5 - x0 * x0 - y0 * y0) ** 4 * dot(g0, x0, y0);
      let n1 = Math.max(0, 0.5 - x1 * x1 - y1 * y1) ** 4 * dot(g1, x1, y1);
      let n2 = Math.max(0, 0.5 - x2 * x2 - y2 * y2) ** 4 * dot(g2, x2, y2);
      return 70 * (n0 + n1 + n2);
    }
  };
}

// -----------------------------
// MATH HELPERS
// -----------------------------
function clamp01(t) { return Math.max(0, Math.min(1, t)); }
function smoothstep(t) { const x = clamp01(t); return x * x * (3 - 2 * x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rotate2D(x, y, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: x * c - y * s, y: x * s + y * c };
}
function seeded01(seed) {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return s - Math.floor(s);
}

// -----------------------------
// AIM WALKER (DECOUPLED INFINITY)
// -----------------------------
function makeAimWalker(opts) {
  const noise = makeSimplexNoise(opts.seed || 1337);
  const roam = typeof opts.roam === "number" ? opts.roam : 2.0;
  
  const rotationRate = typeof opts.rotationRate === "number" ? opts.rotationRate : 0.25;
  const worldSpeed = typeof opts.worldSpeed === "number" ? opts.worldSpeed : roam * 0.8;
  
  // How much the infinity "waist" drifts away from center (0 to 1)
  const driftAmp = typeof opts.driftAmp === "number" ? opts.driftAmp : 0.3;

  let u = 0; 

  function step(dt, tAbs) {
    const speed = worldSpeed * (0.5 + noise.noise2D(tAbs * 0.15, 5) * 0.2);
    u += (dt * speed) / roam;

    // 1. Core Infinity formula
    const cosU = Math.cos(u);
    const sinU = Math.sin(u);
    const denom = 1 + sinU * sinU;

    // 2. CENTER DRIFT LOGIC
    // We add a slow-moving offset to the raw coordinates before rotation.
    // This pushes the "crossing point" away from (0,0).
    const driftX = noise.noise2D(tAbs * 0.1, 100) * (roam * driftAmp);
    const driftY = noise.noise2D(tAbs * 0.12, 200) * (roam * driftAmp);

    let lx = ((roam * cosU) / denom) + driftX;
    let ly = ((roam * sinU * cosU) / denom) + driftY;

    // 3. Overall Rotation
    const symbolRotation = tAbs * rotationRate;
    const r = rotate2D(lx, ly, symbolRotation);

    // 4. Micro Hand-Shake
    const shake = noise.noise2D(tAbs * 2, u) * (roam * 0.02);
    
    return { 
        x: r.x + shake, 
        y: r.y + shake 
    };
  }

  return { step };
}

// -----------------------------
// AIM DISC
// -----------------------------
export function createAimDisc(board, opts = {}) {
  const boardRadius = board.userData.boardRadius || 2.05;
  const maxRadius = opts.maxRadius || 0.75;
  const minRadius = opts.minRadius || 0.06;
  const shrinkTime = opts.shrinkTime || 1.25;
  const discZ = opts.z || 0.34;
  
  const roam = opts.roam || boardRadius * 0.7;

  const walker = makeAimWalker({
    seed: opts.seed || 1337,
    roam: roam,
    driftAmp: 0.35, // Adjust this to control how far it drifts from center
    rotationRate: 0.3,
    worldSpeed: roam * 2.0,
    ...opts
  });

  const geom = new THREE.CircleGeometry(1, 80);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff2a2a,
    transparent: true,
    opacity: 0.40,
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

  function releaseAndSampleHit() {
    const holdP = clamp01(state.holdTime / shrinkTime);
    const skill = smoothstep(holdP);
    
    // Variance/Miss
    const miss = lerp(0.15, 0.02, skill);
    const mAngle = Math.random() * Math.PI * 2;
    const mR = Math.sqrt(Math.random()) * miss;

    const hitX = state.centerX + Math.cos(mAngle) * mR;
    const hitY = state.centerY + Math.sin(mAngle) * mR;

    state.holding = false;
    state.holdTime = 0;
    state.radius = maxRadius;

    return { centerX: state.centerX, centerY: state.centerY, hitX, hitY, skill };
  }

  function update(delta) {
    if (!state.enabled) return;
    state.time += delta;

    if (!state.holding) {
      const p = walker.step(delta, state.time);
      state.centerX = p.x;
      state.centerY = p.y;
      state.radius = maxRadius;
    } else {
      state.holdTime += delta;
      const p = clamp01(state.holdTime / shrinkTime);
      state.radius = maxRadius + (minRadius - maxRadius) * p;
    }

    mesh.position.set(state.centerX, state.centerY, discZ + Math.sin(state.time * 3) * 0.01);
    mesh.scale.set(state.radius, state.radius, 1);
  }

  return {
    mesh,
    setEnabled: (val) => { state.enabled = !!val; mesh.visible = state.enabled; },
    beginHold: () => { state.holding = true; state.holdTime = 0; },
    cancelHold: () => { state.holding = false; },
    releaseAndSampleHit,
    update,
  };
}