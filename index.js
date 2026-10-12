// ===== Importlar =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Client, handle_file } from '@gradio/client';

// ===== DOM Elementlari =====
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const previewContainer = document.getElementById('previewContainer');
const previewImage = document.getElementById('previewImage');
const clearBtn = document.getElementById('clearBtn');
const generateBtn = document.getElementById('generateBtn');
const btnText = generateBtn.querySelector('.btn-text');
const spinner = generateBtn.querySelector('.spinner');
const statusEl = document.getElementById('status');
const viewerEl = document.getElementById('viewer');
const placeholder = viewerEl.querySelector('.viewer-placeholder');
const downloadBtn = document.getElementById('downloadBtn');
const resetCameraBtn = document.getElementById('resetCameraBtn');

// ===== Zaxira Space'lar ro'yxati (ishlamasa keyingisiga o'tadi) =====
const SPACE_CANDIDATES = [
    { name: 'stabilityai/stable-point-aware-3d', endpoint: '/generate' },
    { name: 'tencent/Hunyuan3D-2', endpoint: '/generation_all' },
    { name: 'JeffreyXiang/TRELLIS', endpoint: '/image_to_3d' }
];

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

// ===== Rasm yuklash logikasi =====
let selectedFile = null;

dropZone.addEventListener('click', () => fileInput.click());
browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

function handleFile(file) {
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        showStatus('Faqat PNG, JPG yoki WebP formatdagi rasmlar qabul qilinadi.', 'error');
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        showStatus('Rasm hajmi 8 MB dan oshmasligi kerak.', 'error');
        return;
    }

    selectedFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        previewImage.src = e.target.result;
        previewContainer.classList.remove('hidden');
        dropZone.classList.add('hidden');
    };
    reader.readAsDataURL(file);

    generateBtn.disabled = false;
    showStatus('Rasm tayyor. "3D Model Yaratish" tugmasini bosing.', 'success');
}

clearBtn.addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    previewContainer.classList.add('hidden');
    dropZone.classList.remove('hidden');
    generateBtn.disabled = true;
    hideStatus();
});

// ===== Zaxira Space'larni sinab ko'rish =====
async function generate3DModel() {
    if (!selectedFile) return;

    setLoading(true);

    let lastError = null;

    // Har bir Space'ni navbat bilan sinab ko'rish
    for (const space of SPACE_CANDIDATES) {
        try {
            showStatus(`"${space.name}" sinab ko'rilmoqda...`, 'loading');

            const glbUrl = await generateWithSpace(space, selectedFile);

            if (glbUrl) {
                currentGlbUrl = glbUrl;
                await loadGLB(glbUrl);

                showStatus('✅ 3D model muvaffaqiyatli yaratildi!', 'success');
                downloadBtn.disabled = false;
                resetCameraBtn.disabled = false;
                setLoading(false);
                return;
            }
        } catch (err) {
            console.warn(`"${space.name}" ishlamadi:`, err.message);
            lastError = err;
            // Keyingi Space'ga o'tish
        }
    }

    // Barcha Space'lar ishlamadi
    setLoading(false);
    showStatus(
        '❌ Barcha Space\'lar vaqtincha ishlamayapti. Iltimos, 1-2 daqiqadan so\'ng qayta urinib ko\'ring. Xatolik: ' +
        (lastError?.message || 'Noma\'lum xatolik'),
        'error'
    );
}

// ===== Bitta Space bilan generatsiya =====
async function generateWithSpace(space, file) {
    showStatus(`"${space.name}" ga ulanmoqda...`, 'loading');

    const app = await Client.connect(space.name, {
        status_callback: (status) => {
            console.log(`[${space.name}] holati:`, status);
            if (status.status === 'sleeping') {
                showStatus(`"${space.name}" uyg'onmoqda... Iltimos kuting.`, 'loading');
            }
            if (status.status === 'space_error') {
                throw new Error(`Space xatosi: ${status.message}`);
            }
        }
    });

    showStatus(`"${space.name}" da 3D model yaratilmoqda...`, 'loading');

    let result;

    // Har bir Space uchun mos parametrlar
    if (space.name === 'stabilityai/stable-point-aware-3d') {
        result = await app.predict(space.endpoint, [
            handle_file(file),  // image
            0.85,                // foreground_ratio
            1.0,                 // guidance_scale
            50                   // num_steps
        ]);
    } else if (space.name === 'tencent/Hunyuan3D-2') {
        result = await app.predict(space.endpoint, [
            '',
            handle_file(file),
            null, null, null, null,
            50, 7.5, 1234, 256, true, 200000, false
        ]);
    } else if (space.name === 'JeffreyXiang/TRELLIS') {
        result = await app.predict(space.endpoint, [
            handle_file(file),
            0.85,
            50,
            1234,
            256
        ]);
    }

    console.log(`[${space.name}] natija:`, result);

    // Natijadan GLB URL ni ajratib olish
    return extractGlbUrl(result, space.name);
}

// ===== GLB URL ni natijadan ajratib olish =====
function extractGlbUrl(result, spaceName) {
    if (!result || !result.data) {
        throw new Error('Natija bo\'sh qaytdi.');
    }

    const data = result.data;

    // Har xil Space'lar turli formatda qaytaradi — barchasini sinab ko'ramiz
    const candidates = [
        data[0], data[1], data[2], data[3], data[4]
    ].filter(Boolean);

    for (const item of candidates) {
        // String URL
        if (typeof item === 'string' && item.startsWith('http')) {
            return item;
        }
        // Gradio FileData obyekti
        if (typeof item === 'object' && item !== null) {
            if (item.url && item.url.startsWith('http')) return item.url;
            if (item.path) {
                return `https://${spaceName.replace('/', '-').toLowerCase()}.hf.space/gradio_api/file=${item.path}`;
            }
        }
    }

    throw new Error('GLB URL topilmadi. Javob: ' + JSON.stringify(data));
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