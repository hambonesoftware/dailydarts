import * as THREE from "three";

export function createDart(options = {}) {
  const flightColor = options.flightColor ?? 0xff3a3a;
  const shaftColor = options.shaftColor ?? 0xeeeeee;
  
  const container = new THREE.Group();

  // --- 1. TUNGSTEN BARREL (Heavy Grip) ---
  const barrelGroup = new THREE.Group();
  const barrelMat = new THREE.MeshStandardMaterial({
    color: 0x888888,
    metalness: 1.0,
    roughness: 0.2
  });

  // Create a ribbed grip using multiple toruses or cylinders
  const numRings = 12;
  for (let i = 0; i < numRings; i++) {
    const ringGeo = new THREE.TorusGeometry(0.055, 0.008, 8, 32);
    const ring = new THREE.Mesh(ringGeo, barrelMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = -0.1 - (i * 0.04);
    barrelGroup.add(ring);
  }

  // Inner core to fill the rings
  const coreGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 32);
  coreGeo.rotateX(Math.PI / 2);
  const core = new THREE.Mesh(coreGeo, barrelMat);
  core.position.z = -0.3;
  barrelGroup.add(core);
  
  container.add(barrelGroup);

  // --- 2. NYLON SHAFT (Semi-Transparent) ---
  const shaftGeo = new THREE.CylinderGeometry(0.02, 0.035, 0.4, 16);
  shaftGeo.rotateX(Math.PI / 2);
  const shaftMat = new THREE.MeshPhysicalMaterial({
    color: shaftColor,
    transparent: true,
    opacity: 0.6,
    transmission: 0.5, // Glass-like effect
    thickness: 0.1,
    roughness: 0.1
  });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.z = -0.8;
  container.add(shaft);

  // --- 3. AERODYNAMIC FLIGHTS (Double-Sided) ---
  const flightShape = new THREE.Shape();
  flightShape.moveTo(0, 0);
  flightShape.lineTo(0.2, 0.1);
  flightShape.lineTo(0.25, 0.4);
  flightShape.lineTo(0.05, 0.45);
  flightShape.lineTo(0, 0.35);

  const flightGeo = new THREE.ExtrudeGeometry(flightShape, { depth: 0.005, bevelEnabled: false });
  flightGeo.rotateX(-Math.PI / 2);
  flightGeo.translate(0, 0, -0.0025);

  const flightMat = new THREE.MeshStandardMaterial({
    color: flightColor,
    side: THREE.DoubleSide,
    roughness: 0.7,
    metalness: 0.1
  });

  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(flightGeo, flightMat);
    f.rotation.z = (Math.PI / 2) * i;
    f.position.z = -1.0; // Mounted on the shaft
    container.add(f);
  }

  // --- 4. HARDENED STEEL TIP ---
  const tipGeo = new THREE.ConeGeometry(0.015, 0.4, 16);
  tipGeo.rotateX(Math.PI / 2);
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1, roughness: 0.1 });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.z = 0.45;
  container.add(tip);

  // Enable shadows for all parts
  container.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return container;
}