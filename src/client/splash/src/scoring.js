/**
 * scoring.js
 *
 * Pure scoring logic for a standard dartboard.
 * - No DOM
 * - No Three.js
 *
 * Expected inputs:
 *   x, y: hit position in BOARD-LOCAL coordinates on the dartboard face plane,
 *         where +x is right, +y is up, origin at the board center.
 *
 * Expected config (created in board.js):
 *   scoringConfig = {
 *     segments: 20,
 *     wedgeAngle: 2π/20,
 *
 *     // IMPORTANT: this is the CENTER angle of wedge 0 (20) in math coords
 *     startAngle: number,
 *
 *     // "ccw" or "cw" direction of index progression with angle
 *     direction: "ccw" | "cw",
 *
 *     // optional rotation applied to theta before wedge mapping
 *     angleOffset: number,
 *
 *     numbers: number[20],
 *
 *     ringRatios: {
 *       outer,
 *       doubleInner, doubleOuter,
 *       tripleInner, tripleOuter,
 *       bullOuter, dbullOuter
 *     },
 *
 *     ringEpsN: number (optional) // normalized epsilon tolerance for rings
 *     points: { bull:25, dbull:50 }
 *
 *     // NOTE: boardRadius is NOT included by default in board.js,
 *     // but the caller should pass it in:
 *     // scoreFromBoardXY(x, y, { ...board.userData.scoring, boardRadius: board.userData.boardRadius })
 *   }
 *
 * Returns:
 *   {
 *     points: number,
 *     label: string,      // "T20", "D16", "S5", "SBULL", "DBULL", "MISS"
 *     wedge: number|null, // 1..20 if applicable
 *     wedgeIndex: number|null, // 0..19 if applicable
 *     mult: number,       // 0 (miss) or 1/2/3; bulls mult=0 (special)
 *     ring: string,       // "MISS" | "DBULL" | "SBULL" | "DOUBLE" | "TRIPLE" | "SINGLE"
 *     angle: number,      // normalized angle 0..2π after adjustment
 *     radius: number,     // distance from center (same units as x/y)
 *     rNorm: number,      // normalized radius (r / boardRadius) if boardRadius provided, else r
 *   }
 */

function normAngle0To2Pi(a) {
  const TWO_PI = Math.PI * 2;
  let x = a % TWO_PI;
  if (x < 0) x += TWO_PI;
  return x;
}

function getRingEpsN(scoringConfig) {
  const v = scoringConfig?.ringEpsN;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return 0.01; // default tolerance
}

/**
 * Determine which wedge index (0..19) a hit belongs to using a "center-angle" model.
 *
 * scoringConfig.startAngle = CENTER angle of wedge 0 (20).
 *
 * We compute delta from that center angle, in the configured direction, and round
 * to the nearest wedge by adding wedgeAngle/2 before floor().
 */
function wedgeIndexFromAngle(theta, scoringConfig) {
  const wedgeAngle = scoringConfig.wedgeAngle;
  const startAngleCenter = scoringConfig.startAngle;

  const direction = scoringConfig.direction === "cw" ? "cw" : "ccw";
  const angleOffset = typeof scoringConfig.angleOffset === "number" ? scoringConfig.angleOffset : 0;

  // Apply scoring rotation offset first
  const a = normAngle0To2Pi(theta + angleOffset);

  // Compute delta from wedge0 center, moving in the chosen direction
  let delta;
  if (direction === "cw") {
    delta = normAngle0To2Pi(startAngleCenter - a);
  } else {
    delta = normAngle0To2Pi(a - startAngleCenter);
  }

  // Round to nearest wedge center
  const idx = Math.floor((delta + wedgeAngle / 2) / wedgeAngle) % 20;
  return idx;
}

/**
 * Determine which scoring ring a hit is in based on radius ratios.
 * rNorm = r / boardRadius (or r if boardRadius not provided)
 * Adds epsilon tolerance to reduce "barely in band" misses.
 */
function ringFromRadiusRatio(rNorm, scoringConfig) {
  const rr = scoringConfig.ringRatios;
  const eps = getRingEpsN(scoringConfig);

  // Outside the playable board
  if (rNorm > rr.outer + eps) {
    return { ring: "MISS", mult: 0 };
  }

  // Bulls
  if (rNorm <= rr.dbullOuter + eps) {
    return { ring: "DBULL", mult: 0 };
  }
  if (rNorm <= rr.bullOuter + eps) {
    return { ring: "SBULL", mult: 0 };
  }

  // Double band
  if (rNorm >= rr.doubleInner - eps && rNorm <= rr.doubleOuter + eps) {
    return { ring: "DOUBLE", mult: 2 };
  }

  // Triple band
  if (rNorm >= rr.tripleInner - eps && rNorm <= rr.tripleOuter + eps) {
    return { ring: "TRIPLE", mult: 3 };
  }

  // Otherwise single
  return { ring: "SINGLE", mult: 1 };
}

/**
 * Main API: score a hit at (x, y).
 */
