/* Gemeinsame Helfer für Archiv und DJ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Camelot-Rad (für harmonisches Mixen)
const CAMELOT_MAJOR = { B: "1B", "F#": "2B", "C#": "3B", "G#": "4B", "D#": "5B", "A#": "6B", F: "7B", C: "8B", G: "9B", D: "10B", A: "11B", E: "12B" };
const CAMELOT_MINOR = { "G#": "1A", "D#": "2A", "A#": "3A", F: "4A", C: "5A", G: "6A", D: "7A", A: "8A", E: "9A", B: "10A", "F#": "11A", "C#": "12A" };
function camelot(root, mode) {
  if (!root) return "";
  return (mode === "Moll" ? CAMELOT_MINOR : CAMELOT_MAJOR)[root] || "";
}
function keyLabel(root, mode) { return root ? `${root}${mode === "Moll" ? "m" : ""}` : "–"; }
function fmtTime(sec) {
  if (sec == null || isNaN(sec)) return "–";
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDate(ts) { return ts ? new Date(ts * 1000).toLocaleDateString("de-DE") : ""; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function api(path, opts = {}) {
  const o = { headers: {}, ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(o.body); }
  const r = await fetch(path, o);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

// Tabs
const views = {};
$$(".tab").forEach(t => t.onclick = () => {
  $$(".tab").forEach(x => x.classList.toggle("active", x === t));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + t.dataset.view));
  const archiveOnly = t.dataset.view === "archive";
  ["#btn-scan", "#btn-render-missing", "#btn-analyze", "#btn-new", "#q"].forEach(s => $(s).style.display = archiveOnly ? "" : "none");
  views[t.dataset.view]?.onShow?.();
});

// Dialoge
function openModal(id) { $(id).classList.add("open"); }
function closeModals() { $$(".modal").forEach(m => m.classList.remove("open")); }
$$("[data-close]").forEach(b => b.onclick = closeModals);
$$(".modal").forEach(m => m.addEventListener("mousedown", e => { if (e.target === m) closeModals(); }));

// Hintergrund-Jobs (Statusleiste)
let jobWasRunning = false, pollTimer = null, lastLogLen = 0;
const jobListeners = [];
function pollNow() { clearTimeout(pollTimer); pollJob(); }  // nach Start eines Jobs sofort abfragen
async function pollJob() {
  try {
    const j = await api("/api/job");
    const pct = j.total ? Math.round(100 * j.done / j.total) : 0;
    $("#job-bar").style.width = (j.running ? Math.max(pct, 3) : (jobWasRunning ? 100 : 0)) + "%";
    $("#job-bar").classList.toggle("indeterminate", j.running && !j.total);
    $("#btn-cancel").hidden = !j.running;
    const last = j.log[j.log.length - 1] || "";
    $("#job-text").textContent = j.running ? `${j.name}: ${j.done}/${j.total} – ${last.slice(9)}` : (last ? last.slice(9) : "Bereit");
    if (jobWasRunning && !j.running) { jobListeners.forEach(fn => fn(j)); toast(last.slice(9)); setTimeout(() => { if (!jobWasRunning) $("#job-bar").style.width = "0%"; }, 3000); }
    jobWasRunning = j.running;
    if (j.running && j.done % 5 === 0) jobListeners.forEach(fn => fn(j, true));
  } catch (e) { /* Server neu gestartet */ }
  pollTimer = setTimeout(pollJob, jobWasRunning ? 400 : 3000);
}
$("#btn-cancel").onclick = () => api("/api/job/cancel", { method: "POST" });
pollJob();

// Wellenform-Peaks aus einem AudioBuffer, inklusive Bässe/Mitten/Höhen für die Rekordbox-Farben
function computePeaks(buffer, perSecond = 150) {
  return Wave.fromBuffer(buffer, perSecond);
}

// Übersichts-Wellenform. Ohne bands einfarbig (color), mit bands farbig wie im Archiv.
function drawOverview(canvas, peaks, color, progress = null, cues = [], bands = null) {
  const dpr = devicePixelRatio || 1, w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (!w || !h) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (!peaks || !peaks.length) return;
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor(x / w * peaks.length), i1 = Math.max(i0 + 1, Math.floor((x + 1) / w * peaks.length));
    let m = 0, mi = i0; for (let i = i0; i < i1; i++) if (peaks[i] > m) { m = peaks[i]; mi = i; }
    const played = progress != null && x / w < progress;
    if (bands && bands.low) g.fillStyle = Wave.bandColor(bands.low[mi], bands.mid[mi], bands.high[mi], played ? 0.45 : 1);
    else g.fillStyle = played ? "#666" : color;
    g.fillRect(x, mid - m * mid, 1, Math.max(1, m * h));
  }
  if (progress != null) { g.fillStyle = "#fff"; g.fillRect(progress * w, 0, 2 * dpr, h); }
  cues.forEach((c, i) => { if (c == null) return; g.fillStyle = "#ff5f56"; g.fillRect(c * w, 0, 1.5 * dpr, h * 0.35); });
}

// Kurze Einblendung unten rechts
function toast(msg) {
  if (!msg) return;
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 4000);
}
