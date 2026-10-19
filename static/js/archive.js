/* Archiv-Ansicht: Suche, Filter, Details, Bearbeiten, Neues Projekt */
const A = { filters: {}, projects: [], sel: null, audio: new Audio(), playing: null, peaks: {} };
const GENRE_COLORS = ["#ffa940", "#5ec8e0", "#8fd36f", "#e07bd8", "#ff5f56", "#f2d45c", "#7b8cff", "#4fd1a5", "#c98b5b", "#b0b0b0"];
function colorFor(s) { let h = 0; for (const c of s || "") h = (h * 31 + c.charCodeAt(0)) >>> 0; return GENRE_COLORS[h % GENRE_COLORS.length]; }

function buildKeys() {
  $("#keys").innerHTML = NOTES.map(n => `<button data-k="${n}">${n}</button>`).join("");
  $$("#keys button").forEach(b => b.onclick = () => {
    A.filters.key_root = A.filters.key_root === b.dataset.k ? "" : b.dataset.k; refresh();
  });
  $$("#modes button").forEach(b => b.onclick = () => { A.filters.key_mode = b.dataset.m; refresh(); });
  $("#n-key").innerHTML = NOTES.map(n => `<option>${n}</option>`).join("");
}

function syncFilterUI() {
  $$("#keys button").forEach(b => b.classList.toggle("sel", b.dataset.k === A.filters.key_root));
  $$("#modes button").forEach(b => b.classList.toggle("sel", b.dataset.m === (A.filters.key_mode || "")));
  $$("#sidebar [data-g]").forEach(i => i.classList.toggle("sel", A.filters[i.dataset.g] === i.dataset.v));
}

async function loadFacets() {
  const f = await api("/api/facets");
  const st = Object.fromEntries(f.status.map(x => [x.value, x.count]));
  $("#n-all").textContent = f.total; $("#n-fertig").textContent = st.Fertig || 0; $("#n-skizze").textContent = st.Skizze || 0;
  $("#n-nomp3").textContent = f.total - f.with_mp3;
  const list = (arr, g) => arr.map(x => `<div class="item" data-g="${g}" data-v="${esc(x.value)}"><span><span class="chip" style="background:${colorFor(x.value)}"></span> ${esc(x.value)}</span><span class="n">${x.count}</span></div>`).join("");
  $("#genres").innerHTML = list(f.genre, "genre"); $("#moods").innerHTML = list(f.mood, "mood");
  $("#genre-list").innerHTML = f.genre.map(x => `<option value="${esc(x.value)}">`).join("");
  $("#mood-list").innerHTML = f.mood.map(x => `<option value="${esc(x.value)}">`).join("");
  $$("#sidebar [data-g]").forEach(i => i.onclick = () => {
    A.filters[i.dataset.g] = A.filters[i.dataset.g] === i.dataset.v ? "" : i.dataset.v; refresh();
  });
  $("#lib-info").textContent = `${f.total} Projekte · ${f.with_mp3} MP3s · ${f.imports} importierte Tracks`;
  syncFilterUI();
}

let refreshTimer;
function refresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(loadProjects, 120); syncFilterUI(); }

async function loadProjects() {
  const params = new URLSearchParams({ ...A.filters, q: $("#q").value, tempo_min: $("#tmin").value, tempo_max: $("#tmax").value, sort: $("#sort").value });
  [...params.keys()].forEach(k => { if (!params.get(k)) params.delete(k); });
  A.projects = await api("/api/projects?" + params);
  $("#count").textContent = `${A.projects.length} Projekte`;
  $("#empty").hidden = A.projects.length > 0 || Object.values(A.filters).some(Boolean) || $("#q").value;
  $("#plist tbody").innerHTML = A.projects.map(p => `
    <tr data-id="${p.id}" class="${A.sel === p.id ? "sel" : ""}">
      <td><span class="chip" style="background:${p.color || colorFor(p.genre)}"></span></td>
      <td>${p.mp3_path ? `<button class="play" data-play="${p.id}">${A.playing === p.id ? "❚❚" : "▶"}</button>` : ""}</td>
      <td title="${esc(p.path)}" data-noi18n>${esc(p.name)}${p.error ? ' <span title="' + esc(p.error) + '" style="color:var(--red)">●</span>' : ""}</td>
      <td class="wcol">${p.mp3_path ? `<canvas class="mini" data-mini="${p.id}" width="320" height="44"></canvas>` : ""}</td>
      <td class="mono">${p.tempo ? (+p.tempo).toFixed(1) : "–"}</td>
      <td class="mono">${keyLabel(p.key_root, p.key_mode)} <span style="color:var(--dim)">${camelot(p.key_root, p.key_mode)}</span></td>
      <td>${esc(p.genre || "")}</td><td>${esc(p.mood || "")}</td>
      <td><span class="badge ${p.status}">${p.status || ""}</span></td>
      <td class="mono">${fmtTime(p.length_sec)}</td>
      <td style="color:var(--accent)">${"★".repeat(p.rating || 0)}</td>
      <td class="mono">${fmtDate(p.mtime)}</td>
    </tr>`).join("");
  loadMinis();
}

