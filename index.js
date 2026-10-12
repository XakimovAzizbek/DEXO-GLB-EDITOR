// ===== Importlar =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { forge } from '@three-ws/forge';

// ===== DOM Elementlari =====
const promptInput = document.getElementById('promptInput');
const hintChips = document.querySelectorAll('.hint-chip');
const tierSelect = document.getElementById('tierSelect');
const generateBtn = document.getElementById('generateBtn');
const btnText = generateBtn.querySelector('.btn-text');
const spinner = generateBtn.querySelector('.spinner');
const statusEl = document.getElementById('status');
const viewerEl = document.getElementById('viewer');
const placeholder = viewerEl.querySelector('.viewer-placeholder');
const downloadBtn = document.getElementById('downloadBtn');
const resetCameraBtn = document.getElementById('resetCameraBtn');

// ===== Three.js Sahnasi =====
let scene, camera, renderer, controls, loadedModel = null;
let currentGlbUrl = null;

function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c2438);

    camera = new THREE.PerspectiveCamera(
        45,
        viewerEl.clientWidth / viewerEl.clientHeight,
        0.1,
        1000
    );
    camera.position.set(0, 1.2, 3.5);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    viewerEl.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const directional = new THREE.DirectionalLight(0xffffff, 2.5);
    directional.position.set(3, 5, 4);
    scene.add(directional);

    const fillLight = new THREE.DirectionalLight(0xa29bfe, 1.2);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;
    controls.target.set(0, 0.6, 0);
    controls.minDistance = 1;
    controls.maxDistance = 12;

    renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
    });

    window.addEventListener('resize', onResize);
}

function onResize() {
    if (!renderer || !camera) return;
    const w = viewerEl.clientWidth;
    const h = viewerEl.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

// ===== Matn kiritish logikasi =====
promptInput.addEventListener('input', () => {
    generateBtn.disabled = promptInput.value.trim().length < 3;
});

// Tez tanlash tugmalari
hintChips.forEach(chip => {
    chip.addEventListener('click', () => {
        promptInput.value = chip.dataset.prompt;
        promptInput.dispatchEvent(new Event('input'));
        promptInput.focus();
    });
});

// ===== Forge SDK orqali 3D generatsiya =====
async function generate3DModel() {
    const prompt = promptInput.value.trim();
    if (prompt.length < 3) return;

    setLoading(true);
    showStatus('AI model yaratilmoqda... Bu 10–60 soniya olishi mumkin.', 'loading');

    try {
        // ✅ Matn → 3D: SDK orqali chaqirish
        const model = await forge(prompt, {
            tier: tierSelect.value,   // 'draft' | 'standard' | 'high'
            path: 'geometry'          // matn uchun 'geometry' yo'lini ishlatish
        });

        console.log('Forge natijasi:', model);

        const glbUrl = model.glbUrl;
        if (!glbUrl) {
            throw new Error('GLB URL qaytarmadi: ' + JSON.stringify(model));
        }

        currentGlbUrl = glbUrl;
        await loadGLB(glbUrl);

        showStatus('✅ 3D model muvaffaqiyatli yaratildi!', 'success');
        downloadBtn.disabled = false;
        resetCameraBtn.disabled = false;

    } catch (err) {
        console.error('Xatolik:', err);
        showStatus('❌ Xatolik: ' + (err.message || 'Noma\'lum xatolik'), 'error');
    } finally {
        setLoading(false);
    }
}

// ===== GLB yuklash =====
function loadGLB(url) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();

        if (loadedModel) {
            scene.remove(loadedModel);
            loadedModel.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            loadedModel = null;
        }

        loader.load(
            url,
            (gltf) => {
                loadedModel = gltf.scene;

                const box = new THREE.Box3().setFromObject(loadedModel);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                loadedModel.position.sub(center);

                const maxDim = Math.max(size.x, size.y, size.z);
                if (maxDim > 0) {
                    const scale = 2.2 / maxDim;
                    loadedModel.scale.setScalar(scale);
                }

                loadedModel.position.y += 0.5;

                scene.add(loadedModel);

                if (placeholder) placeholder.style.display = 'none';

                controls.target.set(0, 0.5, 0);
                camera.position.set(0, 1.5, 3.5);
                controls.update();

                resolve();
            },
            (xhr) => {
                if (xhr.total) {
                    const pct = Math.round((xhr.loaded / xhr.total) * 100);
                    showStatus(`GLB yuklanmoqda... ${pct}%`, 'loading');
                }
            },
            (error) => reject(error)
        );
    });
}

// ===== Yuklab olish =====
downloadBtn.addEventListener('click', () => {
    if (!currentGlbUrl) return;
    const a = document.createElement('a');
    a.href = currentGlbUrl;
    a.download = `model-${Date.now()}.glb`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

// ===== Kamera tiklash =====
resetCameraBtn.addEventListener('click', () => {
    if (!controls) return;
    camera.position.set(0, 1.5, 3.5);
    controls.target.set(0, 0.5, 0);
    controls.update();
});

// ===== UI Yordamchilari =====
function setLoading(isLoading) {
    generateBtn.disabled = isLoading;
    if (isLoading) {
        btnText.textContent = 'Yaratilmoqda...';
        spinner.classList.remove('hidden');
    } else {
        btnText.textContent = '🎨 3D Model Yaratish';
        spinner.classList.add('hidden');
    }
}

function showStatus(msg, type = 'loading') {
    statusEl.textContent = msg;
    statusEl.classList.remove('hidden', 'error', 'success');
    if (type === 'error') statusEl.classList.add('error');
    else if (type === 'success') statusEl.classList.add('success');
}

function hideStatus() {
    statusEl.classList.add('hidden');
}

// ===== Generate tugmasi =====
generateBtn.addEventListener('click', generate3DModel);

// ===== Ishga tushirish =====
initThree();

// Klaviatura shortcut: Ctrl+Enter
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (!generateBtn.disabled) generate3DModel();
    }
});