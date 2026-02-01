export function getQualitySettings() {
  const width = window.innerWidth || 0;
  const height = window.innerHeight || 0;
  const minDim = Math.min(width, height);
  const isMobile = minDim <= 820;

  const devicePixelRatio = window.devicePixelRatio || 1;
  const pixelRatioCap = isMobile ? 1.25 : 2;

  return {
    isMobile,
    pixelRatio: Math.min(devicePixelRatio, pixelRatioCap),
    particleScale: isMobile ? 0.55 : 1,
    particleBurstScale: isMobile ? 0.7 : 1,
    shadowsEnabled: !isMobile,
    maxFps: 60,
    idleFps: isMobile ? 6 : 12,
    idleStopDelayMs: isMobile ? 1200 : 1600,
    glbDelayMs: isMobile ? 1200 : 300,
    numbersDelayMs: isMobile ? 900 : 0,
  };
}
