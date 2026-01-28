import * as THREE from "three";

export function createCameraRig(camera, controls, opts = {}) {
  const tmpV0 = new THREE.Vector3();
  const tmpV1 = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpV3 = new THREE.Vector3();
  const tmpShake = new THREE.Vector3();

  let START_CAM_POS =
    opts.startCamPos && opts.startCamPos.isVector3
      ? opts.startCamPos.clone()
      : new THREE.Vector3(-3.69, 6.91, -5.0);

  let ACTION_CAM_POS =
    opts.actionCamPos && opts.actionCamPos.isVector3
      ? opts.actionCamPos.clone()
      : new THREE.Vector3(-10.0, 7.2, -3.5);

  const START_FOV = typeof opts.startFov === "number" ? opts.startFov : 75;
  const ACTION_FOV = typeof opts.actionFov === "number" ? opts.actionFov : 55;

  const RESET_DELAY = typeof opts.resetDelay === "number" ? opts.resetDelay : 2.0;
  const RESET_DURATION = typeof opts.resetDuration === "number" ? opts.resetDuration : 1.0;

  const shakeDecay = typeof opts.shakeDecay === "number" ? opts.shakeDecay : 0.92;
  const shakeFreq = typeof opts.shakeFreq === "number" ? opts.shakeFreq : 14;
  const fovLerp = typeof opts.fovLerp === "number" ? opts.fovLerp : 0.18;

  const cam = {
    basePos: START_CAM_POS.clone(),
    baseFov: START_FOV,
    shakeIntensity: 0,
    shakeDecay,
    shakeFreq,
    postImpactTimer: 0,
    resetting: false,
    resetTimer: 0,
    resetFromPos: START_CAM_POS.clone(),
    resetFromFov: START_FOV,
    resetAfterLogoArmed: false,
  };

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

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

  function setStartCameraPose(pos, fov = START_FOV, dartboard = null) {
    if (pos && pos.isVector3) {
      START_CAM_POS.copy(pos);
      cam.resetFromPos.copy(pos);
      cam.basePos.copy(pos);
    }
    cam.resetFromFov = fov;

    // Derive a board-relative action camera pose
    if (dartboard && dartboard.isObject3D && pos && pos.isVector3) {
      const target = tmpV0.copy(dartboard.position);

      // Forward is from camera to target
      const forward = tmpV1.copy(target).sub(pos).normalize();
      const up = tmpV2.set(0, 1, 0);

      // Right vector
      const right = tmpV3.copy(forward).cross(up).normalize();

      // Estimate a "start distance"
      const startDist = pos.distanceTo(target);

      // Tunables
      const actionDist = Math.max(2.8, startDist * 0.55);
      const actionLeft = 1.8;
      const actionUp = 0.25;

      ACTION_CAM_POS = new THREE.Vector3()
        .copy(target)
        .addScaledVector(forward, -actionDist)
        .addScaledVector(right, -actionLeft)
        .addScaledVector(up, actionUp);
    }
  }

  function onThrowStart() {
    if (controls) controls.enabled = false;
    cam.postImpactTimer = 0;
    cam.resetting = false;
    cam.resetTimer = 0;
  }

  function armResetAfterLogo() {
    cam.resetAfterLogoArmed = true;
  }

  function setResetAfterLogoArmed(armed) {
    cam.resetAfterLogoArmed = !!armed;
  }

  function updateForFlight(easedT) {
    const basePos = tmpV0.copy(START_CAM_POS).lerp(ACTION_CAM_POS, easedT);
    const baseFov = START_FOV + (ACTION_FOV - START_FOV) * easedT;
    return { basePos, baseFov };
  }

  function updateForImpact(delta, logoVisible, gameStarted) {
    let basePos = ACTION_CAM_POS;
    let baseFov = ACTION_FOV;

    if (logoVisible) {
      if (!cam.resetAfterLogoArmed) {
        cam.postImpactTimer = 0;
      }

      cam.resetting = false;
      cam.resetTimer = 0;

      return {
        basePos,
        baseFov,
        resetComplete: false,
        controlsEnabled: false,
      };
    }

    // Logo is gone: allow normal reset behavior
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
      const eased = easeInOutCubic(rt);

      basePos = tmpV1.copy(cam.resetFromPos).lerp(START_CAM_POS, eased);
      baseFov = cam.resetFromFov + (START_FOV - cam.resetFromFov) * eased;

      if (rt >= 1) {
        const controlsEnabled = !gameStarted;
        return { basePos, baseFov, resetComplete: true, controlsEnabled };
      }
    }

    return {
      basePos,
      baseFov,
      resetComplete: false,
      controlsEnabled: false,
    };
  }

  function apply(basePos, baseFov, lookAtVec3) {
    cam.basePos.copy(basePos);
    cam.baseFov = baseFov;

    camera.position.copy(cam.basePos);
    camera.fov += (cam.baseFov - camera.fov) * fovLerp;
    camera.updateProjectionMatrix();

    if (lookAtVec3 && lookAtVec3.isVector3) {
      camera.lookAt(lookAtVec3);
    }

    // IMPORTANT: match your original order
    applyShakeToCamera();
  }

  function dispose() {
    // No geometries/materials to dispose here
  }

  return {
    triggerShake,
    setStartCameraPose,
    onThrowStart,
    armResetAfterLogo,
    setResetAfterLogoArmed,
    updateForFlight,
    updateForImpact,
    apply,
    dispose,
  };
}
