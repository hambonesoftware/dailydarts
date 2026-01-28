import * as THREE from "three";
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

export function createDartboard(options = {}) {
  const boardRadius = options.boardRadius ?? 2.05;
  const boardThickness = 0.35;
  const position = options.position ?? new THREE.Vector3(0, 1.85, -1.5);
  const includeWall = options.includeWall !== undefined ? !!options.includeWall : true;

  const group = new THREE.Group();

  // Expose board dimensions for gameplay (aim disc + hit testing)
  group.userData.boardRadius = boardRadius;
  group.userData.boardThickness = boardThickness;


  // --- 1. THE VISIBLE BACKBOARD (Cabinet Style) ---
  if (includeWall) {
    const backboardSize = 6.0; 
    const backboardDepth = 0.02; // Made thicker so it's visible

    const woodCanvas = document.createElement('canvas');
    woodCanvas.width = 1024; woodCanvas.height = 1024;
    const wCtx = woodCanvas.getContext('2d');

    // Dark Oak Finish
    wCtx.fillStyle = "#2b1d0e";
    wCtx.fillRect(0, 0, 1024, 1024);
    
    // Horizontal planks
    for (let i = 0; i < 10; i++) {
      wCtx.strokeStyle = "rgba(0,0,0,0.4)";
      wCtx.lineWidth = 4;
      wCtx.strokeRect(0, i * 102.4, 1024, 102.4);
      // Subtle grain
      for(let g=0; g<20; g++) {
        wCtx.fillStyle = "rgba(255,255,255,0.03)";
        wCtx.fillRect(Math.random()*1024, i*102.4 + Math.random()*100, 200, 1);
      }
    }

    const woodTex = new THREE.CanvasTexture(woodCanvas);
    const backboardMat = new THREE.MeshStandardMaterial({ 
      map: woodTex, 
      roughness: 0.8, 
      metalness: 0.1 
    });

    // Main Square Panel
    const backboard = new THREE.Mesh(
      new THREE.BoxGeometry(backboardSize, backboardSize, backboardDepth), 
      backboardMat
    );
    
    // Position it just in front of the wall (z = -0.1) 
    // and just behind the board (which sits at z = 0)
    backboard.position.z = -boardThickness/2 - .1;
    backboard.receiveShadow = true;
    backboard.castShadow = true;
    group.add(backboard);

    // ADDED: Cabinet Trim (Makes the edges catch light)
    const trimGeo = new THREE.BoxGeometry(backboardSize + 0.2, 0.2, 0.4);
    const topTrim = new THREE.Mesh(trimGeo, backboardMat);
    topTrim.position.set(0, backboardSize/2, -0.05);
    group.add(topTrim);
	// --- Inside the Backboard Logic ---
	for (let i = 0; i < 15; i++) {
	  const plankW = 1024 / 15;
	  
	  // Shift toward a deep reddish brown (Mahogany/Bar Oak)
	  // Base tone should be lower for a richer look
	  const tone = 0 
	  
	  // Increase Red and decrease Blue to get that "Warm Bar" feel
	  wCtx.fillStyle = `rgb(${tone + 130}, ${tone +30}, ${tone+25})`; 
	  
	  wCtx.fillRect(i * plankW, 0, plankW, 1024);
	  
	  // Darken the plank separation for more depth
	  wCtx.strokeStyle = "rgba(0,0,0,.7)";
	  wCtx.strokeRect(i * plankW, 0, plankW, 1024);
	}
    
    const bottomTrim = topTrim.clone();
    bottomTrim.position.y = -backboardSize/2;
    group.add(bottomTrim);
  }

  // --- 2. THE TRADITIONAL BOARD FACE ---
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = 1024; faceCanvas.height = 1024;
  const ctx = faceCanvas.getContext('2d');
  const cx = 512, cy = 512;

  const colors = { black: "#111111", cream: "#f2e8cf", red: "#bc0b0b", green: "#006d2c" };
  const segments = 20;
  // Start Angle Fix for 20 at top
  const startAngle = -Math.PI / 2 - (Math.PI / segments);

  for (let i = 0; i < segments; i++) {
    const a0 = startAngle + (i * Math.PI * 2) / segments;
    const a1 = startAngle + ((i + 1) * Math.PI * 2) / segments;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 480, a0, a1);
    ctx.fillStyle = i % 2 === 0 ? colors.black : colors.cream;
    ctx.fill();
  }

  const drawRing = (r0, r1) => {
    for (let i = 0; i < segments; i++) {
      const a0 = startAngle + (i * Math.PI * 2) / segments;
      const a1 = startAngle + ((i + 1) * Math.PI * 2) / segments;
      ctx.beginPath();
      ctx.arc(cx, cy, r1, a0, a1);
      ctx.arc(cx, cy, r0, a1, a0, true);
      ctx.fillStyle = i % 2 === 0 ? colors.green : colors.red;
      ctx.fill();
    }
  };
  drawRing(445, 480); 
  drawRing(275, 310);

  // Bullseyes
  ctx.beginPath(); ctx.arc(cx, cy, 70, 0, Math.PI * 2); ctx.fillStyle = colors.green; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 32, 0, Math.PI * 2); ctx.fillStyle = colors.red; ctx.fill();

  const faceTex = new THREE.CanvasTexture(faceCanvas);
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 1.0 });

  const board = new THREE.Mesh(
    new THREE.CylinderGeometry(boardRadius, boardRadius, boardThickness, 64),
    [
      new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0.7, roughness: 0.2 }),
      faceMat,
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    ]
  );
  board.name = "dartboardFace";
  group.userData.faceMesh = board;
  board.rotateX(Math.PI / 2);
  board.castShadow = true;
  group.add(board);

  // --- 3. THE SPIDER (Wires) ---
  const wireMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.1 });
  [0.94, 0.87, 0.61, 0.53, 0.14, 0.06].forEach(r => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(boardRadius * r, 0.008, 8, 128), wireMat);
    ring.position.z = boardThickness / 2 + 0.01;
    group.add(ring);
  });

  // --- 4. 3D NUMBERS ---
  const loader = new FontLoader();
  loader.load('/fonts/helvetiker_bold.typeface.json', (font) => {
    const dartNumbers = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
    const numMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

    dartNumbers.forEach((num, i) => {
      const textGeo = new TextGeometry(num.toString(), { font, size: 0.22, height: 0.04, depth: 0.02 });
      textGeo.center();
      const textMesh = new THREE.Mesh(textGeo, numMat);
      
      const angle = (i * Math.PI * 2) / 20 - Math.PI / 2;
      const radius = boardRadius * 1.12;
      
      textMesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, boardThickness/2 + 0.05);
      textMesh.castShadow = true;
      group.add(textMesh);
    });
  });

  group.position.copy(position);
  return group;
}