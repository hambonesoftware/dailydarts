import * as THREE from "three";

/**
 * Floating chalkboard logo with a varnished wooden frame.
 * - No external assets.
 * - Chalkboard is a CanvasTexture.
 * - Sign "billboards" in front of the camera and animates in/out.
 */
export function createDailyDartsLogo(scene) {
  // -----------------------------
  // Config
  // -----------------------------
  const CANVAS_W = 1400;
  const CANVAS_H = 800;

  const BOARD_W = 6.2; // world units
  const BOARD_H = 3.6;

  const FRAME_THICK = 0.22; // frame depth
  const FRAME_FACE = 0.25;  // frame border width around board

  const DIST_NEAR = 4.85; // how close to camera at end of reveal
  const DIST_FAR = 5.35; // where it starts from
  const UP_OFFSET = -0.05; // move sign slightly down in view
  const RIGHT_OFFSET = 0.0;

  const SHOW_DURATION = 1.10;
  const HOLD_DURATION = 2.20;
  const HIDE_DURATION = 0.70;

  // -----------------------------
  // Scratch vectors/quats to avoid per-frame allocations
  // -----------------------------
  const vForward = new THREE.Vector3();
  const vUp = new THREE.Vector3();
  const vRight = new THREE.Vector3();
  const vPos = new THREE.Vector3();

  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

  // -----------------------------
  // Helpers
  // -----------------------------
  function clamp01(t) {
    return Math.max(0, Math.min(1, t));
  }

  function easeOutCubic(t) {
    t = clamp01(t);
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOutCubic(t) {
    t = clamp01(t);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeOutBack(t) {
    t = clamp01(t);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function randBetween(a, b) {
    return a + Math.random() * (b - a);
  }

  // -----------------------------
  // Chalkboard CanvasTexture
  // -----------------------------
  function createChalkboardTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // Fallback: plain dark texture
      const fallback = document.createElement("canvas");
      fallback.width = 8;
      fallback.height = 8;
      const c2 = fallback.getContext("2d");
      if (c2) {
        c2.fillStyle = "#1a2723";
        c2.fillRect(0, 0, 8, 8);
      }
      const tex = new THREE.CanvasTexture(fallback);
      tex.colorSpace = THREE.SRGBColorSpace;
      return {
        texture: tex,
        drawLogo: () => {},
        drawLeaderboard: () => {},
      };
    }

    function drawBackground() {
      // Base board color
      ctx.fillStyle = "#1b2a26";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Subtle vignette
      const grad = ctx.createRadialGradient(
        CANVAS_W * 0.5,
        CANVAS_H * 0.5,
        CANVAS_H * 0.1,
        CANVAS_W * 0.5,
        CANVAS_H * 0.5,
        CANVAS_H * 0.75
      );
      grad.addColorStop(0, "rgba(0,0,0,0.00)");
      grad.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Chalk dust noise
      const img = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        const n = Math.random();
        const dust = n < 0.06 ? randBetween(8, 24) : 0; // sparse dust
        data[i + 0] = Math.min(255, data[i + 0] + dust);
        data[i + 1] = Math.min(255, data[i + 1] + dust);
        data[i + 2] = Math.min(255, data[i + 2] + dust);
        data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }

    // Chalk stroke helper (draw multiple times with jitter)
    function chalkStrokeText(text, x, y, font, align = "center") {
      ctx.save();
      ctx.font = font;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";

      // main soft stroke
      for (let i = 0; i < 10; i++) {
        const jx = randBetween(-2.2, 2.2);
        const jy = randBetween(-2.0, 2.0);
        const a = randBetween(0.06, 0.12);
        ctx.fillStyle = `rgba(245,245,245,${a})`;
        ctx.fillText(text, x + jx, y + jy);
      }

      // crisp pass
      for (let i = 0; i < 4; i++) {
        const jx = randBetween(-0.8, 0.8);
        const jy = randBetween(-0.8, 0.8);
        const a = randBetween(0.18, 0.30);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillText(text, x + jx, y + jy);
      }

      // extra chalk speckle on top of letters
      for (let i = 0; i < 250; i++) {
        const px = x + randBetween(-240, 240);
        const py = y + randBetween(-40, 40);
        ctx.fillStyle = `rgba(255,255,255,${randBetween(0.03, 0.09)})`;
        ctx.fillRect(px, py, randBetween(1, 2), randBetween(1, 2));
      }

      ctx.restore();
    }

    function chalkTextLine(text, x, y, font, align = "left") {
      ctx.save();
      ctx.font = font;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";

      for (let i = 0; i < 3; i++) {
        const jx = randBetween(-1.0, 1.0);
        const jy = randBetween(-1.0, 1.0);
        const a = randBetween(0.6, 0.9);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillText(text, x + jx, y + jy);
      }

      ctx.restore();
    }

    // Draw chalk dartboard sketch
    function chalkDartboard(cx, cy, radius) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.40)";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      function jitterLineCircle(r, passes, alphaBase) {
        for (let p = 0; p < passes; p++) {
          const a = alphaBase * randBetween(0.55, 1.0);
          ctx.strokeStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath();
          const steps = 120;
          for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * Math.PI * 2;
            const jr = randBetween(-2.2, 2.2);
            const x = cx + Math.cos(t) * (r + jr);
            const y = cy + Math.sin(t) * (r + jr);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // rings
      jitterLineCircle(radius * 1.0, 3, 0.20);
      jitterLineCircle(radius * 0.82, 2, 0.18);
      jitterLineCircle(radius * 0.58, 2, 0.18);
      jitterLineCircle(radius * 0.10, 2, 0.22);

      // spokes
      ctx.lineWidth = 3;
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const x0 = cx + Math.cos(ang) * (radius * 0.15);
        const y0 = cy + Math.sin(ang) * (radius * 0.15);
        const x1 = cx + Math.cos(ang) * (radius * 0.98);
        const y1 = cy + Math.sin(ang) * (radius * 0.98);

        for (let p = 0; p < 2; p++) {
          ctx.strokeStyle = `rgba(255,255,255,${randBetween(0.10, 0.22)})`;
          ctx.beginPath();
          ctx.moveTo(x0 + randBetween(-2, 2), y0 + randBetween(-2, 2));
          ctx.lineTo(x1 + randBetween(-2, 2), y1 + randBetween(-2, 2));
          ctx.stroke();
        }
      }

      // bull
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(
          cx + randBetween(-1.5, 1.5),
          cy + randBetween(-1.5, 1.5),
          radius * 0.05,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      ctx.restore();
    }

    function drawLogoBoard() {
      drawBackground();

      // Title
      chalkStrokeText(
        "DAILY DARTS",
        CANVAS_W * 0.5,
        CANVAS_H * 0.30,
        "900 120px Arial",
        "center"
      );

      // Subtitle (smaller, softer)
      chalkStrokeText(
        "Hit the bull. Chase the streak.",
        CANVAS_W * 0.5,
        CANVAS_H * 0.42,
        "700 48px Arial",
        "center"
      );

      // Dartboard sketch
      chalkDartboard(CANVAS_W * 0.5, CANVAS_H * 0.70, CANVAS_H * 0.20);

      // Bottom scribble line
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      const y = CANVAS_H * 0.92;
      ctx.moveTo(CANVAS_W * 0.18, y);
      for (let i = 0; i <= 16; i++) {
        const x = CANVAS_W * 0.18 + (CANVAS_W * 0.64 * i) / 16;
        ctx.lineTo(x, y + Math.sin(i * 0.7) * randBetween(-8, 8));
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawLeaderboardBoard(data) {
      drawBackground();

      chalkStrokeText(
        "LEADERBOARD",
        CANVAS_W * 0.5,
        CANVAS_H * 0.16,
        "900 96px Arial",
        "center"
      );

      const scoreText =
        typeof data?.score === "number" ? `Score: ${data.score}` : "Score: —";
      const rankText =
        typeof data?.rank === "number" ? `Rank: #${data.rank}` : "Rank: —";

      chalkTextLine(scoreText, CANVAS_W * 0.18, CANVAS_H * 0.30, "700 44px Arial", "left");
      chalkTextLine(rankText, CANVAS_W * 0.82, CANVAS_H * 0.30, "700 44px Arial", "right");

      chalkTextLine("Top Throws", CANVAS_W * 0.5, CANVAS_H * 0.40, "700 38px Arial", "center");

      const listStartY = CANVAS_H * 0.50;
      const lineHeight = 52;
      const entries = Array.isArray(data?.top) ? data.top : [];

      for (let i = 0; i < 5; i++) {
        const entry = entries[i];
        const y = listStartY + i * lineHeight;
        const rankLabel = entry?.rank ? `#${entry.rank}` : `#${i + 1}`;
        const name = entry?.metadata?.username || entry?.userId || "anonymous";
        const score = typeof entry?.score === "number" ? entry.score : 0;
        chalkTextLine(rankLabel, CANVAS_W * 0.2, y, "600 36px Arial", "left");
        chalkTextLine(name, CANVAS_W * 0.5, y, "600 36px Arial", "center");
        chalkTextLine(`${score}`, CANVAS_W * 0.82, y, "700 36px Arial", "right");
      }

      if (data?.username) {
        chalkTextLine(
          `Good darts, ${data.username}!`,
          CANVAS_W * 0.5,
          CANVAS_H * 0.88,
          "600 34px Arial",
          "center"
        );
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    drawLogoBoard();
    tex.needsUpdate = true;

    return {
      texture: tex,
      drawLogo: () => {
        drawLogoBoard();
        tex.needsUpdate = true;
      },
      drawLeaderboard: (data) => {
        drawLeaderboardBoard(data);
        tex.needsUpdate = true;
      },
    };
  }

  function makeWoodTexture() {
    const w = 1024;
    const h = 256;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    // Base
    ctx.fillStyle = "#5a3a22";
    ctx.fillRect(0, 0, w, h);

    // Grain bands
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const band = Math.sin(t * Math.PI * 10) * 18 + Math.sin(t * Math.PI * 22) * 8;
      const c = 90 + band;
      ctx.fillStyle = `rgba(${c}, ${55 + band * 0.2}, ${30 + band * 0.1}, 0.20)`;
      ctx.fillRect(0, y, w, 1);
    }

    // Knots / streaks
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const rw = randBetween(80, 220);
      const rh = randBetween(10, 26);
      ctx.fillStyle = `rgba(20,10,5,${randBetween(0.06, 0.14)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rw, rh, randBetween(-0.4, 0.4), 0, Math.PI * 2);
      ctx.fill();
    }

    // Varnish sheen streaks
    for (let i = 0; i < 10; i++) {
      const y = randBetween(0, h);
      const g = ctx.createLinearGradient(0, y, w, y);
      g.addColorStop(0, "rgba(255,255,255,0.00)");
      g.addColorStop(0.45, "rgba(255,255,255,0.08)");
      g.addColorStop(0.55, "rgba(255,255,255,0.08)");
      g.addColorStop(1, "rgba(255,255,255,0.00)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 6, w, 12);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2.5, 1.0);
    tex.needsUpdate = true;
    return tex;
  }

  const chalkboard = createChalkboardTexture();
  const chalkTex = chalkboard.texture;
  const woodTex = makeWoodTexture();

  // -----------------------------
  // Build 3D sign
  // -----------------------------
  const group = new THREE.Group();
  group.name = "DailyDartsChalkboardLogo";
  group.visible = false;

  // Chalkboard plane
  const boardGeom = new THREE.PlaneGeometry(BOARD_W, BOARD_H, 1, 1);
  const boardMat = new THREE.MeshStandardMaterial({
    map: chalkTex,
    roughness: 0.98,
    metalness: 0.0,
    emissive: new THREE.Color(0x000000),
    transparent: true,
    opacity: 1.0,
  });
  // Always draw on top so the chalk writing cannot be occluded
  boardMat.depthTest = false;
  boardMat.depthWrite = false;
  const boardMesh = new THREE.Mesh(boardGeom, boardMat);
  boardMesh.position.set(0, 0, 0.02);
  boardMesh.frustumCulled = false;
  boardMesh.renderOrder = 10000;
  group.add(boardMesh);

  // Wooden frame parts (4 sticks)
  const woodMat = new THREE.MeshPhysicalMaterial({
    map: woodTex,
    color: new THREE.Color(0xffffff),
    roughness: 0.38,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
    specularIntensity: 0.95,
    transparent: true,
    opacity: 1.0,
  });


  woodMat.depthTest = false;
  woodMat.depthWrite = false;
  const frameGroup = new THREE.Group();
  frameGroup.frustumCulled = false;

  const outerW = BOARD_W + FRAME_FACE * 2;
  const outerH = BOARD_H + FRAME_FACE * 2;

  const topGeom = new THREE.BoxGeometry(outerW, FRAME_FACE, FRAME_THICK);
  const sideGeom = new THREE.BoxGeometry(FRAME_FACE, BOARD_H, FRAME_THICK);

  const top = new THREE.Mesh(topGeom, woodMat);
  top.position.set(0, (BOARD_H / 2) + (FRAME_FACE / 2), 0);
  top.frustumCulled = false;

  const bottom = new THREE.Mesh(topGeom, woodMat);
  bottom.position.set(0, -(BOARD_H / 2) - (FRAME_FACE / 2), 0);
  bottom.frustumCulled = false;

  const left = new THREE.Mesh(sideGeom, woodMat);
  left.position.set(-(BOARD_W / 2) - (FRAME_FACE / 2), 0, 0);
  left.frustumCulled = false;

  const right = new THREE.Mesh(sideGeom, woodMat);
  right.position.set((BOARD_W / 2) + (FRAME_FACE / 2), 0, 0);
  right.frustumCulled = false;

  frameGroup.add(top);
  frameGroup.add(bottom);
  frameGroup.add(left);
  frameGroup.add(right);

  // Backing plate (subtle dark back so edges feel solid)
  const backGeom = new THREE.BoxGeometry(outerW, outerH, 0.06);
  const backMat = new THREE.MeshStandardMaterial({
    color: 0x0b0c10,
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0,
  });

  backMat.depthTest = false;
  backMat.depthWrite = false;
  const backing = new THREE.Mesh(backGeom, backMat);
  backing.renderOrder = 9998;
  backing.position.set(0, 0, -0.02);
  backing.frustumCulled = false;

  group.add(backing);
  group.add(frameGroup);

  scene.add(group);

  // Materials list for fading
  const fadeMats = [boardMat, woodMat, backMat];

  const boardState = {
    mode: "logo",
    leaderboardData: null,
  };

  function renderChalkboard() {
    if (boardState.mode === "leaderboard") {
      chalkboard.drawLeaderboard(boardState.leaderboardData);
      return;
    }
    chalkboard.drawLogo();
  }

  // -----------------------------
  // Animation state machine
  // -----------------------------
  const state = {
    mode: "hidden", // "hidden" | "showing" | "holding" | "hiding"
    t: 0,
    hold: 0,
    // animated params
    scale: 0.001,
    opacity: 0.0,
    holdForever: false,
  };

  function setOpacity(a) {
    for (const m of fadeMats) {
      m.opacity = a;
      m.transparent = true;
      m.needsUpdate = true;
    }
  }

  function applyBillboardToCamera(camera) {
    // Position in front of camera
    vForward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    vUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    vRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();

    // Distance changes based on animation progress
    const dist = DIST_FAR + (DIST_NEAR - DIST_FAR) * state.t;

    vPos.copy(camera.position);
    vPos.addScaledVector(vForward, dist);
    vPos.addScaledVector(vUp, UP_OFFSET);
    vPos.addScaledVector(vRight, RIGHT_OFFSET);

    group.position.copy(vPos);

    // Make the sign face the camera (true billboard)
    group.quaternion.copy(camera.quaternion);
  }

  // Public API
  return {
    group,
    setMode: (mode = "logo") => {
      boardState.mode = mode === "leaderboard" ? "leaderboard" : "logo";
      renderChalkboard();
    },
    setLeaderboardData: (data) => {
      boardState.mode = "leaderboard";
      boardState.leaderboardData = data ?? null;
      renderChalkboard();
    },

    show: (opts = {}) => {
      state.holdForever = !!(opts && opts.holdForever);

      state.mode = "showing";
      state.t = 0;
      state.hold = 0;
      state.scale = 0.001;
      state.opacity = 0.0;
      group.visible = true;
      setOpacity(0.0);
    },

    hide: (immediate = false) => {
      if (immediate) {
        state.mode = "hidden";
        state.t = 0;
        state.hold = 0;
        state.scale = 0.001;
        state.opacity = 0.0;
        group.visible = false;
        return;
      }
      if (state.mode === "hidden") return;
      state.mode = "hiding";
      state.t = 1;
    },

    update: (delta, camera) => {
      if (!group.visible) return;

      // Clamp delta to avoid huge jumps after tab switches
      delta = Math.min(Math.max(delta, 0), 1 / 20);

      if (state.mode === "showing") {
        const tt = clamp01(state.t + delta / SHOW_DURATION);
        state.t = tt;

        const eased = easeOutBack(tt);
        state.scale = 0.45 + 0.45 * eased; // 0.45 -> 0.90 overshoot
        state.opacity = easeOutCubic(tt);

        // After overshoot, normalize back to 0.85 near the end
        if (tt > 0.85) {
          const n = (tt - 0.85) / 0.15;
          state.scale = state.scale + (0.85 - state.scale) * easeInOutCubic(n);
        }

        setOpacity(state.opacity);

        if (tt >= 1) {
          state.mode = "holding";
          state.hold = 0;
          state.scale = 0.85;
          state.opacity = 1.0;
          setOpacity(1.0);
        }
      } else if (state.mode === "holding") {
        state.hold += delta;
        state.t = 1;
        state.scale = 0.85;
        state.opacity = 1.0;
        setOpacity(1.0);

        if (!state.holdForever && state.hold >= HOLD_DURATION) {
          state.mode = "hiding";
          state.t = 1;
        }
      } else if (state.mode === "hiding") {
        const tt = clamp01(state.t - delta / HIDE_DURATION);
        state.t = tt;

        const eased = easeInOutCubic(tt);
        state.scale = 0.65 + 0.20 * eased; // 0.65 -> 0.85 while fading
        state.opacity = eased;

        setOpacity(state.opacity);

        if (tt <= 0) {
          state.mode = "hidden";
          group.visible = false;
        }
      }

      // Always keep it in front of camera (billboard)
      applyBillboardToCamera(camera);

      // Apply scale
      group.scale.setScalar(state.scale);
    },

    dispose: () => {
      scene.remove(group);

      boardGeom.dispose();
      boardMat.dispose();
      chalkTex.dispose();

      topGeom.dispose();
      sideGeom.dispose();
      woodMat.dispose();
      woodTex.dispose();

      backGeom.dispose();
      backMat.dispose();
    },
  };
}
