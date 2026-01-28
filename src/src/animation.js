import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { createDailyDartsLogo } from "./logo.js";

export function createActionManager(scene, camera, controls, fireworks, confetti) {
  const activeDarts = [];
  const activePopups = [];

  let START_CAM_POS = new THREE.Vector3(-3.69, 6.91, -5.0);
  // Action camera position is derived from the start camera pose once the board is placed.
  // We keep a default fallback for the original demo scene.
  let ACTION_CAM_POS = new THREE.Vector3(-10.0, 7.2, -3.5);

  const DART_FLIGHT_DURATION = 1.6;
  const RESET_DELAY = 2.0; // seconds
  const RESET_DURATION = 1.0; // seconds

  const COLORS = {
    DART_TRAIL: 0x00ff00,
    TEXT_EMISSIVE: 0x00ffff,
    TEXT_SIDE: 0xffaa00,
    HIGHLIGHT: 0xff00ff,
  };

  // -----------------------------
  // NEW: Floating logo controller
  // -----------------------------
  const logo = createDailyDartsLogo(scene);

  // -----------------------------
  // Start / intro state
  // -----------------------------
  let gameStarted = false;
  let impactLogoEnabled = true;


  // -----------------------------
  // Preload font (LOCAL, no network)
  // -----------------------------
  let gameFont = null;
  const loader = new FontLoader();
  loader.load("/fonts/helvetiker_bold.typeface.json", (f) => {
    gameFont = f;
  });

  // -----------------------------
  // Shared temps (avoid allocations)
  // -----------------------------
  const tmpV0 = new THREE.Vector3();
  const tmpV1 = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpV3 = new THREE.Vector3();
  const tmpShake = new THREE.Vector3();

  // -----------------------------
  // Easing
  // -----------------------------
  const Easing = {
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeOutElastic: (t) => {
      const c4 = (2 * Math.PI) / 3;
      return t === 0
        ? 0
        : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
  };

  // -----------------------------
  // Bezier point (no clones)
  // -----------------------------
  function bezierPointInto(out, p0, p1, p2, p3, t) {
    const invT = 1 - t;
    const invT2 = invT * invT;
    const t2 = t * t;

    out.set(0, 0, 0);
    out.addScaledVector(p0, invT2 * invT);
    out.addScaledVector(p1, 3 * invT2 * t);
    out.addScaledVector(p2, 3 * invT * t2);
    out.addScaledVector(p3, t2 * t);
    return out;
  }

  // -----------------------------
  // Camera state
  // -----------------------------
  const cam = {
    basePos: START_CAM_POS.clone(),
    baseFov: 75,
    shakeIntensity: 0,
    shakeDecay: 0.92,
    shakeFreq: 14,
    postImpactTimer: 0,
    resetting: false,
    resetTimer: 0,
    resetFromPos: START_CAM_POS.clone(),
    resetFromFov: 75,
    resetAfterLogoArmed: false,
  };

  function triggerShake(intensity) {
    cam.shakeIntensity = Math.max(cam.shakeIntensity, intensity);
  }

  function applyShakeToCamera() {
    if (cam.shakeIntensity <= 0.0001) return;

    const time = performance.now() * 0.001;
    const sx = Math.sin(time * cam.shakeFreq * 1.07);
    const sy = Math.cos(time * cam.shakeFreq * 0.93);
    const sz = Math.sin(time * cam.shakeFreq * 1.31);

    tmpShake.set(sx, sy, sz).multiplyScalar(cam.shakeIntensity);

    camera.position.copy(cam.basePos).add(tmpShake);
    cam.shakeIntensity *= cam.shakeDecay;
  }

  // -----------------------------
  // Motion trail
  // -----------------------------
  const motionBlurTrail = new THREE.Group();
  scene.add(motionBlurTrail);

  const sharedTrailGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 8);

  function createMotionTrail(initialPos, color) {
    const trailCount = 6;
    const trailGroup = new THREE.Group();

    const materials = [];
    for (let i = 0; i < trailCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.10 * (1 - i / trailCount),
        depthWrite: false,
      });
      materials.push(mat);

      const seg = new THREE.Mesh(sharedTrailGeom, mat);
      trailGroup.add(seg);
    }

    trailGroup.position.copy(initialPos);
    motionBlurTrail.add(trailGroup);

    const positions = new Array(trailCount);
    for (let i = 0; i < trailCount; i++) positions[i] = initialPos.clone();

    return {
      group: trailGroup,
      index: 0,
      positions,
      update: function (pos, quat) {
        this.positions[this.index].copy(pos);
        this.index = (this.index + 1) % trailCount;

        for (let i = 0; i < trailCount; i++) {
          const posIndex = (this.index + i) % trailCount;
          const seg = this.group.children[i];
          seg.position.copy(this.positions[posIndex]);
          seg.quaternion.copy(quat);
          seg.material.opacity = 0.10 * (1 - i / trailCount);
        }
      },
      dispose: () => {
        motionBlurTrail.remove(trailGroup);
        for (const m of materials) m.dispose();
      },
    };
  }

  // -----------------------------
  // Optional text popup (still available)
  // -----------------------------
  function spawnArcadeText(position) {
    if (!gameFont) return;

    const makeLayer = (color, offsetZ, bevelSize) => {
      const geom = new TextGeometry("DAILY DARTS", {
        font: gameFont,
        size: 0.8,
        height: 0.25,
        curveSegments: 14,
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: bevelSize,
        bevelOffset: 0,
        bevelSegments: 4,
      });
      geom.center();

      const mat = new THREE.MeshPhongMaterial({
        color,
        shininess: 80,
        specular: 0xffffff,
        emissive: color,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 1.0,
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(position).add(tmpV0.set(0, 1.5, offsetZ));
      return mesh;
    };

    const backLayer = makeLayer(0x0000ff, -0.25, 0.05);
    const frontLayer = makeLayer(0xffffff, 0.0, 0.07);
    const highlightLayer = makeLayer(COLORS.HIGHLIGHT, 0.12, 0.03);

    scene.add(backLayer);
    scene.add(frontLayer);
    scene.add(highlightLayer);

    const particleCount = 18;
    const particles = new THREE.Group();
    const particleGeom = new THREE.SphereGeometry(0.045, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({
      color: COLORS.TEXT_EMISSIVE,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });

    for (let i = 0; i < particleCount; i++) {
      const p = new THREE.Mesh(particleGeom, particleMat);
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = 2 + Math.random() * 0.4;
      p.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.random() * 0.4 - 0.2);
      p.userData = {
        angle,
        radius,
        speed: 0.6 + Math.random() * 0.5,
        offset: Math.random() * Math.PI * 0.2,
      };
      particles.add(p);
    }

    particles.position.copy(position).add(tmpV1.set(0, 1.5, 0));
    scene.add(particles);

    activePopups.push({
      layers: [backLayer, frontLayer, highlightLayer],
      particles,
      elapsed: 0,
      duration: 2.2,
      position: position.clone().add(tmpV2.set(0, 1.5, 0)),
      rotationSpeed: Math.random() * 0.5 - 0.25,
    });
  }

  // -----------------------------
  // Main API
  // -----------------------------
  return {
    // -----------------------------
    // Start-screen / intro helpers
    // -----------------------------
    isLogoVisible: () => {
      return !!(logo && logo.group && logo.group.visible);
    },

        setStartCameraPose: (pos, fov = 75, dartboard = null) => {
      // Allows script.js to compute a start camera pose relative to the placed dartboard
      // and feed it into the action manager so camera resets go to the right spot.
      //
      // We also derive an "action camera" pose from this start pose so gameplay/throws
      // keep the same camera style even after the dartboard is moved into the GLB scene.
      if (pos && pos.isVector3) {
        START_CAM_POS.copy(pos);
        cam.resetFromPos.copy(pos);
        cam.basePos.copy(pos);
      }
      cam.resetFromFov = fov;

      // Derive a board-relative action camera pose (closer + slightly to the left)
      // so we don't rely on hard-coded world coordinates.
      if (dartboard && dartboard.isObject3D && pos && pos.isVector3) {
        const target = tmpV0.copy(dartboard.position);

        // Forward is from camera to target
        const forward = tmpV1.copy(target).sub(pos).normalize();
        const up = tmpV2.set(0, 1, 0);

        // Right-handed right vector
        const right = tmpV3.copy(forward).cross(up).normalize();

        // Estimate a "start distance" from the camera to the target
        const startDist = pos.distanceTo(target);

        // Tunable: action distance and offsets (feel like the intro camera)
        const actionDist = Math.max(2.8, startDist * 0.55);
        const actionLeft = 1.8;  // move left (positive value, we subtract along right)
        const actionUp = 0.25;   // slight upward lift

        ACTION_CAM_POS = new THREE.Vector3()
          .copy(target)
          .addScaledVector(forward, -actionDist)
          .addScaledVector(right, -actionLeft)
          .addScaledVector(up, actionUp);
      }
    },

    startGame: () => {
      // Transition from intro -> gameplay.
      // 1) Stop auto-showing the logo on impacts.
      // 2) Fade the logo out.
      // 3) Arm the camera reset so it begins immediately AFTER the logo fully disappears.
      gameStarted = true;
      impactLogoEnabled = false;

      cam.resetAfterLogoArmed = true;
      cam.postImpactTimer = RESET_DELAY;
      cam.resetting = false;
      cam.resetTimer = 0;

      logo.hide(false);
    },

    setImpactLogoEnabled: (enabled) => {
      impactLogoEnabled = !!enabled;
    },

    isBusy: () => {
      // True when a dart is mid-flight or still resolving (impact/wobble/reset).
      return activeDarts.some((d) => d.userData && (d.userData.isFlying || d.userData.impactDone === false));
    },

    throw: (dart, dartboard, offset, targetWorld = null) => {
      if (activeDarts.some((d) => d.userData && d.userData.isFlying)) return;

      // Hide logo as soon as a new throw begins
      logo.hide(true);

            const boardForward = tmpV0.set(0, 0, 1).applyQuaternion(dartboard.quaternion);

      // If a targetWorld is provided (gameplay aiming), use it.
      // Otherwise fall back to aiming at the center of the board with the given offset.
      const targetPos = targetWorld && targetWorld.isVector3
        ? tmpV1.copy(targetWorld)
        : tmpV1.copy(dartboard.position).addScaledVector(boardForward, offset);

      const startPos = tmpV2.copy(targetPos).addScaledVector(boardForward, 15);

      const midPoint = tmpV3.copy(startPos).add(targetPos).multiplyScalar(0.5);

      const controlPos1 = midPoint.clone().add(new THREE.Vector3(0, 3.5, 0));
      const controlPos2 = midPoint.clone().add(new THREE.Vector3(0, 1.5, -0.5));

      dart.position.copy(startPos);
      controls.enabled = false;

      const motionTrail = createMotionTrail(startPos, COLORS.DART_TRAIL);

      dart.userData = {
        p0: startPos.clone(),
        p1: controlPos1,
        p2: controlPos2,
        p3: targetPos.clone(),
        boardQuat: dartboard.quaternion.clone(),
        elapsed: 0,
        isFlying: true,
        isWobbling: false,
        wobbleTime: 0,
        motionTrail,
        rotationSpeed: 18 + Math.random() * 6,
        impactDone: false,
        logoShown: false,
      };

      scene.add(dart);
      activeDarts.push(dart);

      triggerShake(0.12);

      cam.postImpactTimer = 0;
      cam.resetting = false;
      cam.resetTimer = 0;
    },

    update: (delta, dartboard) => {
      delta = Math.min(Math.max(delta, 0), 1 / 30);

      // Always update logo (it billboards in front of camera)
      logo.update(delta, camera);

      // --- POPUP TEXT ---
      for (let i = activePopups.length - 1; i >= 0; i--) {
        const p = activePopups[i];
        p.elapsed += delta;

        const t = Math.min(p.elapsed / p.duration, 1);
        const entranceScale = Easing.easeOutElastic(Math.min(1, t * 0.8)) * 1.10;
        const fadeOut = Math.max(0, 1 - Math.max(0, t - 0.72) * 3.2);

        p.layers.forEach((layer, idx) => {
          const scale = entranceScale * (0.92 + idx * 0.05);
          layer.scale.setScalar(scale);
          layer.position.y = p.position.y + Math.sin(p.elapsed * 2 + idx) * 0.08;
          layer.rotation.y = p.elapsed * p.rotationSpeed;

          layer.material.opacity = fadeOut * (1 - idx * 0.18);

          const pulse = Math.sin(p.elapsed * 5 + idx) * 0.5 + 0.5;
          layer.material.emissiveIntensity = 0.25 + pulse * 0.6;
        });

        p.particles.children.forEach((particle) => {
          particle.userData.angle += delta * particle.userData.speed;
          particle.position.x = Math.cos(particle.userData.angle + p.elapsed) * particle.userData.radius;
          particle.position.y = Math.sin(particle.userData.angle + p.elapsed) * particle.userData.radius;
          particle.position.z = Math.sin(p.elapsed * 2 + particle.userData.offset) * 0.25;

          const particleT = Math.min(p.elapsed / p.duration, 1);
          particle.material.opacity = 0.8 * (1 - particleT);
        });

        if (t >= 1) {
          p.layers.forEach((layer) => {
            scene.remove(layer);
            layer.geometry.dispose();
            layer.material.dispose();
          });
          scene.remove(p.particles);

          if (p.particles.children.length > 0) {
            const m0 = p.particles.children[0].material;
            const g0 = p.particles.children[0].geometry;
            m0.dispose();
            g0.dispose();
          }

          activePopups.splice(i, 1);
        }
      }

      // --- DART LOGIC ---
      for (let i = activeDarts.length - 1; i >= 0; i--) {
        const dart = activeDarts[i];
        if (!dart.userData) continue;

        let basePos = cam.basePos;
        let baseFov = cam.baseFov;

        if (dart.userData.isFlying) {
          dart.userData.elapsed += delta;
          const t = Math.min(dart.userData.elapsed / DART_FLIGHT_DURATION, 1);
          const easedT = Easing.easeInOutCubic(t);

          const currentPos = bezierPointInto(
            tmpV0,
            dart.userData.p0,
            dart.userData.p1,
            dart.userData.p2,
            dart.userData.p3,
            easedT
          );

          dart.position.copy(currentPos);

          const lookAheadT = Math.min(1, easedT + delta / DART_FLIGHT_DURATION);
          const nextPos = bezierPointInto(
            tmpV1,
            dart.userData.p0,
            dart.userData.p1,
            dart.userData.p2,
            dart.userData.p3,
            lookAheadT
          );

          dart.lookAt(nextPos);
          dart.rotateZ(delta * dart.userData.rotationSpeed);
          dart.rotateX(Math.sin(dart.userData.elapsed * 10) * 0.06);

          dart.userData.motionTrail.update(dart.position, dart.quaternion);

          basePos = tmpV2.copy(START_CAM_POS).lerp(ACTION_CAM_POS, easedT);
          baseFov = 75 + (55 - 75) * easedT;

          if (easedT >= 1) {
            dart.userData.isFlying = false;
            dart.userData.isWobbling = true;
            dart.userData.wobbleTime = 0;

            dart.position.copy(dart.userData.p3);
            dart.quaternion.copy(dart.userData.boardQuat);
            dart.rotateY(Math.PI);
            dart.rotateX(Math.PI / 2);

            dart.userData.motionTrail.dispose();

            // Fireworks + confetti first
            fireworks.burst(dart.userData.p3, {
              count: 180,
              speed: 14,
              colors: [COLORS.HIGHLIGHT, COLORS.TEXT_EMISSIVE, COLORS.DART_TRAIL],
            });

            confetti.burst(dart.userData.p3, {
              count: 260,
              shapes: ["circle", "rect", "star"],
              colors: [0xff0000, 0x00ff00, 0x0000ff, COLORS.HIGHLIGHT],
            });

            triggerShake(0.55);

            // Optional: keep the 3D text popup, OR remove this line if you want only the chalkboard sign
            // spawnArcadeText(dart.userData.p3);

            if (dartboard.onHit) dartboard.onHit();

            // NOW: reveal the floating chalkboard logo (in front of camera)
            if (impactLogoEnabled && !dart.userData.logoShown) {
              dart.userData.logoShown = true;
              logo.show({ holdForever: !gameStarted });
            }

            cam.postImpactTimer = 0;
            cam.resetting = false;
            cam.resetTimer = 0;
          }
        }

        // Wobble
        if (dart.userData.isWobbling) {
          dart.userData.wobbleTime += delta;
          const decay = Math.exp(-dart.userData.wobbleTime * 6);
          const freq = 25;
          const amp = 0.2;

          const offset1 = Math.sin(dart.userData.wobbleTime * freq) * amp * decay;
          const offset2 = Math.sin(dart.userData.wobbleTime * freq * 1.7) * amp * decay * 0.5;

          dart.quaternion.copy(dart.userData.boardQuat);
          dart.rotateY(Math.PI);
          dart.rotateZ((offset1 + offset2) * 0.3);
          dart.rotateX(Math.sin(dart.userData.wobbleTime * 8) * 0.05 * decay);

          const posWobble = Math.sin(dart.userData.wobbleTime * 15) * 0.02 * decay;
          dart.position.z += posWobble;

          if (decay < 0.01) {
            dart.userData.isWobbling = false;
          }
        }

        // Camera hold then reset
        if (!dart.userData.isFlying && (dart.userData.isWobbling || dart.userData.impactDone === false)) {
          basePos = ACTION_CAM_POS;
          baseFov = 55;

          const logoActive = !!(logo && logo.group && logo.group.visible);

          if (logoActive) {
            // While the logo is on screen, keep the camera perfectly locked.
            // If start has NOT been pressed yet, also keep the reset timer pinned to 0 so
            // the camera can't begin resetting behind the logo.
            if (!cam.resetAfterLogoArmed) {
              cam.postImpactTimer = 0;
            }

            cam.resetting = false;
            cam.resetTimer = 0;
          } else {
            // Logo is gone: allow the normal reset behavior
            cam.resetAfterLogoArmed = false;

            cam.postImpactTimer += delta;

            if (cam.postImpactTimer >= RESET_DELAY && !cam.resetting) {
              cam.resetting = true;
              cam.resetTimer = 0;
              cam.resetFromPos.copy(camera.position);
              cam.resetFromFov = camera.fov;
            }

            if (cam.resetting) {
              cam.resetTimer += delta;
              const rt = Math.min(cam.resetTimer / RESET_DURATION, 1);
              const eased = Easing.easeInOutCubic(rt);

              basePos = tmpV3.copy(cam.resetFromPos).lerp(START_CAM_POS, eased);
              baseFov = cam.resetFromFov + (75 - cam.resetFromFov) * eased;

              if (rt >= 1) {
                // In gameplay mode we keep OrbitControls disabled so the camera stays locked.
                // (Input + aim logic is handled in script.js instead.)
                controls.enabled = !gameStarted;
                dart.userData.impactDone = true;

                if (dart.parent) scene.remove(dart);
                activeDarts.splice(i, 1);
              }
            }
          }
        }

// Apply camera
        cam.basePos.copy(basePos);
        cam.baseFov = baseFov;

        camera.position.copy(cam.basePos);
        camera.fov += (cam.baseFov - camera.fov) * 0.18;
        camera.updateProjectionMatrix();

        if (dart.userData && dart.userData.isFlying) {
          camera.lookAt(dart.position);
        } else {
          camera.lookAt(dartboard.position);
        }

        applyShakeToCamera();
      }
    },

    dispose: () => {
      logo.dispose();

      activeDarts.forEach((dart) => {
        if (dart.userData && dart.userData.motionTrail) dart.userData.motionTrail.dispose();
        if (dart.parent) scene.remove(dart);
      });
      activeDarts.length = 0;

      activePopups.forEach((p) => {
        p.layers.forEach((layer) => {
          scene.remove(layer);
          layer.geometry.dispose();
          layer.material.dispose();
        });
        scene.remove(p.particles);
      });
      activePopups.length = 0;

      while (motionBlurTrail.children.length > 0) {
        const child = motionBlurTrail.children[0];
        motionBlurTrail.remove(child);
      }
    },
  };
}
