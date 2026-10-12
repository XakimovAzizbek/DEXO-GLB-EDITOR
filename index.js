import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const $ = (id) => document.getElementById(id);
const fileInput = $("file"), dropText = $("dropText"), viewerEl = $("viewer"), controlsEl = $("controls");
const createBtn = $("createBtn"), statusEl = $("status"), downloadBtn = $("downloadBtn");
const depthEl = $("depth"), smoothEl = $("smooth"), resEl = $("res"), invertEl = $("invert");

let img = null;            // yuklangan rasm
let group = null;          // 3D model
let downloadUrl = null;
let renderer, scene, camera, controls;

function setStatus(t, type = "") { statusEl.textContent = t; statusEl.className = "status " + type; }

// ---------- Three.js sahna ----------
function initScene() {
  if (renderer) return;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11141a);
  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, -1.4, 1.6);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  viewerEl.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
  const d = new THREE.DirectionalLight(0xffffff, 1.4);
  d.position.set(1, -1, 2);
  scene.add(d);
  resize();
  window.addEventListener("resize", resize);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}
function resize() {
  const w = viewerEl.clientWidth, h = viewerEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---------- Balandlik xaritasi ----------
function getHeights(cols, rows) {
  const c = document.createElement("canvas");
  c.width = cols; c.height = rows;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  let h = new Float32Array(cols * rows);
  for (let i = 0; i < h.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3] / 255;
    let v = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (invertEl.checked) v = 1 - v;
    h[i] = v * a;
  }
  // oddiy blur (silliqlash)
  const passes = Number(smoothEl.value);
  for (let p = 0; p < passes; p++) {
    const n = new Float32Array(h.length);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let s = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < cols && yy >= 0 && yy < rows) { s += h[yy * cols + xx]; k++; }
      }
      n[y * cols + x] = s / k;
    }
    h = n;
  }
  return h;
}

// ---------- Model qurish ----------
function buildModel() {
  if (!img) return;
  initScene();

  const aspect = img.width / img.height;
  const W = aspect >= 1 ? 1 : aspect;
  const H = aspect >= 1 ? 1 / aspect : 1;
  const res = Number(resEl.value);
  const cols = aspect >= 1 ? res : Math.max(16, Math.round(res * aspect));
  const rows = aspect >= 1 ? Math.max(16, Math.round(res / aspect)) : res;
  const depth = Number(depthEl.value);
  const base = 0.04;                      // taglik qalinligi
  const heights = getHeights(cols, rows);

  // Yuqori sirt
  const pos = [], uv = [], idx = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const u = x / (cols - 1), v = y / (rows - 1);
    pos.push((u - 0.5) * W, (0.5 - v) * H, base + heights[y * cols + x] * depth);
    uv.push(u, 1 - v);
  }
  for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols - 1; x++) {
    const a = y * cols + x, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  top.setIndex(idx);
  top.computeVertexNormals();

  const tex = new THREE.CanvasTexture(imgToCanvas());
  tex.colorSpace = THREE.SRGBColorSpace;
  const topMesh = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0 }));
  topMesh.name = "relief";

  // Yon devor va taglik
  const sp = [], si = [];
  const addQuad = (p1, p2, p3, p4) => {
    const o = sp.length / 3;
    sp.push(...p1, ...p2, ...p3, ...p4);
    si.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  const P = (x, y) => [(x / (cols - 1) - 0.5) * W, (0.5 - y / (rows - 1)) * H, base + heights[y * cols + x] * depth];
  const B = (p) => [p[0], p[1], 0];
  for (let x = 0; x < cols - 1; x++) {
    let a = P(x, 0), b = P(x + 1, 0); addQuad(B(a), B(b), b, a);                 // tepa chekka
    a = P(x, rows - 1); b = P(x + 1, rows - 1); addQuad(a, b, B(b), B(a));        // past chekka
  }
  for (let y = 0; y < rows - 1; y++) {
    let a = P(0, y), b = P(0, y + 1); addQuad(a, b, B(b), B(a));                  // chap
    a = P(cols - 1, y); b = P(cols - 1, y + 1); addQuad(B(a), B(b), b, a);        // o'ng
  }
  addQuad([-W / 2, H / 2, 0], [W / 2, H / 2, 0], [W / 2, -H / 2, 0], [-W / 2, -H / 2, 0]); // taglik
  const side = new THREE.BufferGeometry();
  side.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  side.setIndex(si);
  side.computeVertexNormals();
  const sideMesh = new THREE.Mesh(side, new THREE.MeshStandardMaterial({ color: 0x9aa0ad, roughness: 0.9, side: THREE.DoubleSide }));
  sideMesh.name = "base";

  if (group) { scene.remove(group); group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); }); }
  group = new THREE.Group();
  group.name = "model";
  group.add(topMesh, sideMesh);
  scene.add(group);

  controls.target.set(0, 0, depth / 2);
  controls.update();
}

function imgToCanvas() {
  const max = 1024;
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ---------- GLB eksport ----------
function exportGlb() {
  if (!group) return;
  createBtn.disabled = true;
  setStatus("GLB yaratilmoqda...");
  new GLTFExporter().parse(
    group,
    (result) => {
      const blob = new Blob([result], { type: "model/gltf-binary" });
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(blob);
      downloadBtn.href = downloadUrl;
      downloadBtn.download = "model.glb";
      downloadBtn.hidden = false;
      setStatus("Tayyor! ✅ (" + (blob.size / 1024 / 1024).toFixed(2) + " MB)", "ok");
      createBtn.disabled = false;
    },
    (err) => { console.error(err); setStatus("Xato: " + (err.message || err), "error"); createBtn.disabled = false; },
    { binary: true }
  );
}

// ---------- Hodisalar ----------
fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const im = new Image();
  im.onload = () => {
    img = im;
    dropText.textContent = "✅ " + f.name;
    viewerEl.hidden = false;
    controlsEl.hidden = false;
    createBtn.disabled = false;
    downloadBtn.hidden = true;
    initScene(); resize();
    buildModel();
    setStatus("Sozlang, keyin \"Yaratish\" ni bosing.");
  };
  im.onerror = () => setStatus("Rasmni o'qib bo'lmadi.", "error");
  im.src = url;
});

let timer;
const rebuild = () => { $("depthVal").textContent = Number(depthEl.value).toFixed(2); $("smoothVal").textContent = smoothEl.value; $("resVal").textContent = resEl.value; downloadBtn.hidden = true; clearTimeout(timer); timer = setTimeout(buildModel, 150); };
[depthEl, smoothEl, resEl, invertEl].forEach((el) => el.addEventListener("input", rebuild));

createBtn.addEventListener("click", exportGlb);