// ---- Mini-Waveforms in der Liste (wie Rekordbox: Bässe blau, Mitten orange, Höhen weiß) ----
A.mini = A.mini || {};
const miniQueue = [];
let miniBusy = 0;
function loadMinis() {
  $$("canvas[data-mini]").forEach(c => {
    const id = +c.dataset.mini;
    if (A.mini[id]) drawMini(c, id);
    else if (!miniQueue.includes(id)) miniQueue.push(id);
  });
  pumpMinis();
}
function pumpMinis() {
  while (miniBusy < 2 && miniQueue.length) {
    const id = miniQueue.shift();
    miniBusy++;
    fetch(`/api/peaks/${id}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) { A.mini[id] = d; const c = $(`canvas[data-mini="${id}"]`); if (c) drawMini(c, id); }
    }).catch(() => {}).finally(() => { miniBusy--; pumpMinis(); });
  }
}
function drawMini(c, id) {
  const prog = A.playing === id && A.audio.duration ? A.audio.currentTime / A.audio.duration : -1;
  drawMiniWave(c, A.mini[id], prog);
}
function drawPlayingMini() {
  if (!A.playing) return;
  const c = $(`canvas[data-mini="${A.playing}"]`); if (c) drawMini(c, A.playing);
}

$("#plist tbody").addEventListener("click", e => {
  const play = e.target.closest("[data-play]");
  if (play) { togglePlay(+play.dataset.play); e.stopPropagation(); return; }
  const mini = e.target.closest("canvas[data-mini]");
  if (mini) {
    const id = +mini.dataset.mini, r = mini.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
    const seek = () => { if (A.audio.duration) A.audio.currentTime = f * A.audio.duration; };
    if (A.playing !== id) { togglePlay(id); A.audio.addEventListener("loadedmetadata", seek, { once: true }); } else seek();
    e.stopPropagation(); return;
  }
  const tr = e.target.closest("tr"); if (tr) select(+tr.dataset.id);
});
$("#plist tbody").addEventListener("dblclick", e => { const tr = e.target.closest("tr"); if (tr) api(`/api/open/${tr.dataset.id}`, { method: "POST" }); });
$$("#plist th[data-s]").forEach(th => th.onclick = () => { $("#sort").value = th.dataset.s; refresh(); });

function togglePlay(id) {
  if (A.playing === id) { A.audio.pause(); A.playing = null; }
  else { A.audio.src = `/audio/${id}`; A.audio.play(); A.playing = id; }
  loadProjects();
}
A.audio.onended = () => { A.playing = null; loadProjects(); };
A.audio.ontimeupdate = () => { drawDetailWave(); drawPlayingMini(); };

async function select(id) {
  A.sel = id;
  $$("#plist tbody tr").forEach(tr => tr.classList.toggle("sel", +tr.dataset.id === id));
  const p = await api(`/api/projects/${id}`);
  const tracks = (p.tracks_audio || 0) + (p.tracks_midi || 0);
  $("#detail").innerHTML = `
    <h2 data-noi18n>${esc(p.name)}</h2>
    <div class="path" data-noi18n>${esc(p.path)}</div>
    ${p.mp3_path ? `<canvas id="dwave"></canvas>` : `<div class="empty" style="padding:14px;border:1px dashed #444">Noch kein MP3 gerendert</div>`}
    <div class="actions">
      <button class="btn small primary" id="d-open">In Live öffnen</button>
      <button class="btn small" id="d-reveal">Im Finder zeigen</button>
      <button class="btn small" id="d-render">${p.mp3_path ? "Neu rendern" : "MP3 rendern"}</button>
      ${p.mp3_path ? `<button class="btn small" id="d-analyze">Analysieren</button>` : ""}
      <button class="btn small danger" id="d-remove" title="Die .als-Datei bleibt erhalten">Aus Liste entfernen</button>
    </div>
    <div class="stats">
      <div class="stat"><b>${p.tempo ? (+p.tempo).toFixed(1) : "–"}</b><span>BPM</span></div>
      <div class="stat"><b>${keyLabel(p.key_root, p.key_mode)}</b><span>Tonart ${p.key_source === "audio" ? "(Analyse)" : p.key_source === "set" ? "(Live)" : ""}</span></div>
      <div class="stat"><b>${fmtTime(p.length_sec)}</b><span>Länge</span></div>
      <div class="stat"><b>${tracks}</b><span>Spuren</span></div>
      <div class="stat"><b>${p.clips_arrangement || 0}</b><span>Clips</span></div>
      <div class="stat"><b>${p.energy != null ? Math.round(p.energy * 100) : "–"}</b><span>Energie</span></div>
    </div>
    <div class="form">
      <label>Status</label><select class="field" data-e="status"><option value="Skizze">Skizze</option><option value="Fertig">Fertig</option></select>
      <label>Genre</label><input class="field" data-e="genre" list="genre-list">
      <label>Stimmung</label><input class="field" data-e="mood" list="mood-list">
      <label>Tonart</label><div style="display:flex;gap:4px"><select class="field" data-e="key_root"><option value=""></option>${NOTES.map(n => `<option>${n}</option>`).join("")}</select><select class="field" data-e="key_mode"><option value=""></option><option value="Dur">Dur</option><option value="Moll">Moll</option></select></div>
      <label>Tempo</label><input class="field" data-e="tempo" type="number" step="0.01">
      <label>Tags</label><input class="field" data-e="tags" placeholder="durch Komma getrennt">
      <label>Bewertung</label><div class="rating">${[1, 2, 3, 4, 5].map(i => `<span data-r="${i}" class="${(p.rating || 0) >= i ? "on" : ""}">★</span>`).join("")}</div>
      <label>Notizen</label><textarea class="field" data-e="notes" rows="3"></textarea>
    </div>
    <div class="reasons">Auto-Status: ${esc((p.status_reasons || []).join(", ") || "–")}</div>
    <div class="reasons">Plug-ins: ${esc((p.plugins || []).join(", ") || "keine")}</div>
    <div class="reasons">Samples: ${p.samples_total || 0}${p.samples_missing ? ` · <span style="color:var(--red)">${p.samples_missing} fehlen</span>` : ""} · ${esc(p.live_version || "")}</div>
    ${p.error ? `<div class="reasons" style="color:var(--red)">${esc(p.error)}</div>` : ""}`;
  $$("#detail [data-e]").forEach(el => {
    const k = el.dataset.e;
    el.value = k === "tags" ? (p.tags || []).join(", ") : (p[k] ?? "");
    el.onchange = () => save(id, { [k]: k === "tags" ? el.value.split(",").map(s => s.trim()).filter(Boolean) : (k === "tempo" ? parseFloat(el.value) || null : el.value) });
  });
  $$("#detail [data-r]").forEach(s => s.onclick = () => save(id, { rating: +s.dataset.r === p.rating ? 0 : +s.dataset.r }).then(() => select(id)));
  $("#d-open").onclick = () => api(`/api/open/${id}`, { method: "POST" });
  $("#d-reveal").onclick = () => api(`/api/reveal/${id}`, { method: "POST" });
  $("#d-render").onclick = () => api("/api/render", { method: "POST", body: { ids: [id] } }).catch(e => alert(e.message));
  if ($("#d-analyze")) $("#d-analyze").onclick = () => api("/api/analyze", { method: "POST", body: { ids: [id] } });
  $("#d-remove").onclick = async () => {
    if (!confirm(`„${p.name}“ aus der Liste entfernen?\n\nDie Ableton-Datei bleibt erhalten, ein neuer Scan holt das Projekt nicht zurück.`)) return;
    try { await api(`/api/projects/${id}`, { method: "DELETE" }); } catch (e) { return alert(e.message); }
    $("#detail").innerHTML = `<div class="empty">Wähle ein Projekt aus.</div>`;
    loadProjects(); loadFacets();
  };
  if (p.mp3_path) loadDetailWave(id);
}

async function save(id, values) { await api(`/api/projects/${id}`, { method: "PATCH", body: values }); loadProjects(); loadFacets(); }

async function loadDetailWave(id) {
  const c = $("#dwave"); if (!c) return;
  if (!A.peaks[id]) {
    const buf = await (await fetch(`/audio/${id}`)).arrayBuffer();
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const audio = await ctx.decodeAudioData(buf);
    A.peaks[id] = { ...computePeaks(audio, 40), duration: audio.duration };
  }
  drawDetailWave();
  c.onclick = e => {
    const r = c.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
    if (A.playing !== id) togglePlay(id);
    A.audio.currentTime = f * A.peaks[id].duration;
  };
}
function drawDetailWave() {
  const c = $("#dwave"), pk = A.peaks[A.sel]; if (!c || !pk) return;
  const prog = A.playing === A.sel && A.audio.duration ? A.audio.currentTime / A.audio.duration : null;
  drawOverview(c, pk.peaks, "#ffa940", prog, [], pk);
}

// Kopfzeilen-Aktionen
$("#q").oninput = refresh; $("#tmin").oninput = refresh; $("#tmax").oninput = refresh; $("#sort").onchange = refresh;
$$("#sidebar .item[data-f]").forEach(i => i.onclick = () => {
  $$("#sidebar .item[data-f]").forEach(x => x.classList.toggle("sel", x === i));
  delete A.filters.status; delete A.filters.mp3; delete A.filters.rating;
  if (i.dataset.f !== "all") { const [k, v] = i.dataset.f.split("="); A.filters[k] = v; }
  refresh();
});
$("#btn-reset").onclick = () => { A.filters = {}; $("#q").value = $("#tmin").value = $("#tmax").value = ""; $$("#sidebar .item[data-f]").forEach((x, i) => x.classList.toggle("sel", i === 0)); refresh(); };
$("#btn-scan").onclick = async () => {
  $("#job-text").textContent = "Suche .als-Dateien …";
  $("#job-bar").style.width = "3%"; $("#job-bar").classList.add("indeterminate");
  jobWasRunning = true;
  await api("/api/scan", { method: "POST", body: {} });
  pollNow();
};
$("#btn-render-missing").onclick = async () => {
  const n = +$("#n-nomp3").textContent;
  if (!n) return alert("Alle Projekte haben schon ein MP3.");
  if (confirm(`${n} Projekte nacheinander in Live öffnen und als MP3 exportieren?\n\nLive muss dafür geschlossen sein. Während des Renderns bitte Maus und Tastatur nicht benutzen.`))
    api("/api/render", { method: "POST", body: { missing: true } }).catch(e => alert(e.message));
};
$("#btn-analyze").onclick = () => api("/api/analyze", { method: "POST", body: {} });

$("#btn-settings").onclick = async () => {
  const s = await api("/api/settings");
  $("#s-lang").value = localStorage.getItem("lang") || "";
  $("#s-roots").value = s.roots.join("\n"); $("#s-live").value = s.live_app; $("#s-template").value = s.template; $("#s-newdir").value = s.new_project_dir;
  if ($("#s-autowatch")) $("#s-autowatch").checked = s.auto_watch !== false;
  openModal("#m-settings");
};
if ($("#s-unhide")) $("#s-unhide").onclick = async () => {
  const r = await api("/api/hidden/clear", { method: "POST" });
  alert(`${r.restored} entfernte Projekte kommen beim nächsten Scan zurück.`);
};
$("#s-save").onclick = async () => {
  await api("/api/settings", { method: "POST", body: { roots: $("#s-roots").value.split("\n").map(s => s.trim()).filter(Boolean), live_app: $("#s-live").value, template: $("#s-template").value, new_project_dir: $("#s-newdir").value, auto_watch: $("#s-autowatch") ? $("#s-autowatch").checked : true } });
  if (($("#s-lang").value || "") !== (localStorage.getItem("lang") || "")) { api("/api/settings", { method: "POST", body: { lang: $("#s-lang").value } }); setLang($("#s-lang").value); }
  closeModals();
};
$("#btn-new").onclick = () => { $("#n-error").textContent = ""; openModal("#m-new"); $("#n-name").focus(); };
$("#n-create").onclick = async () => {
  try {
    const p = await api("/api/create", { method: "POST", body: {
      name: $("#n-name").value, tempo: $("#n-tempo").value, key_root: $("#n-key").value, key_mode: $("#n-mode").value,
      genre: $("#n-genre").value, mood: $("#n-mood").value, notes: $("#n-notes").value,
      tags: $("#n-tags").value.split(",").map(s => s.trim()).filter(Boolean) } });
    closeModals(); await loadProjects(); loadFacets(); select(p.id);
  } catch (e) { $("#n-error").textContent = e.message; }
};

jobListeners.push((j, partial) => { loadProjects(); if (!partial) { loadFacets(); if (A.sel) select(A.sel); } });
views.archive = { onShow: () => { loadProjects(); loadFacets(); } };
buildKeys(); loadFacets(); loadProjects();
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key === "f") { e.preventDefault(); $("#q").focus(); }
  if (e.key === "Escape") closeModals();
});
