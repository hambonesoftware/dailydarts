import * as THREE from "three";

export function createFireworksSystem(scene, options = {}) {
  const bursts = [];
  const gravity = options.gravity ?? -4.0;
  const drag = options.drag ?? 0.97;

  function burst(position, burstOptions = {}) {
    const count = burstOptions.count ?? 300;
    const speed = burstOptions.speed ?? 8.5;
    const lifetime = burstOptions.lifetime ?? 1.2;

    // Sharp localized light flash
    const burstLight = new THREE.PointLight(0xffffff, 30, 4, 2.0);
    burstLight.position.copy(position);
    scene.add(burstLight);

    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3 + 0] = position.x;
      positions[i3 + 1] = position.y;
      positions[i3 + 2] = position.z;

      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);
      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi)
      ).normalize();

      const s = speed * (0.6 + Math.random() * 1.2);
      velocities[i3 + 0] = dir.x * s;
      velocities[i3 + 1] = dir.y * s + 1.2;
      velocities[i3 + 2] = dir.z * s;

      // --- MULTICOLOR LOGIC ---
      // Every particle gets a completely random Neon Hue
      const hue = Math.random(); 
      color.setHSL(hue, 1.0, 0.6); // High saturation for arcade feel
      colors[i3 + 0] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }

    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.25, // Thicker particles
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geom, mat);
    scene.add(points);

    bursts.push({
      points,
      geom,
      mat,
      velocities,
      light: burstLight,
      age: 0,
      lifetime,
    });
  }

  function update(dt) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.age += dt;
      const t = b.age / b.lifetime;

      if (b.light) {
        b.light.intensity = 40 * (1 - Math.pow(t, 0.1));
        if (t > 0.2) {
          scene.remove(b.light);
          b.light = null;
        }
      }

      b.mat.opacity = Math.pow(1 - t, 1.5);

      const posAttr = b.geom.getAttribute("position");
      const colorAttr = b.geom.getAttribute("color");
      const posArr = posAttr.array;
      const colArr = colorAttr.array;
      const v = b.velocities;

      const tempColor = new THREE.Color();

      for (let p = 0; p < posArr.length; p += 3) {
        // Physics
        v[p + 0] *= drag;
        v[p + 1] = v[p + 1] * drag + gravity * dt;
        v[p + 2] *= drag;

        posArr[p + 0] += v[p + 0] * dt;
        posArr[p + 1] += v[p + 1] * dt;
        posArr[p + 2] += v[p + 2] * dt;

        // --- COLOR CYCLE EXTRA LEVEL ---
        // Shifts the color slightly as the particle falls
        tempColor.fromArray(colArr, p);
        let hsl = {};
        tempColor.getHSL(hsl);
        tempColor.setHSL((hsl.h + dt * 0.5) % 1, 1.0, 0.6);
        colArr[p + 0] = tempColor.r;
        colArr[p + 1] = tempColor.g;
        colArr[p + 2] = tempColor.b;
      }

      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;

      if (b.age >= b.lifetime) {
        scene.remove(b.points);
        b.geom.dispose();
        b.mat.dispose();
        bursts.splice(i, 1);
      }
    }
  }

  return { burst, update };
}