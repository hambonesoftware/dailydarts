import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { context } from "@devvit/web/client";

import { createDartboard } from "./board.js";
import { createDart } from "./dart.js";
import { createActionManager } from "./animation.js";

import { scoreFromBoardXY, formatHitForHud } from "./scoring.js";
import { createRoundHud } from "./hud.js";

import { createHitGlow } from "./hitGlow.js";

import { computeStartCameraPose, createAimDisc } from "./script_helpers.js";
import { getQualitySettings } from "./perf/quality.js";
import { GLB_URL, preloadCriticalAssets } from "./preload.js";

const WALL_ANCHOR_NAME = "Object_7";

const DART_TARGET_OFFSET = 0.28;
const AIM_DISC_Z = DART_TARGET_OFFSET + 0.06;

const MAX_DARTS_PER_ROUND = 10;
const LEADERBOARD_LIMIT = 5;
const MAX_SHARE_IMAGE_DATA_URL_LENGTH = 1_500_000;

declare global {
  interface Window {
    __DD_START_GAME__?: () => void;
  }
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function getStageSize(container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  return {
    width: Math.max(rect.width, 1),
    height: Math.max(rect.height, 1),
  };
}

type LoadingProgress = {
  loaded: number;
  total?: number;
  percent?: number;
  message?: string;
};

type LoadingCallbacks = {
  onLoadingProgress?: (progress: LoadingProgress) => void;
  onLoadingDone?: () => void;
};

export function mountGame(
  container: HTMLElement,
  { onLoadingProgress, onLoadingDone }: LoadingCallbacks = {}
): { dispose(): void } {
  const quality = getQualitySettings();

  function createLazyEffects(sceneRef: THREE.Scene) {
    let fireworksSystem: any = null;
    let confettiSystem: any = null;
    let loading: Promise<any> | null = null;

    const loadEffects = () => {
      if (loading) return loading;

      loading = Promise.all([
        import("./fireworks.js"),
        import("./confetti.js"),
      ]).then(([fireworksModule, confettiModule]) => {
        fireworksSystem = fireworksModule.createFireworksSystem(sceneRef);
        confettiSystem = confettiModule.createConfettiSystem(sceneRef);
        return { fireworksSystem, confettiSystem };
      });

      return loading;
    };

    const fireworks = {
      burst: (position: any, options: any = {}) => {
        if (fireworksSystem) {
          fireworksSystem.burst(position, options);
          return;
        }
        void loadEffects().then(({ fireworksSystem: system }) => {
          system.burst(position, options);
        });
      },
      update: (dt: number) => {
        if (fireworksSystem) fireworksSystem.update(dt);
      },
      hasActiveBursts: () => (fireworksSystem ? fireworksSystem.hasActiveBursts() : false),
    };

    const confetti = {
      burst: (position: any, options: any = {}) => {
        if (confettiSystem) {
          confettiSystem.burst(position, options);
          return;
        }
        void loadEffects().then(({ confettiSystem: system }) => {
          system.burst(position, options);
        });
      },
      update: (dt: number) => {
        if (confettiSystem) confettiSystem.update(dt);
      },
      hasActiveBursts: () => (confettiSystem ? confettiSystem.hasActiveBursts() : false),
    };

    return {
      fireworks,
      confetti,
      update: (dt: number) => {
        fireworks.update(dt);
        confetti.update(dt);
      },
      hasActive: () =>
        fireworks.hasActiveBursts() || confetti.hasActiveBursts(),
      ensureLoaded: loadEffects,
    };
  }

  const scene = new THREE.Scene();
  const stageSize = getStageSize(container);
  const camera = new THREE.PerspectiveCamera(
    75,
    stageSize.width / stageSize.height,
    0.05,
    1000
  );
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(stageSize.width, stageSize.height);
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality.shadowsEnabled;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  container.appendChild(renderer.domElement);

  renderer.domElement.style.touchAction = "none";

  scene.add(new THREE.AmbientLight(0xffffff, 2.2));

  const controls = new OrbitControls(camera, renderer.domElement);

  const effects = createLazyEffects(scene);
  const actionManager: any = createActionManager(
    scene,
    camera,
    controls,
    effects.fireworks,
    effects.confetti,
    { particleScale: quality.particleScale }
  );

  let gameStarted = false;

  let startPose: any = null;
  const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;
  const perfTimings = {
    start: performance.now(),
    firstRender: null as number | null,
    firstThrow: null as number | null,
  };
  let boardSynced = false;
  let loadingDone = false;
  let criticalAssetsReady = false;
  let preloadedEnvironment: any | null = null;

  function maybeFinishLoading() {
    if (loadingDone) return;
    if (!boardSynced) return;
    if (!perfTimings.firstRender) return;
    if (!criticalAssetsReady) return;
    loadingDone = true;
    onLoadingDone?.();
  }

  function logPerf(label: string, timeMs: number) {
    if (!isDev) return;
    console.log(`[perf] ${label}: ${Math.round(timeMs)}ms`);
  }

  let requestRender: () => void = () => {};

  const roundHud = createRoundHud({
    maxDarts: MAX_DARTS_PER_ROUND,
    injectStyles: true,
  });

  roundHud.setVisible(false);
  roundHud.setState({ dartsThrown: 0, totalScore: 0, lastText: "—" });

  let roundActive = false;
  let dartsThrown = 0;
  let totalScore = 0;
  let dartScores: number[] = [];
  let boardReadyForGameplay = false;
  let roundEndShareImageUrl = "";
  let pendingRoundEnd = false;

  function resetRound() {
    dartsThrown = 0;
    totalScore = 0;
    dartScores = [];
    roundActive = true;
    roundEndShareImageUrl = "";
    pendingRoundEnd = false;

    if (typeof actionManager.setLogoMode === "function") {
      actionManager.setLogoMode("logo");
    }

    roundHud.setVisible(true);
    roundHud.setState({
      dartsThrown,
      totalScore,
      lastText: "—",
    });

    requestRender();
  }

  function endRound() {
    roundActive = false;

    if (aimDisc) {
      aimDisc.setEnabled(false);
      aimDisc.cancelHold();
    }

    roundHud.showToast("Round complete!");
    roundEndShareImageUrl = generateShareCardDataUrl(totalScore);
    roundHud.showRoundEnd({
      totalScore,
      shareImageUrl: roundEndShareImageUrl,
      username: getPlayerIdentity().username,
      postId: safePostId(),
    });

    void finalizeRoundLeaderboard();

    requestRender();
  }

  roundHud.setOnPlayAgain(() => {
    resetRound();
  });

  roundHud.setOnPostToComments(async (payload: any) => {
    if (!payload || !payload.imageDataUrl) {
      roundHud.showToast("No preview ready yet.");
      return;
    }
    if (payload.imageDataUrl.length > MAX_SHARE_IMAGE_DATA_URL_LENGTH) {
      roundHud.showToast("Share image is still too large. Try again in a moment.");
      return;
    }

    try {
      roundHud.setPostToCommentsEnabled(false, "Posting...");
      const response = await fetch("/api/share/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: payload.score ?? totalScore,
          username: payload.username ?? getPlayerIdentity().username,
          postId: payload.postId ?? safePostId(),
          imageDataUrl: payload.imageDataUrl,
        }),
      });

      let responseBody: any = null;
      try {
        responseBody = await response.json();
      } catch (jsonError) {
        console.warn("Failed to parse share comment response", jsonError);
      }

      if (!response.ok) {
        const stage = responseBody && typeof responseBody === "object" ? responseBody.stage : undefined;
        const message =
          responseBody && typeof responseBody.message === "string" ? responseBody.message.trim() : "";

        let toastMessage = "Post failed.";
        if (message) {
          toastMessage = message;
        } else if (stage === "upload") {
          toastMessage = "Upload failed.";
        } else if (stage === "comment") {
          toastMessage = "Comment failed.";
        }

        roundHud.setPostToCommentsEnabled(true);
        roundHud.showToast(toastMessage);
        return;
      }

      if (responseBody && typeof responseBody === "object" && responseBody.ok === false) {
        const message =
          typeof responseBody.message === "string" && responseBody.message.trim()
            ? responseBody.message.trim()
            : "Comment posted, but image embed was stripped by subreddit/client settings.";
        roundHud.setPostToCommentsEnabled(false, "Posted!");
        roundHud.showToast(message);
        return;
      }

      if (responseBody && typeof responseBody === "object") {
        const message =
          typeof responseBody.message === "string" && responseBody.message.trim()
            ? responseBody.message.trim()
            : "";
        if (message) {
          roundHud.setPostToCommentsEnabled(false, "Posted!");
          roundHud.showToast(message);
          return;
        }
      }

      roundHud.setPostToCommentsEnabled(false, "Posted!");
      roundHud.showToast("Posted to comments!");
    } catch (error) {
      console.warn("Failed to post round summary", error);
      roundHud.setPostToCommentsEnabled(true);
      roundHud.showToast("Post failed.");
    }
  });

  function getPlayerIdentity() {
    const username =
      (context && typeof context.username === "string" && context.username) ||
      "anonymous";
    const userId =
      (context && typeof context.userId === "string" && context.userId) || username;
    return { username, userId };
  }

  function safePostId() {
    const anyCtx = context as any;
    return anyCtx?.postId ?? anyCtx?.post?.id ?? anyCtx?.post?.name ?? undefined;
  }

  function buildShareCardData(score: number) {
    const { username } = getPlayerIdentity();
    return {
      score,
      darts: dartScores.slice(0, MAX_DARTS_PER_ROUND),
      username,
      date: new Date().toISOString(),
    };
  }

  function generateShareCardDataUrl(score: number) {
    if (typeof actionManager.getShareCardDataUrl !== "function") return "";
    return actionManager.getShareCardDataUrl(buildShareCardData(score));
  }

  async function submitRoundScore(score: number) {
    const { userId, username } = getPlayerIdentity();

    const response = await fetch("/api/leaderboard/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        score,
        limit: LEADERBOARD_LIMIT,
        metadata: { username },
      }),
    });

    if (!response.ok) {
      throw new Error(`Leaderboard submit failed: ${response.status}`);
    }

    return response.json();
  }

  async function fetchLeaderboard() {
    const { userId } = getPlayerIdentity();

    const response = await fetch("/api/leaderboard/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        limit: LEADERBOARD_LIMIT,
      }),
    });

    if (!response.ok) {
      throw new Error(`Leaderboard fetch failed: ${response.status}`);
    }

    return response.json();
  }

  async function finalizeRoundLeaderboard() {
    try {
      await submitRoundScore(totalScore);
    } catch (error) {
      console.warn("Failed to submit leaderboard score", error);
    }

    try {
      const leaderboard = await fetchLeaderboard();
      if (leaderboard && leaderboard.type === "leaderboard-fetch") {
        const payload = buildLeaderboardPayload(leaderboard, { includeScore: true });

        if (typeof actionManager.showLeaderboard === "function") {
          actionManager.showLeaderboard(payload);
          requestRender();
        }

        roundHud.showRoundEnd({
          totalScore,
          leaderboard: payload,
          shareImageUrl: roundEndShareImageUrl,
          username: payload.username,
          postId: safePostId(),
        });
      }
    } catch (error) {
      console.warn("Failed to fetch leaderboard", error);
    }
  }

  function buildLeaderboardPayload(
    leaderboard: any,
    { includeScore = false }: { includeScore?: boolean } = {}
  ) {
    const { username } = getPlayerIdentity();
    const payload: any = {
      rank: leaderboard.callerRank,
      top: leaderboard.top,
      username,
    };

    if (includeScore) {
      payload.score = totalScore;
    }

    return payload;
  }

  async function showIntroLeaderboard() {
    try {
      const leaderboard = await fetchLeaderboard();
      if (leaderboard && leaderboard.type === "leaderboard-fetch") {
        const payload = buildLeaderboardPayload(leaderboard);

        if (typeof actionManager.showLeaderboard === "function") {
          actionManager.showLeaderboard(payload);
          requestRender();
        } else if (
          typeof actionManager.setLeaderboardData === "function" &&
          typeof actionManager.showLogo === "function"
        ) {
          actionManager.setLeaderboardData(payload);
          actionManager.showLogo({ holdForever: true });
          requestRender();
        }
      }
    } catch (error) {
      console.warn("Failed to fetch intro leaderboard", error);
    }
  }

  const dartboard: any = createDartboard({
    includeWall: true,
    showNumbers: true,
    numbersDelayMs: quality.numbersDelayMs,
  });
  dartboard.visible = false;
  scene.add(dartboard);

  let aimDisc: any = null;

  let hitGlow: any = null;
  let pendingHitGlow: any = null;

  if (typeof actionManager.setOnDartLanded === "function") {
    actionManager.setOnDartLanded(() => {
      if (pendingHitGlow && hitGlow) {
        try {
          hitGlow.setFromScore(pendingHitGlow);
        } catch (err) {
          console.warn("hitGlow.setFromScore failed", err);
        } finally {
          pendingHitGlow = null;
        }
      }
    });
  }

  if (typeof actionManager.setOnDartReset === "function") {
    actionManager.setOnDartReset(() => {
      if (pendingRoundEnd && roundActive) {
        pendingRoundEnd = false;
        endRound();
      }
    });
  }

  let isHoldingAim = false;
  let holdPointerId: number | null = null;

  function throwDartAtBoardLocalXY(x: number, y: number) {
    const localTarget = new THREE.Vector3(x, y, DART_TARGET_OFFSET);
    const worldTarget = localTarget.clone();
    dartboard.localToWorld(worldTarget);

    const dart = createDart();
    actionManager.throw(dart, dartboard, DART_TARGET_OFFSET, worldTarget);
  }

  function scoreHitAtBoardLocalXY(hitX: number, hitY: number) {
    if (!dartboard || !dartboard.userData) {
      return { points: 0, label: "MISS" };
    }

    const boardRadius = dartboard.userData.boardRadius;
    const baseScoring = dartboard.userData.scoring;

    if (!baseScoring) {
      return { points: 0, label: "MISS" };
    }

    const scoringConfig = {
      ...baseScoring,
      boardRadius: boardRadius,
    };

    return scoreFromBoardXY(hitX, hitY, scoringConfig);
  }

  function registerThrowScore(scoreResult: any) {
    const pts = typeof scoreResult?.points === "number" ? scoreResult.points : 0;
    const lbl = typeof scoreResult?.label === "string" ? scoreResult.label : "MISS";

    dartsThrown += 1;
    totalScore += pts;
    if (dartScores.length < MAX_DARTS_PER_ROUND) {
      dartScores.push(pts);
    }

    const lastText = formatHitForHud(scoreResult);

    roundHud.setState({
      dartsThrown,
      totalScore,
      lastText,
    });

    if (dartboard && dartboard.userData) {
      const nums = dartboard?.userData?.scoring?.numbers;
      const wedgeVal =
        typeof scoreResult?.wedge === "number" ? scoreResult.wedge : null;

      let wedgeIndex = null;
      if (wedgeVal !== null && Array.isArray(nums)) {
        const idx = nums.indexOf(wedgeVal);
        wedgeIndex = idx >= 0 ? idx : null;
      }

      const br = dartboard?.userData?.boardRadius;
      let rNorm = undefined;
      if (
        typeof scoreResult?.radius === "number" &&
        typeof br === "number" &&
        br > 0
      ) {
        rNorm = scoreResult.radius / br;
      }

      pendingHitGlow = {
        ...scoreResult,
        wedgeIndex,
        rNorm,
      };
    }

    roundHud.flashScore();

    roundHud.showToast(lastText);

    if (dartsThrown >= MAX_DARTS_PER_ROUND) {
      pendingRoundEnd = true;
    }
  }

  function onAimPointerDown(ev: PointerEvent) {
    requestRender();
    if (!gameStarted) return;
    if (!roundActive) return;
    if (!aimDisc) return;
    if (actionManager.isBusy && actionManager.isBusy()) return;
    if (isHoldingAim) return;

    if (hitGlow) {
      try {
        hitGlow.clear();
      } catch (err) {
        console.warn("hitGlow.clear failed", err);
      }
    }

    pendingHitGlow = null;

    ev.preventDefault?.();

    isHoldingAim = true;
    holdPointerId = ev.pointerId;

    try {
      renderer.domElement.setPointerCapture(ev.pointerId);
    } catch (e) {
      // Ignore if not supported
    }

    aimDisc.beginHold();
  }

  function onAimPointerUp(ev: PointerEvent) {
    requestRender();
    if (!gameStarted) return;
    if (!roundActive) return;
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

    if (actionManager.isBusy && actionManager.isBusy()) {
      aimDisc.cancelHold();
      return;
    }

    const shot = aimDisc.releaseAndSampleHit();

    aimDisc.setEnabled(false);

    const scoreResult = scoreHitAtBoardLocalXY(shot.hitX, shot.hitY);
    registerThrowScore(scoreResult);

    throwDartAtBoardLocalXY(shot.hitX, shot.hitY);

    if (!perfTimings.firstThrow) {
      perfTimings.firstThrow = performance.now();
      logPerf("time-to-first-throw", perfTimings.firstThrow - perfTimings.start);
    }
  }

  function onAimPointerCancel(ev: PointerEvent) {
    requestRender();
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

  renderer.domElement.addEventListener("pointerdown", onAimPointerDown);
  renderer.domElement.addEventListener("pointerup", onAimPointerUp);
  renderer.domElement.addEventListener("pointercancel", onAimPointerCancel);
  renderer.domElement.addEventListener("pointerleave", onAimPointerCancel);

  const startGameplay = () => {
    if (gameStarted) return;

    gameStarted = true;

    actionManager.startGame();

    if (startPose) {
      camera.position.copy(startPose.position);
      camera.lookAt(startPose.target);
      controls.target.copy(startPose.target);
      controls.update();
    }

    controls.enabled = false;

    resetRound();

    if (aimDisc) {
      aimDisc.setEnabled(true);
    }

    requestRender();
  };

  window.__DD_START_GAME__ = startGameplay;

  const maybeStartGameplay = () => {
    if (gameStarted) return;
    if (!boardReadyForGameplay) return;
    if (!criticalAssetsReady) return;
    startGameplay();
  };

  function syncBoardToWall(anchor: THREE.Object3D) {
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
    boardSynced = true;

    if (!hitGlow) {
      hitGlow = createHitGlow(dartboard, { opacity: 0.42, color: 0xffd34d });
    }

    startPose = computeStartCameraPose(dartboard, camera, {
      distance: 6.3,
      height: 1.0,
      right: 0.0,
    });

    camera.position.copy(startPose.position);
    camera.lookAt(startPose.target);
    controls.target.copy(startPose.target);
    controls.update();

    if (typeof actionManager.setStartCameraPose === "function") {
      actionManager.setStartCameraPose(startPose.position, 75, dartboard);
    }

    controls.enabled = false;

    if (!aimDisc) {
      aimDisc = createAimDisc(dartboard, {
        z: AIM_DISC_Z,
        maxRadius: 0.75,
        minRadius: 0.06,
        shrinkTime: 1.25,
      });
    }

    void showIntroLeaderboard();

    boardReadyForGameplay = true;
    maybeStartGameplay();

    requestRender();
    maybeFinishLoading();
  }

  const preloadPromise = preloadCriticalAssets({
    onProgress: (progress) => {
      if (!onLoadingProgress) return;
      onLoadingProgress({
        loaded: progress.loaded,
        total: progress.total,
        percent: progress.percent,
        message: progress.message,
      });
    },
  })
    .then((assets) => {
      preloadedEnvironment = assets.environmentGltf ?? null;
      criticalAssetsReady = true;
      maybeStartGameplay();
      maybeFinishLoading();
      return assets;
    })
    .catch((error) => {
      console.warn("Critical asset preload failed", error);
      criticalAssetsReady = true;
      maybeStartGameplay();
      maybeFinishLoading();
      return { environmentGltf: null };
    });

  function applyEnvironment(gltf: any) {
    scene.add(gltf.scene);
    const anchor = gltf.scene.getObjectByName(WALL_ANCHOR_NAME);
    if (anchor) {
      syncBoardToWall(anchor);
    }
    requestRender();
  }

  function loadEnvironment() {
    return preloadPromise
      .then((assets) => {
        if (assets.environmentGltf) {
          applyEnvironment(assets.environmentGltf);
          return;
        }
        throw new Error("Missing preloaded environment");
      })
      .catch(() =>
        import("three/examples/jsm/loaders/GLTFLoader.js").then(
          ({ GLTFLoader }) =>
            new Promise<void>((resolve) => {
              new GLTFLoader().load(
                GLB_URL,
                (gltf: any) => {
                  applyEnvironment(gltf);
                  resolve();
                },
                (event: ProgressEvent<EventTarget>) => {
                  if (!onLoadingProgress) return;
                  const total = event.lengthComputable ? event.total : undefined;
                  const loaded = event.loaded;
                  const percent =
                    typeof total === "number" && total > 0
                      ? (loaded / total) * 100
                      : undefined;
                  onLoadingProgress({
                    loaded,
                    total,
                    percent,
                    message: "Loading assets…",
                  });
                }
              );
            })
        )
      );
  }

  function scheduleEnvironmentLoad() {
    const startLoad = () => {
      void loadEnvironment();
    };

    if (quality.glbDelayMs > 0) {
      setTimeout(startLoad, quality.glbDelayMs);
    } else {
      startLoad();
    }
  }

  const idleWindow = window as IdleWindow;
  let idleHandle: number | null = null;
  if (typeof idleWindow.requestIdleCallback === "function") {
    idleHandle = idleWindow.requestIdleCallback(scheduleEnvironmentLoad);
  } else {
    scheduleEnvironmentLoad();
  }

  const clock = new THREE.Clock();

  function createRenderScheduler({
    renderFrame,
    isActive,
    idleFps,
    maxFps,
    idleStopDelayMs,
  }: {
    renderFrame: () => void;
    isActive: () => boolean;
    idleFps: number;
    maxFps: number;
    idleStopDelayMs: number;
  }) {
    let rafId: number | null = null;
    let lastRenderTime = 0;
    let idleSince: number | null = null;

    const step = (now: number) => {
      const active = isActive();
      const targetFps = active ? maxFps : idleFps;

      if (!active) {
        if (idleSince === null) idleSince = now;
        if (idleStopDelayMs > 0 && now - idleSince > idleStopDelayMs) {
          rafId = null;
          idleSince = null;
          return;
        }
      } else {
        idleSince = null;
      }

      if (targetFps <= 0) {
        rafId = null;
        return;
      }

      if (!lastRenderTime) lastRenderTime = now;
      const minDelta = 1000 / targetFps;

      if (now - lastRenderTime >= minDelta) {
        lastRenderTime = now;
        renderFrame();
      }

      rafId = requestAnimationFrame(step);
    };

    return {
      start: () => {
        if (rafId) return;
        lastRenderTime = 0;
        idleSince = null;
        clock.getDelta();
        rafId = requestAnimationFrame(step);
      },
      requestRender: () => {
        if (!rafId) {
          clock.getDelta();
          rafId = requestAnimationFrame(step);
        }
      },
      stop: () => {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        idleSince = null;
      },
    };
  }

  function shouldEnableAimDisc() {
    if (!aimDisc) return false;
    const busy = actionManager.isBusy && actionManager.isBusy();
    return gameStarted && roundActive && !busy;
  }

  function renderFrame() {
    const delta = Math.min(clock.getDelta(), 1 / 30);

    effects.update(delta);
    actionManager.update(delta, dartboard);

    if (aimDisc) {
      const shouldEnable = shouldEnableAimDisc();

      if (!isHoldingAim) {
        aimDisc.setEnabled(shouldEnable);
      }

      aimDisc.update(delta);
    }

    if (controls.enabled) controls.update();

    renderer.render(scene, camera);

    if (!perfTimings.firstRender) {
      perfTimings.firstRender = performance.now();
      logPerf("time-to-first-render", perfTimings.firstRender - perfTimings.start);
      maybeFinishLoading();
    }
  }

  const renderScheduler = createRenderScheduler({
    renderFrame,
    isActive: () =>
      (actionManager.needsRender && actionManager.needsRender()) ||
      effects.hasActive() ||
      isHoldingAim ||
      shouldEnableAimDisc(),
    idleFps: quality.idleFps,
    maxFps: quality.maxFps,
    idleStopDelayMs: quality.idleStopDelayMs,
  });

  requestRender = renderScheduler.requestRender;
  renderScheduler.start();

  const handleResize = () => {
    const nextQuality = getQualitySettings();
    const nextSize = getStageSize(container);
    camera.aspect = nextSize.width / nextSize.height;
    camera.updateProjectionMatrix();
    renderer.setSize(nextSize.width, nextSize.height);
    renderer.setPixelRatio(nextQuality.pixelRatio);
    requestRender();
  };

  window.addEventListener("resize", handleResize);

  return {
    dispose: () => {
      renderer.domElement.removeEventListener("pointerdown", onAimPointerDown);
      renderer.domElement.removeEventListener("pointerup", onAimPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onAimPointerCancel);
      renderer.domElement.removeEventListener("pointerleave", onAimPointerCancel);
      window.removeEventListener("resize", handleResize);
      if (window.__DD_START_GAME__ === startGameplay) {
        delete window.__DD_START_GAME__;
      }

      renderScheduler.stop();

      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }

      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
