import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";

/**
 * Canonical dartboard wedge order (clockwise, starting at 20 at the top).
 * This must match BOTH the drawn face and the 3D number placement.
 */
export const DARTBOARD_NUMBERS = [
  20, 1, 18, 4, 13,
  6, 10, 15, 2, 17,
  3, 19, 7, 16, 8,
  11, 14, 9, 12, 5,
];

/**
 * Create a cabinet-style dartboard + expose scoring config on group.userData.scoring
 */
export function createDartboard(options = {}) {
  const boardRadius = options.boardRadius ?? 2.05;
  const boardThickness = 0.35;
  const position = options.position ?? new THREE.Vector3(0, 1.85, -1.5);
  const includeWall =
    options.includeWall !== undefined ? !!options.includeWall : true;

  const group = new THREE.Group();

  // Expose board dimensions for gameplay (aim disc + hit testing)
  group.userData.boardRadius = boardRadius;
  group.userData.boardThickness = boardThickness;

  // -----------------------------
  // Scoring geometry + constants
  // -----------------------------
  const segments = 20;
  const wedgeAngle = (Math.PI * 2) / segments;

  /**
   * Canvas wedges:
   * Canvas uses +y down, so increasing angles appear clockwise on screen.
   * We want segment 0 centered at the TOP.
   */
  const canvasStartAngle = -Math.PI / 2 - wedgeAngle / 2;

  /**
   * Scoring wedges:
   * Your scoring.js (per your comments) uses startAngle as the CENTER angle of wedge 0 (20)
   * in math coords (+y up). TOP is +PI/2.
   *
   * We place numbers clockwise, so scoring direction should be "cw".
   */
  const scoringStartAngleCenter = Math.PI / 2;

  // -----------------------------
  // IMPORTANT FIX: FACE SCALING
  // -----------------------------
  /**
   * The bug you’re seeing is because the board face was being drawn to 480px radius
   * on a 1024 canvas (true half-width is 512), so the painted rings were ~6.25% smaller
   * than the geometry/scoring space. Scoring + glow matched each other, not the paint.
   *
   * Fix: draw to a true outer radius of 512px and scale all legacy radii by 512/480.
   */
  const CANVAS_SIZE = 1024;
  const CX = CANVAS_SIZE / 2;
  const CY = CANVAS_SIZE / 2;

  // Legacy design radii were authored against an outer radius of 480px
  const LEGACY_OUTER_PX = 480;

  // We now draw the face to the full half-canvas radius so it matches geometry space
  const FACE_OUTER_PX = 512;

  // Scale factor from legacy design to full face
  const FACE_SCALE = FACE_OUTER_PX / LEGACY_OUTER_PX; // 512/480 = 1.066666...

  // Scaled draw radii (these are the "truth" for paint + scoring ratios)
  const R_OUTER = FACE_OUTER_PX;
  const R_DOUBLE_INNER = 445 * FACE_SCALE;
  const R_DOUBLE_OUTER = 480 * FACE_SCALE; // becomes 512
  const R_TRIPLE_INNER = 275 * FACE_SCALE;
  const R_TRIPLE_OUTER = 310 * FACE_SCALE;
  const R_BULL_OUTER = 70 * FACE_SCALE;
  const R_DBULL_OUTER = 32 * FACE_SCALE;

  /**
   * ringRatios are normalized to the true outer radius (512px now).
   * These match the classic proportions (same as 445/480, 275/480, etc.).
   */
  const ringRatios = {
    outer: 1.0,
    doubleInner: R_DOUBLE_INNER / R_OUTER,
    doubleOuter: 1.0,
    tripleInner: R_TRIPLE_INNER / R_OUTER,
    tripleOuter: R_TRIPLE_OUTER / R_OUTER,
    bullOuter: R_BULL_OUTER / R_OUTER,
    dbullOuter: R_DBULL_OUTER / R_OUTER,
  };

  /**
   * Scoring config consumed by scoring.js (+ hitGlow)
   */
  group.userData.scoring = {
    segments,
    wedgeAngle,

    // CENTER angle of wedge 0 (20)
    startAngle: scoringStartAngleCenter,

    // We place numbers clockwise around the board
    direction: "cw",

    // No extra rotation applied to scoring wedges
    angleOffset: 0,

    numbers: [...DARTBOARD_NUMBERS],
    faceOuterPx: FACE_OUTER_PX,
    ringRatios: { ...ringRatios },

    // Tolerance (if your scoring.js uses it)
    ringEpsN: 0.010,

    points: {
      bull: 25,
      dbull: 50,
    },
  };

  // --- 1. THE VISIBLE BACKBOARD (Cabinet Style) ---
  if (includeWall) {
    const backboardSize = 6.0;
    const backboardDepth = 0.02;

    const woodCanvas = document.createElement("canvas");
    woodCanvas.width = 1024;
    woodCanvas.height = 1024;
    const wCtx = woodCanvas.getContext("2d");

    // Base coat (dark bar wood)
    wCtx.fillStyle = "#2b1d0e";
    wCtx.fillRect(0, 0, 1024, 1024);

    // Vertical planks (warm bar / mahogany vibe)
    for (let i = 0; i < 15; i++) {
      const plankW = 1024 / 15;

      const tone = 0;
      wCtx.fillStyle = `rgb(${tone + 130}, ${tone + 30}, ${tone + 25})`;
      wCtx.fillRect(i * plankW, 0, plankW, 1024);

      wCtx.strokeStyle = "rgba(0,0,0,0.7)";
      wCtx.lineWidth = 2;
      wCtx.strokeRect(i * plankW, 0, plankW, 1024);

      for (let g = 0; g < 18; g++) {
        wCtx.fillStyle = "rgba(255,255,255,0.03)";
        wCtx.fillRect(
          i * plankW + Math.random() * plankW,
          Math.random() * 1024,
          180,
          1
        );
      }
    }

    // Horizontal plank accents
    for (let i = 0; i < 10; i++) {
      wCtx.strokeStyle = "rgba(0,0,0,0.35)";
      wCtx.lineWidth = 3;
      wCtx.strokeRect(0, i * 102.4, 1024, 102.4);
    }

    const woodTex = new THREE.CanvasTexture(woodCanvas);
    woodTex.colorSpace = THREE.SRGBColorSpace;
    woodTex.needsUpdate = true;

    const backboardMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.8,
      metalness: 0.1,
    });

    const backboard = new THREE.Mesh(
      new THREE.BoxGeometry(backboardSize, backboardSize, backboardDepth),
      backboardMat
    );
    backboard.position.z = -boardThickness / 2 - 0.1;
    backboard.receiveShadow = true;
    backboard.castShadow = true;
    group.add(backboard);

    const trimGeo = new THREE.BoxGeometry(backboardSize + 0.2, 0.2, 0.4);

    const topTrim = new THREE.Mesh(trimGeo, backboardMat);
    topTrim.position.set(0, backboardSize / 2, -0.05);
    topTrim.castShadow = true;
    topTrim.receiveShadow = true;
    group.add(topTrim);

    const bottomTrim = topTrim.clone();
    bottomTrim.position.y = -backboardSize / 2;
    group.add(bottomTrim);
  }

  // --- 2. THE TRADITIONAL BOARD FACE ---
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = CANVAS_SIZE;
  faceCanvas.height = CANVAS_SIZE;
  const ctx = faceCanvas.getContext("2d");

  const colors = {
    black: "#111111",
    cream: "#f2e8cf",
    red: "#bc0b0b",
    green: "#006d2c",
  };

  // Outer base wedges (black/cream) — now drawn to full 512px radius
  for (let i = 0; i < segments; i++) {
    const a0 = canvasStartAngle + (i * Math.PI * 2) / segments;
    const a1 = canvasStartAngle + ((i + 1) * Math.PI * 2) / segments;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, R_OUTER, a0, a1);
    ctx.fillStyle = i % 2 === 0 ? colors.black : colors.cream;
    ctx.fill();
  }

  const drawRing = (r0, r1) => {
    for (let i = 0; i < segments; i++) {
      const a0 = canvasStartAngle + (i * Math.PI * 2) / segments;
      const a1 = canvasStartAngle + ((i + 1) * Math.PI * 2) / segments;
      ctx.beginPath();
      ctx.arc(CX, CY, r1, a0, a1);
      ctx.arc(CX, CY, r0, a1, a0, true);
      ctx.fillStyle = i % 2 === 0 ? colors.green : colors.red;
      ctx.fill();
    }
  };

  // Double ring and Triple ring — scaled to match scoring/hitGlow
  drawRing(R_DOUBLE_INNER, R_DOUBLE_OUTER);
  drawRing(R_TRIPLE_INNER, R_TRIPLE_OUTER);

  // Bulls — scaled to match scoring/hitGlow
  ctx.beginPath();
  ctx.arc(CX, CY, R_BULL_OUTER, 0, Math.PI * 2);
  ctx.fillStyle = colors.green;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(CX, CY, R_DBULL_OUTER, 0, Math.PI * 2);
  ctx.fillStyle = colors.red;
  ctx.fill();

  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.needsUpdate = true;

  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    roughness: 1.0,
  });

  const board = new THREE.Mesh(
    new THREE.CylinderGeometry(boardRadius, boardRadius, boardThickness, 64),
    [
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        metalness: 0.7,
        roughness: 0.2,
      }),
      faceMat,
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
    ]
  );

  board.name = "dartboardFace";
  group.userData.faceMesh = board;

  // Rotate so the face points outward as used by your scene
  board.rotateX(Math.PI / 2);
  board.castShadow = true;
  group.add(board);

  // --- 3. THE SPIDER (Wires) ---
  const wireMat = new THREE.MeshStandardMaterial({
    color: 0xdddddd,
    metalness: 0.9,
    roughness: 0.1,
  });

  // Put wires on *real* boundaries so it visually matches the face better
  const spiderRatios = [
    0.995, // near outer rim
    ringRatios.doubleInner,
    ringRatios.tripleOuter,
    ringRatios.tripleInner,
    ringRatios.bullOuter,
    ringRatios.dbullOuter,
  ];

  spiderRatios.forEach((r) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(boardRadius * r, 0.008, 8, 128),
      wireMat
    );
    ring.position.z = boardThickness / 2 + 0.01;
    ring.castShadow = true;
    group.add(ring);
  });

  // --- 4. 3D NUMBERS ---
  const loader = new FontLoader();
  loader.load("/fonts/helvetiker_bold.typeface.json", (font) => {
    const numMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

    const numbersGroup = new THREE.Group();
    numbersGroup.name = "dartNumbersGroup";
    group.userData.numbersGroup = numbersGroup;
    group.add(numbersGroup);

    // Place numbers CLOCKWISE around the board:
    // angle(i) = TOP - i*wedgeAngle
    // (TOP in math coords is +PI/2)
    DARTBOARD_NUMBERS.forEach((num, i) => {
      const textGeo = new TextGeometry(num.toString(), {
        font,
        size: 0.22,
        height: 0.04,
        depth: 0.02,
      });

      textGeo.center();

      const textMesh = new THREE.Mesh(textGeo, numMat);

      const angle = Math.PI / 2 - (i * Math.PI * 2) / segments; // clockwise
      const radius = boardRadius * 1.12;

      textMesh.position.set(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        boardThickness / 2 + 0.05
      );

      // Keep upright relative to screen (readable)
      // If you prefer radial/tangent orientation, adjust this line.
      textMesh.rotation.z = 0;

      textMesh.castShadow = true;
      numbersGroup.add(textMesh);
    });
  });

  group.position.copy(position);
  return group;
}
