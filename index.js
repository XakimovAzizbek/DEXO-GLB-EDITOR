import { Client, handle_file } from "https://cdn.jsdelivr.net/npm/@gradio/client@1.15.1/dist/index.min.js";

const $ = (id) => document.getElementById(id);
const fileInput = $("file");
const preview = $("preview");
const dropText = $("dropText");
const createBtn = $("createBtn");
const statusEl = $("status");
const viewer = $("viewer");
const downloadBtn = $("downloadBtn");
const resolution = $("resolution");
const resVal = $("resVal");

let selectedFile = null;
let currentObjectUrl = null;

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = "status " + type;
}

resolution.addEventListener("input", () => (resVal.textContent = resolution.value));

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  selectedFile = file;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  dropText.hidden = true;
  createBtn.disabled = false;
  viewer.hidden = true;
  downloadBtn.hidden = true;
  setStatus("");
});

// Natijadan .glb manzilini topish (Space javobi turlicha bo'lishi mumkin)
function findGlbUrl(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return /\.glb(\?|$)/i.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = findGlbUrl(v);
      if (r) return r;
    }
    return null;
  }
  if (typeof value === "object") {
    const direct = value.url || value.path || value.name;
    if (typeof direct === "string" && /\.glb(\?|$)/i.test(direct)) return direct;
    for (const k of Object.keys(value)) {
      const r = findGlbUrl(value[k]);
      if (r) return r;
    }
  }
  return null;
}

async function generate() {
  if (!selectedFile) return;

  createBtn.disabled = true;
  viewer.hidden = true;
  downloadBtn.hidden = true;

  try {
    const spaceId = $("spaceId").value.trim() || "stabilityai/TripoSR";
    const token = $("hfToken").value.trim();
    const removeBg = $("removeBg").checked;
    const mcRes = Number(resolution.value);

    setStatus("Space'ga ulanmoqda...");
    const client = await Client.connect(spaceId, token ? { hf_token: token } : {});

    // 1-qadam: rasmni tayyorlash (fonni olib tashlash)
    setStatus("Rasm tayyorlanmoqda...");
    const prep = await client.predict("/preprocess", [
      handle_file(selectedFile),
      removeBg,
      0.85,
    ]);
    const processed = prep.data[0];

    // 2-qadam: 3D model yaratish
    setStatus("3D model yaratilmoqda (1-2 daqiqa olishi mumkin)...");
    const result = await client.predict("/generate", [processed, mcRes]);

    const glbUrl = findGlbUrl(result.data);
    if (!glbUrl) throw new Error("Javobda .glb fayl topilmadi.");

    // Faylni yuklab, o'zimizning blob manzilga aylantiramiz
    setStatus("Model yuklanmoqda...");
    const res = await fetch(glbUrl);
    if (!res.ok) throw new Error("GLB yuklab bo'lmadi: " + res.status);
    const blob = await res.blob();

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(blob);

    viewer.src = currentObjectUrl;
    viewer.hidden = false;
    downloadBtn.href = currentObjectUrl;
    downloadBtn.download = "model.glb";
    downloadBtn.hidden = false;

    setStatus("Tayyor! ✅", "ok");
  } catch (err) {
    console.error(err);
    const msg = (err && (err.message || err.detail || err.toString())) || "Noma'lum xato";
    setStatus(
      "Xato: " + msg + " — Space band yoki o'zgargan bo'lishi mumkin. Keyinroq urinib ko'ring yoki sozlamalarda boshqa Space nomini kiriting.",
      "error"
    );
  } finally {
    createBtn.disabled = false;
  }
}

createBtn.addEventListener("click", generate);
