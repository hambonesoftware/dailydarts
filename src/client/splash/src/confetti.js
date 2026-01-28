import * as THREE from "three";

export function createConfettiSystem(scene, options = {}) {
  const bursts = [];
  const gravity = options.gravity ?? -5.5;
  const drag = options.drag ?? 0.985;

  function burst(position, burstOptions = {}) {
    const count = burstOptions.count ?? 220;
    const spread = burstOptions.spread ?? 1.15;
    const speed = burstOptions.speed ?? 4.2;
    const lifetime = burstOptions.lifetime ?? 1.6;

    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Start at burst position
      positions[i3 + 0] = position.x;
      positions[i3 + 1] = position.y;
      positions[i3 + 2] = position.z;

      // Random direction in a forward-ish cone (toward camera a bit)
      const dir = new THREE.Vector3(
        (Math.random() * 2 - 1) * spread,
        (Math.random() * 2 - 1) * spread,
        (Math.random() * 2 - 1) * spread
      ).normalize();

      // Slight bias "outward" toward viewer
      dir.z += 0.65;
      dir.normalize();

      const s = speed * (0.35 + Math.random() * 0.85);

      velocities[i3 + 0] = dir.x * s;
      velocities[i3 + 1] = dir.y * s + (1.0 + Math.random() * 1.5);
      velocities[i3 + 2] = dir.z * s;

      // Bright random confetti colors
      color.setHSL(Math.random(), 0.95, 0.6);
      colors[i3 + 0] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: burstOptions.size ?? 0.035,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    scene.add(points);

    bursts.push({
      points,
      geom,
      mat,
      velocities,
      age: 0,
      lifetime,
    });
  }

  function update(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.age += dt;

      const t = Math.min(b.age / b.lifetime, 1);
      b.mat.opacity = 1 - t;

      const posAttr = b.geom.getAttribute("position");
      const arr = posAttr.array;
      const v = b.velocities;

      for (let p = 0; p < arr.length; p += 3) {
        v[p + 0] *= drag;
        v[p + 1] = v[p + 1] * drag + gravity * dt;
        v[p + 2] *= drag;

        arr[p + 0] += v[p + 0] * dt;
        arr[p + 1] += v[p + 1] * dt;
        arr[p + 2] += v[p + 2] * dt;
      }

      posAttr.needsUpdate = true;

      if (b.age >= b.lifetime) {
        scene.remove(b.points);
        b.geom.dispose();
        b.mat.dispose();
        bursts.splice(i, 1);
      }
    }
  }

  function dispose() {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      scene.remove(b.points);
      b.geom.dispose();
      b.mat.dispose();
      bursts.splice(i, 1);
    }
  }

  return { burst, update, dispose };
}
