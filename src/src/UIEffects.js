import * as THREE from "three";
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';

export function createUIEffects(scene) {
    let font = null;
    const loader = new FontLoader();
    loader.load('/fonts/helvetiker_bold.typeface.json', (f) => font = f);

    const activePopups = [];

    function spawnText(text, position) {
        if (!font) return;

        const geom = new TextGeometry(text, { font, size: 0.5, height: 0.1 });
        geom.center();

        const mat = new THREE.MeshStandardMaterial({ 
            color: 0xff00ff, 
            emissive: 0xff00ff, 
            emissiveIntensity: 2,
            transparent: true 
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(position).add(new THREE.Vector3(0, 1.5, 0.5)); // Float slightly above/in-front
        scene.add(mesh);

        activePopups.push({
            mesh,
            elapsed: 0,
            duration: 1.5
        });
    }

    function update(delta) {
        for (let i = activePopups.length - 1; i >= 0; i--) {
            const p = activePopups[i];
            p.elapsed += delta;
            const t = p.elapsed / p.duration;

            // --- ARCADE BOUNCE (Elastic Out) ---
            const bounce = Math.sin(t * Math.PI * 4) * Math.exp(-t * 5) * 0.5;
            const scale = 1 + bounce;
            p.mesh.scale.set(scale, scale, scale);

            // Float Upwards
            p.mesh.position.y += delta * 0.4;
            
            // Fade Out
            p.mesh.material.opacity = 1 - Math.pow(t, 3);

            if (p.elapsed >= p.duration) {
                scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                activePopups.splice(i, 1);
            }
        }
    }

    return { spawnText, update };
}