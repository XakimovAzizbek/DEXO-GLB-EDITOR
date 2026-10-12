import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const $ = (id) => document.getElementById(id);
const ids = ["mode","depth","smooth","res","invert","removeBg","tol","colorMode","surfaceColor","sideColor",
  "metal","rough","light","viewBg","frame","frameW","frameColor"];
const ui = {};
ids.forEach((i) => (ui[i] = $(i)));

const fileInput = $("file"), dropText = $("dropText"), viewerEl = $("viewer"), controlsEl = $("controls");
const createBtn = $("createBtn"), statusEl = $("status"), downloadBtn = $("downloadBtn"), shareBtn = $("shareBtn");

let img = null, group = null, glbBlob = null;
let renderer, scene, camera, controls, hemi, dirLight;
const BASE = 0.04;

const setStatus = (t, type = "") => { statusEl.textContent = t; statusEl.className = "status " + type; };

// ---------- Sahna ----------
function initScene() {
  if (renderer) return;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(ui.viewBg.value);
  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  resetCamera();
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  viewerEl.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 1.1);
  dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
  dirLight.position.set(1, -1, 2);
  scene.add(hemi, dirLight);
  applyLights();
  resize();
  window.addEventListener("resize", resize);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}
function resetCamera() {
  camera.position.set(0, -0.5, 2.2);
  if (controls) { controls.target.set(0, 0, 0); controls.update(); }
}
function resize() {
  const w = viewerEl.clientWidth, h = viewerEl.clientHeight;
  if (!w || !h || !renderer) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function applyLights() {
  const k = Number(ui.light.value);
  hemi.intensity = 1.1 * k;
  dirLight.intensity = 1.4 * k;
}

// ---------- Rasm ma'lumoti: balandlik + fon maskasi ----------
function getGrid(cols, rows) {
  const c = document.createElement("canvas");
  c.width = cols; c.height = rows;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cols, rows);
  const d = ctx.getImageData(0, 0, cols, rows).data;
  const N = cols * rows;
  let h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let v = (0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2]) / 255;
    if (ui.invert.checked) v = 1 - v;
    h[i] = v * (d[i*4+3] / 255);
  }
  for (let p = 0; p < Number(ui.smooth.value); p++) {
    const n = new Float32Array(N);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let s = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < cols && yy >= 0 && yy < rows) { s += h[yy*cols+xx]; k++; }
      }
      n[y*cols+x] = s / k;
    }
    h = n;
  }

  const mask = new Uint8Array(N).fill(1);
  if (ui.removeBg.checked) {
    // fon rangi: chetdagi piksellarning o'rtachasi
    let r = 0, g = 0, b = 0, n = 0;
    const addB = (i) => { r += d[i*4]; g += d[i*4+1]; b += d[i*4+2]; n++; };
    for (let x = 0; x < cols; x++) { addB(x); addB((rows-1)*cols + x); }
    for (let y = 0; y < rows; y++) { addB(y*cols); addB(y*cols + cols - 1); }
    r /= n; g /= n; b /= n;
    const tol = Number(ui.tol.value) * 4.41;
    const isBg = (i) => d[i*4+3] < 25 ||
      Math.hypot(d[i*4]-r, d[i*4+1]-g, d[i*4+2]-b) < tol;
    const seen = new Uint8Array(N);
    const stack = [];
    const push = (i) => { if (!seen[i] && isBg(i)) { seen[i] = 1; stack.push(i); } };
    for (let x = 0; x < cols; x++) { push(x); push((rows-1)*cols + x); }
    for (let y = 0; y < rows; y++) { push(y*cols); push(y*cols + cols - 1); }
    while (stack.length) {
      const i = stack.pop(), x = i % cols, y = (i / cols) | 0;
      if (x > 0) push(i-1);
      if (x < cols-1) push(i+1);
      if (y > 0) push(i-cols);
      if (y < rows-1) push(i+cols);
    }
    for (let i = 0; i < N; i++) if (seen[i]) { mask[i] = 0; h[i] = 0; }
  }
  return { h, mask };
}

// ---------- Geometriya yordamchilari ----------
function gridTris(cols, rows, mask, useMask) {
  const tris = [];
  for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols - 1; x++) {
    const a = y*cols + x, b = a + 1, c = a + cols, d = c + 1;
    for (const t of [[a, c, b], [b, c, d]]) {
      if (!useMask || (mask[t[0]] && mask[t[1]] && mask[t[2]])) tris.push(t);
    }
  }
  return tris;
}