export function scoreFromBoardXY(x, y, scoringConfig) {
  // Defensive checks
  if (!scoringConfig || typeof scoringConfig !== "object") {
    return {
      points: 0,
      label: "MISS",
      wedge: null,
      wedgeIndex: null,
      mult: 0,
      ring: "MISS",
      angle: 0,
      radius: 0,
      rNorm: 0,
    };
  }

  const numbers = Array.isArray(scoringConfig.numbers) ? scoringConfig.numbers : null;
  const rr = scoringConfig.ringRatios;
  const wedgeAngle = scoringConfig.wedgeAngle;
  const startAngle = scoringConfig.startAngle;

  if (!numbers || numbers.length !== 20 || !rr || typeof wedgeAngle !== "number" || typeof startAngle !== "number") {
    return {
      points: 0,
      label: "MISS",
      wedge: null,
      wedgeIndex: null,
      mult: 0,
      ring: "MISS",
      angle: 0,
      radius: 0,
      rNorm: 0,
    };
  }

  const boardRadiusRaw = scoringConfig.boardRadius;
  const hasBoardRadius =
    typeof boardRadiusRaw === "number" && Number.isFinite(boardRadiusRaw) && boardRadiusRaw > 0;

  const r = Math.sqrt(x * x + y * y);
  const rNorm = hasBoardRadius ? r / boardRadiusRaw : r;

  // Determine ring / multiplier
  const ringInfo = ringFromRadiusRatio(rNorm, scoringConfig);

  // Bulls are special scoring
  if (ringInfo.ring === "DBULL") {
    const dbull = Number(scoringConfig.points?.dbull ?? 50);
    return {
      points: dbull,
      label: "DBULL",
      wedge: null,
      wedgeIndex: null,
      mult: 0,
      ring: "DBULL",
      angle: 0,
      radius: r,
      rNorm,
    };
  }

  if (ringInfo.ring === "SBULL") {
    const bull = Number(scoringConfig.points?.bull ?? 25);
    return {
      points: bull,
      label: "SBULL",
      wedge: null,
      wedgeIndex: null,
      mult: 0,
      ring: "SBULL",
      angle: 0,
      radius: r,
      rNorm,
    };
  }

  // Miss
  if (ringInfo.ring === "MISS") {
    return {
      points: 0,
      label: "MISS",
      wedge: null,
      wedgeIndex: null,
      mult: 0,
      ring: "MISS",
      angle: 0,
      radius: r,
      rNorm,
    };
  }

  // Angle-based wedge scoring
  const theta = Math.atan2(y, x); // -PI..PI, 0 on +x axis
  const thetaNorm = normAngle0To2Pi(theta);

  const idx = wedgeIndexFromAngle(thetaNorm, scoringConfig);
  const wedgeValue = Number(numbers[idx] ?? 0);

  const mult = ringInfo.mult;
  const points = wedgeValue * mult;

  let labelPrefix = "S";
  if (mult === 2) labelPrefix = "D";
  if (mult === 3) labelPrefix = "T";

  const label = `${labelPrefix}${wedgeValue}`;

  return {
    points,
    label,
    wedge: wedgeValue,
    wedgeIndex: idx,
    mult,
    ring: ringInfo.ring,
    angle: thetaNorm,
    radius: r,
    rNorm,
  };
}

/**
 * Convenience helper to format a "Last hit" string for HUD use.
 * Example: "T20 (+60)", "DBULL (+50)", "MISS (+0)"
 */
export function formatHitForHud(scoreResult) {
  if (!scoreResult || typeof scoreResult !== "object") return "—";

  const label = typeof scoreResult.label === "string" ? scoreResult.label : "—";
  const pts = Number(scoreResult.points) || 0;

  if (label === "MISS") return "MISS (+0)";
  if (label === "SBULL") return `SBULL (+${pts})`;
  if (label === "DBULL") return `DBULL (+${pts})`;

  return `${label} (+${pts})`;
}

/**
 * Small helper: validate that scoring config looks sane.
 * Useful for debugging / logging once during startup.
 */
export function validateScoringConfig(scoringConfig) {
  const errs = [];

  if (!scoringConfig || typeof scoringConfig !== "object") {
    errs.push("scoringConfig missing or not an object");
    return { ok: false, errors: errs };
  }

  if (!Array.isArray(scoringConfig.numbers) || scoringConfig.numbers.length !== 20) {
    errs.push("scoringConfig.numbers must be an array of length 20");
  }

  if (typeof scoringConfig.startAngle !== "number") {
    errs.push("scoringConfig.startAngle (center angle) must be a number");
  }

  if (typeof scoringConfig.wedgeAngle !== "number") {
    errs.push("scoringConfig.wedgeAngle must be a number");
  }

  const dir = scoringConfig.direction;
  if (dir !== "ccw" && dir !== "cw") {
    errs.push('scoringConfig.direction must be "ccw" or "cw"');
  }

  const rr = scoringConfig.ringRatios;
  if (!rr || typeof rr !== "object") {
    errs.push("scoringConfig.ringRatios missing");
  } else {
    const needed = [
      "outer",
      "doubleInner",
      "doubleOuter",
      "tripleInner",
      "tripleOuter",
      "bullOuter",
      "dbullOuter",
    ];
    for (const k of needed) {
      if (typeof rr[k] !== "number") errs.push(`scoringConfig.ringRatios.${k} must be a number`);
    }
  }

  const eps = scoringConfig.ringEpsN;
  if (eps !== undefined && !(typeof eps === "number" && Number.isFinite(eps) && eps >= 0)) {
    errs.push("scoringConfig.ringEpsN must be a finite number >= 0 if provided");
  }

  return { ok: errs.length === 0, errors: errs };
}
