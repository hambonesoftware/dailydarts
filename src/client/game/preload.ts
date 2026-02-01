import * as THREE from "three";

export const GLB_URL = "assets/bar_diorama.glb";
const FONT_URL = "/fonts/helvetiker_bold.typeface.json";
const ROUND_END_LOGO_URL = "assets/default-icon.png";

export type PreloadProgress = {
  loaded: number;
  total?: number;
  percent?: number;
  message?: string;
  asset?: string;
};

export type PreloadedAssets = {
  environmentGltf?: any;
  font?: any;
  roundEndLogo?: HTMLImageElement | null;
};

let preloadPromise: Promise<PreloadedAssets> | null = null;

export function preloadCriticalAssets({
  onProgress,
}: {
  onProgress?: (progress: PreloadProgress) => void;
} = {}): Promise<PreloadedAssets> {
  if (preloadPromise) return preloadPromise;

  THREE.Cache.enabled = true;

  preloadPromise = new Promise<PreloadedAssets>((resolve, reject) => {
    const manager = new THREE.LoadingManager();

    manager.onProgress = (url, itemsLoaded, itemsTotal) => {
      const percent = itemsTotal > 0 ? (itemsLoaded / itemsTotal) * 100 : undefined;
      onProgress?.({
        loaded: itemsLoaded,
        total: itemsTotal,
        percent,
        message: "Loading assets…",
        asset: url,
      });
    };

    const gltfPromise = import("three/examples/jsm/loaders/GLTFLoader.js").then(
      ({ GLTFLoader }) =>
        new Promise<any>((resolveGltf, rejectGltf) => {
          new GLTFLoader(manager).load(
            GLB_URL,
            (gltf: any) => resolveGltf(gltf),
            undefined,
            (err: unknown) => rejectGltf(err)
          );
        })
    );

    const fontPromise = import("three/examples/jsm/loaders/FontLoader.js").then(
      ({ FontLoader }) =>
        new Promise<any>((resolveFont, rejectFont) => {
          new FontLoader(manager).load(
            FONT_URL,
            (font: any) => resolveFont(font),
            undefined,
            (err: unknown) => rejectFont(err)
          );
        })
    );

    const roundEndLogoPromise = new Promise<HTMLImageElement | null>((resolveLogo, rejectLogo) => {
      const loader = new THREE.ImageLoader(manager);
      loader.load(
        ROUND_END_LOGO_URL,
        (img) => resolveLogo(img),
        undefined,
        (err) => rejectLogo(err)
      );
    });

    Promise.all([gltfPromise, fontPromise, roundEndLogoPromise])
      .then(([environmentGltf, font, roundEndLogo]) => {
        resolve({ environmentGltf, font, roundEndLogo });
      })
      .catch(reject);
  });

  return preloadPromise;
}