// uchburchaklar yo'nalishi dirFn(markaz) tomonga qarasin
function orient(pos, tris, dirFn) {
  let s = 0;
  for (const [a, b, c] of tris) {
    const ax = pos[a*3], ay = pos[a*3+1], az = pos[a*3+2];
    const ux = pos[b*3]-ax, uy = pos[b*3+1]-ay, uz = pos[b*3+2]-az;
    const vx = pos[c*3]-ax, vy = pos[c*3+1]-ay, vz = pos[c*3+2]-az;
    const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const cen = [(ax+pos[b*3]+pos[c*3])/3, (ay+pos[b*3+1]+pos[c*3+1])/3, (az+pos[b*3+2]+pos[c*3+2])/3];
    const dv = dirFn(cen);
    s += nx*dv[0] + ny*dv[1] + nz*dv[2];
  }
  if (s < 0) for (const t of tris) { const tmp = t[1]; t[1] = t[2]; t[2] = tmp; }
}

function makeGeo(pos, uv, tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (uv) g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(tris.flat());
  g.computeVertexNormals();
  return g;
}

function imgToCanvas() {
  const s = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ---------- Modelni qurish ----------
function buildModel() {
  if (!img) return;
  initScene();
  const mode = ui.mode.value;
  const aspect = img.width / img.height;
  const res = Number(ui.res.value);
  const depth = Number(ui.depth.value);
  const useMask = ui.removeBg.checked;

  let cols, rows;
  if (mode === "sphere") { cols = res; rows = Math.round(res / 2); }
  else if (aspect >= 1) { cols = res; rows = Math.max(16, Math.round(res / aspect)); }
  else { rows = res; cols = Math.max(16, Math.round(res * aspect)); }

  const { h, mask } = getGrid(cols, rows);
  let tris = gridTris(cols, rows, mask, useMask);
  let warn = "";
  if (useMask && tris.length === 0) { tris = gridTris(cols, rows, mask, false); warn = "Fon hammasini o'chirdi, sezgirlikni kamaytiring."; }

  const N = cols * rows;
  const uv = new Float32Array(N * 2);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y*cols + x;
    uv[i*2] = x / (cols - 1);
    uv[i*2+1] = 1 - y / (rows - 1);
  }

  // Materiallar
  const shell = mode === "sphere" || mode === "cylinder";
  const surfaceMat = new THREE.MeshStandardMaterial({
    roughness: Number(ui.rough.value),
    metalness: Number(ui.metal.value),
    side: shell ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (ui.colorMode.value === "texture") {
    const tex = new THREE.CanvasTexture(imgToCanvas());
    tex.colorSpace = THREE.SRGBColorSpace;
    surfaceMat.map = tex;
  } else {
    surfaceMat.color.set(ui.surfaceColor.value);
  }
  const sideMat = new THREE.MeshStandardMaterial({
    color: ui.sideColor.value, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
  });

  const g = new THREE.Group();
  g.name = "model";
  let targetZ = 0;

  if (mode === "relief" || mode === "double") {
    const W = aspect >= 1 ? 1 : aspect, H = aspect >= 1 ? 1 / aspect : 1;
    const dbl = mode === "double";
    const front = new Float32Array(N * 3), back = new Float32Array(N * 3);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y*cols + x;
      const X = (x/(cols-1) - 0.5) * W, Y = (0.5 - y/(rows-1)) * H, z = BASE + h[i] * depth;
      front.set([X, Y, z], i*3);
      back.set([X, Y, dbl ? -z : 0], i*3);
    }
    const fTris = tris.map((t) => [...t]);
    orient(front, fTris, () => [0, 0, 1]);
    const bTris = tris.map((t) => [t[0], t[2], t[1]]);
    orient(back, bTris, () => [0, 0, -1]);

    let backUV = uv;
    if (dbl) {
      backUV = new Float32Array(uv);
      for (let i = 0; i < N; i++) backUV[i*2] = 1 - uv[i*2];
    }
    const fm = new THREE.Mesh(makeGeo(front, uv, fTris), surfaceMat); fm.name = "front";
    const bm = new THREE.Mesh(makeGeo(back, backUV, bTris), dbl ? surfaceMat : sideMat); bm.name = "back";
    g.add(fm, bm);

    // Yon devorlar: chegara qirralar
    const edges = new Set();
    for (const [a, b, c] of fTris) { edges.add(a*N + b); edges.add(b*N + c); edges.add(c*N + a); }
    const sp = [], si = [];
    const push3 = (arr, i) => sp.push(arr[i*3], arr[i*3+1], arr[i*3+2]);
    const addEdge = (a, b) => {
      const o = sp.length / 3;
      push3(front, a); push3(front, b); push3(back, b); push3(back, a);
      si.push([o, o+1, o+2], [o, o+2, o+3]);
    };
    for (const [a, b, c] of fTris) {
      if (!edges.has(b*N + a)) addEdge(a, b);
      if (!edges.has(c*N + b)) addEdge(b, c);
      if (!edges.has(a*N + c)) addEdge(c, a);
    }
    if (si.length) {
      const sm = new THREE.Mesh(makeGeo(new Float32Array(sp), null, si), sideMat); sm.name = "sides";
      g.add(sm);
    }

    // Ramka
    if (ui.frame.checked) {
      const fw = Number(ui.frameW.value);
      const zTop = BASE + depth, zBot = dbl ? -(BASE + depth) : 0;
      const T = zTop - zBot, zc = (zTop + zBot) / 2;
      const frameMat = new THREE.MeshStandardMaterial({ color: ui.frameColor.value, roughness: 0.6, metalness: 0.1 });
      const mk = (w, hh, x, y) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, T), frameMat);
        m.position.set(x, y, zc); m.name = "frame"; g.add(m);
      };
      mk(W + 2*fw, fw, 0,  H/2 + fw/2);
      mk(W + 2*fw, fw, 0, -H/2 - fw/2);
      mk(fw, H, -W/2 - fw/2, 0);
      mk(fw, H,  W/2 + fw/2, 0);
    }
    targetZ = dbl ? 0 : (BASE + depth) / 2;
  }

  else if (mode === "sphere") {
    const pos = new Float32Array(N * 3);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y*cols + x;
      const th = (x/(cols-1) - 0.25) * Math.PI * 2, ph = (y/(rows-1)) * Math.PI;
      const r = 0.5 + h[i] * depth * 0.4;
      pos.set([-r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i*3);
    }
    const t2 = tris.map((t) => [...t]);
    orient(pos, t2, (c) => c);
    const m = new THREE.Mesh(makeGeo(pos, uv, t2), surfaceMat); m.name = "sphere";
    g.add(m);
  }

  else { // cylinder
    const R0 = 0.4, Hc = Math.min(1.6, Math.max(0.5, 2 * Math.PI * R0 / aspect));
    const pos = new Float32Array(N * 3);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y*cols + x;
      const th = (x/(cols-1) - 0.25) * Math.PI * 2;
      const r = R0 + h[i] * depth * 0.3;
      pos.set([-r * Math.cos(th), (0.5 - y/(rows-1)) * Hc, r * Math.sin(th)], i*3);
    }
    const t2 = tris.map((t) => [...t]);
    orient(pos, t2, (c) => [c[0], 0, c[2]]);
    const m = new THREE.Mesh(makeGeo(pos, uv, t2), surfaceMat); m.name = "cylinder";
    g.add(m);

    if (!useMask) { // qopqoqlar
      for (const top of [true, false]) {
        const row = top ? 0 : rows - 1;
        const cp = new Float32Array((cols + 1) * 3);
        for (let x = 0; x < cols; x++) {
          const i = row*cols + x;
          cp.set([pos[i*3], pos[i*3+1], pos[i*3+2]], x*3);
        }
        cp.set([0, top ? Hc/2 : -Hc/2, 0], cols*3);
        const ct = [];
        for (let x = 0; x < cols - 1; x++) ct.push([cols, x, x + 1]);
        orient(cp, ct, () => [0, top ? 1 : -1, 0]);
        const cm = new THREE.Mesh(makeGeo(cp, null, ct), sideMat); cm.name = top ? "cap_top" : "cap_bottom";
        g.add(cm);
      }
    }
  }

  if (group) {
    scene.remove(group);
    group.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  }
  group = g;
  scene.add(group);
  controls.target.set(0, 0, targetZ);
  controls.update();
  downloadBtn.hidden = true; shareBtn.hidden = true;
  if (warn) setStatus(warn, "error");
}

