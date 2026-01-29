import * as THREE from "three";
import { createDailyDartsLogo } from "../logo.js";
import { createCameraRig } from "./cameraRig.js";
import { createMotionTrailSystem } from "./motionTrail.js";
import { createArcadeTextSystem } from "./arcadeText.js";

export function createActionManager(scene, camera, controls, fireworks, confetti) {
  const activeDarts = [];

  const DART_FLIGHT_DURATION = 1.6;
  const RESET_DELAY = 2.0;
  const RESET_DURATION = 1.0;

  const COLORS = {
    DART_TRAIL: 0x00ff00,
    TEXT_EMISSIVE: 0x00ffff,
    TEXT_SIDE: 0xffaa00,
    HIGHLIGHT: 0xff00ff,
  };

  // Logo controller
  const logo = createDailyDartsLogo(scene);

  // Start / intro state
  let gameStarted = false;
  let impactLogoEnabled = true;

  // Callback fired once, after a dart is snapped into its final "stuck" pose.
  // Use this to trigger result-only FX (e.g., hitGlow) after the impact position is finalized.
  let onDartLanded = null;

  // Systems
  const trails = createMotionTrailSystem(scene);
  const textPopups = createArcadeTextSystem(scene, {
    textEmissive: COLORS.TEXT_EMISSIVE,
    highlight: COLORS.HIGHLIGHT,
  });

  const cameraRig = createCameraRig(camera, controls, {
    startCamPos: new THREE.Vector3(-3.69, 6.91, -5.0),
    actionCamPos: new THREE.Vector3(-10.0, 7.2, -3.5),
    startFov: 75,
    actionFov: 55,
    resetDelay: RESET_DELAY,
    resetDuration: RESET_DURATION,
    shakeDecay: 0.92,
    shakeFreq: 14,
    fovLerp: 0.18,
  });

  // Temps (avoid allocations)
  const tmpV0 = new THREE.Vector3();
  const tmpV1 = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpV3 = new THREE.Vector3();

  // Easing (kept local)
  const Easing = {
    easeInOutCubic: (t) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  };

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

  return {
    // Intro helpers
    isLogoVisible: () => {
      return !!(logo && logo.group && logo.group.visible);
    },

    setStartCameraPose: (pos, fov = 75, dartboard = null) => {
      cameraRig.setStartCameraPose(pos, fov, dartboard);
    },

    startGame: () => {
      gameStarted = true;
      impactLogoEnabled = false;

      // Mirror your original behavior: arm reset after logo disappears
      cameraRig.setResetAfterLogoArmed(true);

      // Hide the logo (not a “hard reset”)
      logo.hide(false);
    },

    setImpactLogoEnabled: (enabled) => {
      impactLogoEnabled = !!enabled;
    },

    showLogo: (opts) => {
      if (logo && typeof logo.show === "function") {
        logo.show(opts);
      }
    },

    setLogoMode: (mode) => {
      if (logo && typeof logo.setMode === "function") {
        logo.setMode(mode);
      }
    },

    setLeaderboardData: (data) => {
      if (logo && typeof logo.setLeaderboardData === "function") {
        logo.setLeaderboardData(data);
      }
    },

    showLeaderboard: (data) => {
      if (logo && typeof logo.setLeaderboardData === "function") {
        logo.setLeaderboardData(data);
      }
      if (logo && typeof logo.show === "function") {
        logo.show({ holdForever: true });
      }
    },

    setOnDartLanded: (fn) => {
      onDartLanded = typeof fn === "function" ? fn : null;
    },

    isBusy: () => {
      return activeDarts.some(
        (d) =>
          d.userData &&
          (d.userData.isFlying || d.userData.impactDone === false)
      );
    },

    throw: (dart, dartboard, offset, targetWorld = null) => {
      if (activeDarts.some((d) => d.userData && d.userData.isFlying)) return;

      // Hide logo as soon as a new throw begins
      logo.hide(true);

      // Compute board forward in world space
      const boardForward = tmpV0.set(0, 0, 1).applyQuaternion(dartboard.quaternion);

      // Determine target
      const targetPos =
        targetWorld && targetWorld.isVector3
          ? tmpV1.copy(targetWorld)
          : tmpV1.copy(dartboard.position).addScaledVector(boardForward, offset);

      const startPos = tmpV2.copy(targetPos).addScaledVector(boardForward, 15);

      const midPoint = tmpV3.copy(startPos).add(targetPos).multiplyScalar(0.5);

      const controlPos1 = midPoint.clone().add(new THREE.Vector3(0, 3.5, 0));
      const controlPos2 = midPoint.clone().add(new THREE.Vector3(0, 1.5, -0.5));

      dart.position.copy(startPos);

      // Camera / controls
      cameraRig.onThrowStart();
      if (controls) controls.enabled = false;

      const motionTrail = trails.createMotionTrail(startPos, COLORS.DART_TRAIL);

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
        landedEventFired: false,
      };

      scene.add(dart);
      activeDarts.push(dart);

      cameraRig.triggerShake(0.12);
    },

    update: (delta, dartboard) => {
      delta = Math.min(Math.max(delta, 0), 1 / 30);

      // Always update logo (billboards in front of camera)
      logo.update(delta, camera);

      // Optional popup text system update
      textPopups.update(delta);

      // Dart loop (typically max 1 dart)
      for (let i = activeDarts.length - 1; i >= 0; i--) {
        const dart = activeDarts[i];
        if (!dart.userData) continue;

        let basePos = null;
        let baseFov = null;

        // FLIGHT
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

          const flightCam = cameraRig.updateForFlight(easedT);
          basePos = flightCam.basePos;
          baseFov = flightCam.baseFov;

          if (easedT >= 1) {
            dart.userData.isFlying = false;
            dart.userData.isWobbling = true;
            dart.userData.wobbleTime = 0;

            dart.position.copy(dart.userData.p3);
            dart.quaternion.copy(dart.userData.boardQuat);
            dart.rotateY(Math.PI);
            dart.rotateX(Math.PI / 2);

            // Fire landing callback exactly once per dart, after we snap into the final landed pose.
            if (!dart.userData.landedEventFired) {
              dart.userData.landedEventFired = true;

              if (onDartLanded) {
                try {
                  onDartLanded({
                    dart,
                    dartboard,
                    impactWorld: dart.userData.p3.clone(),
                  });
                } catch (err) {
                  console.warn("onDartLanded callback failed", err);
                }
              }
            }

            dart.userData.motionTrail.dispose();

            // Fireworks + confetti
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

            cameraRig.triggerShake(0.55);

            // Optional: 3D popup text (comment/uncomment as desired)
            // textPopups.spawnArcadeText(dart.userData.p3);

            if (dartboard.onHit) dartboard.onHit();

            // Reveal chalkboard logo
            if (impactLogoEnabled && !dart.userData.logoShown) {
              dart.userData.logoShown = true;
              logo.show({ holdForever: !gameStarted });
            }
          }
        }

        // WOBBLE
        if (dart.userData.isWobbling) {
          dart.userData.wobbleTime += delta;
          const decay = Math.exp(-dart.userData.wobbleTime * 6);
          const freq = 25;
          const amp = 0.2;

          const offset1 = Math.sin(dart.userData.wobbleTime * freq) * amp * decay;
          const offset2 =
            Math.sin(dart.userData.wobbleTime * freq * 1.7) * amp * decay * 0.5;

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

        // IMPACT HOLD + RESET
        if (!dart.userData.isFlying && (dart.userData.isWobbling || dart.userData.impactDone === false)) {
          const logoActive = !!(logo && logo.group && logo.group.visible);

          const impactCam = cameraRig.updateForImpact(delta, logoActive, gameStarted);
          basePos = impactCam.basePos;
          baseFov = impactCam.baseFov;

          if (impactCam.resetComplete) {
            if (controls) controls.enabled = impactCam.controlsEnabled;
            dart.userData.impactDone = true;

            if (dart.parent) scene.remove(dart);
            activeDarts.splice(i, 1);
          }
        }

        // Apply camera each frame
        if (basePos && typeof baseFov === "number") {
          if (dart.userData && dart.userData.isFlying) {
            cameraRig.apply(basePos, baseFov, dart.position);
          } else {
            cameraRig.apply(basePos, baseFov, dartboard.position);
          }
        }
      }
    },

    dispose: () => {
      logo.dispose();

      for (let i = activeDarts.length - 1; i >= 0; i--) {
        const dart = activeDarts[i];
        if (dart.userData && dart.userData.motionTrail) {
          dart.userData.motionTrail.dispose();
        }
        if (dart.parent) scene.remove(dart);
      }
      activeDarts.length = 0;

      textPopups.dispose();
      trails.dispose();
      cameraRig.dispose();
    },
  };
}
