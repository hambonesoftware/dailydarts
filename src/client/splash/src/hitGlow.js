import * as THREE from "three";

/**
 * Ephemeral Halo Hit Glow:
 * - Uses a soft Gaussian-style falloff for a "bloom" look without post-processing.
 * - Bleeds slightly outside the wedge boundaries for an organic feel.
 * - Features a "hot" core and a soft outer aura.
 */
export function createHitGlow(boardGroup, opts = {}) {
  const scoring = boardGroup?.userData?.scoring;
  const boardRadius = boardGroup?.userData?.boardRadius;
  const boardThickness = boardGroup?.userData?.boardThickness;

  if (!scoring || typeof boardRadius !== "number" || typeof boardThickness !== "number") {
    throw new Error("createHitGlow: boardGroup missing userData");
  }

  const glowZ = typeof opts.z === "number" ? opts.z : (boardThickness / 2 + 0.02);
  const color = new THREE.Color(opts.color || 0xffd34d);
  const opacity = typeof opts.opacity === "number" ? opts.opacity : 1.0;

  // --- HALO SHADER MATERIAL ---
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        // Create a soft halo using a quadratic falloff
        // Center of UV is (0.5, 0.5)
        float radial = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
        float angular = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
        
        // The "Halo" effect: combines two layers of light
        float core = pow(radial * angular, 2.0);      // Sharp inner hit
        float aura = pow(radial * angular, 0.4);      // Wide ephemeral spill
        
        float intensity = (core * 1.5) + (aura * 0.4);
        
        // Multiply color by 1.5 for emission brightness
        gl_FragColor = vec4(uColor * 1.8, intensity * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  let activeMesh = null;

  function clear() {
    if (activeMesh) {
      boardGroup.remove(activeMesh);
      if (activeMesh.geometry) activeMesh.geometry.dispose();
      activeMesh = null;
    }
  }

  function makeBullGlow(innerR, outerR) {
    // Expand bull slightly for the halo spill
    const bleed = 0.005;
    const geom = new THREE.RingGeometry(Math.max(0, innerR - bleed), outerR + bleed, 64, 1);
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(0, 0, glowZ);
    mesh.renderOrder = 25000;
    return mesh;
  }

  function makeWedgeGlow(innerR, outerR, wedgeIndex) {
    const wedgeAngle = scoring.wedgeAngle;
    const startAngleCenter = scoring.startAngle;
    const direction = scoring.direction === "cw" ? -1 : 1;
    const angleOffset = scoring.angleOffset || 0;
    const center = startAngleCenter + (direction * wedgeIndex * wedgeAngle) + angleOffset;

    // --- "THIN BUT BLEEDING" GEOMETRY ---
    // padding: visual width of the core
    // bleed: how far the ephemeral halo is allowed to spill over the wires
    const padding = 0.12; 
    const bleed = 0.01; 

    const thetaStart = center - (wedgeAngle / 2) + (wedgeAngle * padding) - bleed;
    const thetaLength = (wedgeAngle * (1 - padding * 2)) + (bleed * 2);

    const geom = new THREE.RingGeometry(innerR - bleed, outerR + bleed, 32, 1, thetaStart, thetaLength);
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(0, 0, glowZ);
    mesh.renderOrder = 25000;
    return mesh;
  }

  function radiiForScore(scoreResult) {
    const rr = scoring.ringRatios;
    if (!scoreResult || scoreResult.ring === "MISS") return null;

    const rBullOuter = boardRadius * rr.bullOuter;
    const rDbullOuter = boardRadius * rr.dbullOuter;
    const rTripleInner = boardRadius * rr.tripleInner;
    const rTripleOuter = boardRadius * rr.tripleOuter;
    const rDoubleInner = boardRadius * rr.doubleInner;
    const rDoubleOuter = boardRadius * rr.doubleOuter;

    switch (scoreResult.ring) {
      case "DBULL": return { kind: "bull", innerR: 0, outerR: rDbullOuter };
      case "SBULL": return { kind: "bull", innerR: rDbullOuter, outerR: rBullOuter };
      case "TRIPLE": return { kind: "wedge", innerR: rTripleInner, outerR: rTripleOuter };
      case "DOUBLE": return { kind: "wedge", innerR: rDoubleInner, outerR: rDoubleOuter };
      case "SINGLE":
        const rNorm = scoreResult.rNorm;
        if (rNorm > rr.bullOuter && rNorm < rr.tripleInner) {
          return { kind: "wedge", innerR: rBullOuter, outerR: rTripleInner };
        }
        return { kind: "wedge", innerR: rTripleOuter, outerR: rDoubleInner };
      default: return null;
    }
  }

  function setFromScore(scoreResult) {
    clear();
    const radii = radiiForScore(scoreResult);
    if (!radii) return;

    if (radii.kind === "bull") {
      activeMesh = makeBullGlow(radii.innerR, radii.outerR);
    } else {
      const wedgeIndex = scoreResult?.wedgeIndex;
      if (typeof wedgeIndex !== "number") return;
      activeMesh = makeWedgeGlow(radii.innerR, radii.outerR, wedgeIndex);
    }
    boardGroup.add(activeMesh);
  }

  return {
    setFromScore,
    clear,
    dispose: () => { clear(); material.dispose(); }
  };
}