// ---------- GLB eksport ----------
function exportGlb() {
  if (!group) return;
  createBtn.disabled = true;
  setStatus("GLB yaratilmoqda...");
  new GLTFExporter().parse(
    group,
    (result) => {
      glbBlob = new Blob([result], { type: "application/octet-stream" });
      downloadBtn.hidden = false;
      shareBtn.hidden = false;
      setStatus("Tayyor! ✅ (" + (glbBlob.size / 1024 / 1024).toFixed(2) + " MB)", "ok");
      createBtn.disabled = false;
    },
    (err) => { console.error(err); setStatus("Xato: " + (err.message || err), "error"); createBtn.disabled = false; },
    { binary: true }
  );
}

const inApp = /Telegram|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent) || !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);

async function saveGlb() {
  if (!glbBlob) return;
  const name = "model.glb";
  // 1) Fayl saqlash oynasi (qo'llab-quvvatlasa)
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "GLB model", accept: { "application/octet-stream": [".glb"] } }],
      });
      const w = await handle.createWritable();
      await w.write(glbBlob);
      await w.close();
      setStatus("Saqlandi ✅", "ok");
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
      console.warn("showSaveFilePicker ishlamadi:", e);
    }
  }
  // 2) Oddiy yuklab olish (a[download])
  try {
    const url = URL.createObjectURL(glbBlob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 15000);
    setStatus(inApp
      ? "Telegram/ilova ichidagi brauzer yuklashni bloklaydi. Sahifani Chrome yoki Safari'da oching yoki \"Ulashish\" ni bosing."
      : "Yuklab olish boshlandi. Chiqmasa \"Ulashish\" ni bosing.", inApp ? "error" : "ok");
  } catch (e) {
    console.error(e);
    setStatus("Saqlab bo'lmadi: " + e.message + ". \"Ulashish\" tugmasini sinab ko'ring.", "error");
  }
}

