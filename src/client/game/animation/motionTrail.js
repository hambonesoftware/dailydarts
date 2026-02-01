import * as THREE from "three";

export function createMotionTrailSystem(scene) {
  const motionBlurTrail = new THREE.Group();
  scene.add(motionBlurTrail);

  // Shared geometry so we don't allocate per-trail
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

  function dispose() {
    // Remove all children from the motionBlurTrail group
    while (motionBlurTrail.children.length > 0) {
      const child = motionBlurTrail.children[0];
      motionBlurTrail.remove(child);
    }

    // Dispose shared geometry
    sharedTrailGeom.dispose();

    // Remove group from scene
    if (motionBlurTrail.parent) {
      motionBlurTrail.parent.remove(motionBlurTrail);
    }
  }

  return {
    createMotionTrail,
    dispose,
  };
}
