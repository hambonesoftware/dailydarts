import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";

export function createArcadeTextSystem(scene, opts = {}) {
  const activePopups = [];

  const COLORS = {
    TEXT_EMISSIVE: opts.textEmissive ?? 0x00ffff,
    HIGHLIGHT: opts.highlight ?? 0xff00ff,
  };

  // Preload font (LOCAL, no network)
  let gameFont = null;
  const loader = new FontLoader();
  loader.load("/fonts/helvetiker_bold.typeface.json", (f) => {
    gameFont = f;
  });

  // Temps (avoid allocations)
  const tmpV0 = new THREE.Vector3();
  const tmpV1 = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();

  const Easing = {
    easeOutElastic: (t) => {
      const c4 = (2 * Math.PI) / 3;
      return t === 0
        ? 0
        : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
  };

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
      p.position.set(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        Math.random() * 0.4 - 0.2
      );
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

  function update(delta) {
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
        particle.position.x =
          Math.cos(particle.userData.angle + p.elapsed) * particle.userData.radius;
        particle.position.y =
          Math.sin(particle.userData.angle + p.elapsed) * particle.userData.radius;
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

        // Shared geom/material per popup instance — dispose once
        if (p.particles.children.length > 0) {
          const m0 = p.particles.children[0].material;
          const g0 = p.particles.children[0].geometry;
          m0.dispose();
          g0.dispose();
        }

        activePopups.splice(i, 1);
      }
    }
  }

  function dispose() {
    for (let i = activePopups.length - 1; i >= 0; i--) {
      const p = activePopups[i];
      p.layers.forEach((layer) => {
        scene.remove(layer);
        if (layer.geometry) layer.geometry.dispose();
        if (layer.material) layer.material.dispose();
      });
      scene.remove(p.particles);

      if (p.particles && p.particles.children && p.particles.children.length > 0) {
        const m0 = p.particles.children[0].material;
        const g0 = p.particles.children[0].geometry;
        if (m0) m0.dispose();
        if (g0) g0.dispose();
      }
    }
    activePopups.length = 0;
  }

  return {
    spawnArcadeText,
    update,
    dispose,
  };
}