async function shareGlb() {
  if (!glbBlob) return;
  const file = new File([glbBlob], "model.glb", { type: "model/gltf-binary" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "3D model" });
      setStatus("Ulashildi ✅", "ok");
    } else {
      await saveGlb();
      setStatus("Bu qurilmada ulashish qo'llab-quvvatlanmaydi, fayl yuklab olindi.");
    }
  } catch (e) {
    if (e.name !== "AbortError") { console.error(e); setStatus("Ulashib bo'lmadi: " + e.message, "error"); }
  }
}

// ---------- Hodisalar ----------
fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  if (!f) return;
  const im = new Image();
  im.onload = () => {
    img = im;
    dropText.textContent = "✅ " + f.name;
    viewerEl.hidden = false; controlsEl.hidden = false;
    createBtn.disabled = false;
    initScene(); resize(); buildModel();
    setStatus("Sozlang, keyin \"Yaratish\" ni bosing.");
  };
  im.onerror = () => setStatus("Rasmni o'qib bo'lmadi.", "error");
  im.src = URL.createObjectURL(f);
});

const showVals = () => {
  const set = (id, txt) => { const el = $(id + "Val"); if (el) el.textContent = txt; };
  set("depth", Number(ui.depth.value).toFixed(2));
  set("smooth", ui.smooth.value); set("res", ui.res.value); set("tol", ui.tol.value);
  set("metal", Number(ui.metal.value).toFixed(1)); set("rough", Number(ui.rough.value).toFixed(2));
  set("light", Number(ui.light.value).toFixed(1)); set("frameW", Number(ui.frameW.value).toFixed(2));
};

let timer;
const rebuild = () => { showVals(); clearTimeout(timer); timer = setTimeout(buildModel, 150); };
ids.filter((i) => i !== "light" && i !== "viewBg").forEach((i) => ui[i].addEventListener("input", rebuild));
ui.mode.addEventListener("change", () => { resetCamera(); });
ui.light.addEventListener("input", () => { showVals(); if (hemi) applyLights(); });
ui.viewBg.addEventListener("input", () => { if (scene) scene.background.set(ui.viewBg.value); });

createBtn.addEventListener("click", exportGlb);
shareBtn.addEventListener("click", shareGlb);
downloadBtn.addEventListener("click", saveGlb);
showVals();
