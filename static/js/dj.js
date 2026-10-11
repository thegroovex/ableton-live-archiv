/* DJ-Modus: 2 Decks, Mixer, Bibliothek, Steuerung per DDJ-FLX4 (Web MIDI) oder Tastatur/Maus */
const DJ = {
  ctx: null, decks: [], lib: [], sel: 0, shift: [false, false], hi: new FLX4.HiRes(),
  xfader: 0.5, headMix: 0.5, midiIn: null, midiOut: null, out4: false, ready: false, quantize: true,
};

// --------------------------------------------------------------- Audio-Grundgerüst
async function djInitAudio() {
  if (DJ.ctx) { if (DJ.ctx.state !== "running") await DJ.ctx.resume(); return; }
  const ctx = DJ.ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.audioWorklet.addModule("/static/js/deck-worklet.js");
  DJ.master = ctx.createGain();
  DJ.cueBus = ctx.createGain();
  DJ.headCue = ctx.createGain(); DJ.headMaster = ctx.createGain();
  DJ.cueBus.connect(DJ.headCue); DJ.master.connect(DJ.headMaster);
  DJ.headBus = ctx.createGain(); DJ.headCue.connect(DJ.headBus); DJ.headMaster.connect(DJ.headBus);
  DJ.decks.forEach(d => d.initAudio());
  applyHeadMix(); applyCrossfader();
  routeOutputs();
  await ctx.resume();
  DJ.ready = true;
  $("#dj-start")?.remove();
}

/* Stereo-Ausgang: nur Master. 4-Kanal-Gerät (FLX4): Master auf 1/2, Kopfhörer auf 3/4 */
function routeOutputs() {
  const ctx = DJ.ctx;
  try { DJ.merger?.disconnect(); DJ.master.disconnect(); DJ.headBus.disconnect(); } catch (e) {}
  DJ.master.connect(DJ.headMaster);
  DJ.out4 = ctx.destination.maxChannelCount >= 4;
  if (DJ.out4) {
    ctx.destination.channelCount = 4;
    ctx.destination.channelCountMode = "explicit";
    ctx.destination.channelInterpretation = "discrete";
    const m = DJ.merger = ctx.createChannelMerger(4);
    const sm = ctx.createChannelSplitter(2), sh = ctx.createChannelSplitter(2);
    DJ.master.connect(sm); DJ.headBus.connect(sh);
    sm.connect(m, 0, 0); sm.connect(m, 1, 1); sh.connect(m, 0, 2); sh.connect(m, 1, 3);
    m.connect(ctx.destination);
  } else {
    DJ.master.connect(ctx.destination);
  }
  $("#midi-status").title = DJ.out4 ? "Kopfhörer-Vorhören aktiv (Kanal 3/4)" : "Stereo-Ausgang: Vorhören nur mit 4-Kanal-Gerät wie dem FLX4";
}

async function listOutputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
  $("#dj-out").innerHTML = `<option value="">Standard-Ausgang</option>` +
    devs.filter(d => d.deviceId !== "default").map((d, i) => `<option value="${d.deviceId}">${esc(d.label || "Ausgang " + (i + 1))}</option>`).join("");
  const flx = devs.find(d => /flx4|ddj/i.test(d.label));
  if (flx && !$("#dj-out").dataset.touched) { $("#dj-out").value = flx.deviceId; setOutput(flx.deviceId); }
}
async function setOutput(id) {
  await djInitAudio();
  if (DJ.ctx.setSinkId) { await DJ.ctx.setSinkId(id || ""); routeOutputs(); }
  else alert("Ausgabegerät wählen geht nur in Chrome/Edge. Alternativ in den macOS-Toneinstellungen den FLX4 wählen.");
}
$("#dj-out").onchange = e => { e.target.dataset.touched = 1; setOutput(e.target.value); };

// --------------------------------------------------------------- Deck
class Deck {
  constructor(i) {
    this.i = i; this.color = i ? "#5ec8e0" : "#ffa940";
    this.track = null; this.duration = 0; this.peaks = null;
    this.pos = 0; this.playing = false; this.preview = false;
    this.slider = 0.5; this.rangeIdx = 1; this.rate = 1; this.synced = false;
    this.cue = 0; this.cues = Array(8).fill(null); this.loop = null; this.loopIn = null;
    this.eq = { hi: 0.5, mid: 0.5, lo: 0.5 }; this.trim = 0.5; this.vol = 1; this.filter = 0.5; this.pfl = false;
    this.touch = false; this.ticks = 0; this.bendTimer = null;
    this.span = +(localStorage.getItem("dj.zoom" + i) || 6); this.drag = null;
    this.keylock = false; this.autoBeats = 4; this.taps = []; this.nudging = 0; this.saveTimer = null;
    this.el = $(`#deck-${i}`);
    this.render();
  }
  get bpm() { return this.track?.bpm || 0; }
  get grid() { return this.track?.grid_offset || 0; }
  get effBpm() { return this.bpm * this.rate; }

  initAudio() {
    const ctx = DJ.ctx;
    this.node = new AudioWorkletNode(ctx, "deck-processor", { outputChannelCount: [2] });
    this.node.port.onmessage = e => { this.pos = e.data.pos; if (!e.data.playing && this.playing && !this.preview && this.pos >= this.duration - 0.05) this.setPlay(false); };
    this.trimG = ctx.createGain();
    const mk = (type, f) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; return b; };
    this.lo = mk("lowshelf", 220); this.mid = mk("peaking", 1000); this.mid.Q.value = 0.8; this.hiF = mk("highshelf", 4200);
    this.filt = mk("allpass", 1000);
    this.fader = ctx.createGain(); this.xg = ctx.createGain(); this.cueG = ctx.createGain(); this.cueG.gain.value = 0;
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 512; this.meterBuf = new Float32Array(512);
    this.node.connect(this.trimG).connect(this.lo).connect(this.mid).connect(this.hiF).connect(this.filt).connect(this.fader).connect(this.xg).connect(DJ.master);
    this.filt.connect(this.cueG).connect(DJ.cueBus);
    this.fader.connect(this.meter);
    this.applyAll();
    if (this.buffer) this.sendBuffer();
  }
  applyAll() { this.applyEq(); this.applyTrim(); this.applyVol(); this.applyFilter(); this.applyRate(); this.applyPfl(); this.applyKeylock(); }
  applyKeylock() { this.node?.port.postMessage({ type: "keylock", value: this.keylock }); }
  toggleKeylock() { this.keylock = !this.keylock; this.applyKeylock(); this.renderState(); }
  applyEq() { if (!this.lo) return; this.lo.gain.value = DJL.knobToEqDb(this.eq.lo); this.mid.gain.value = DJL.knobToEqDb(this.eq.mid); this.hiF.gain.value = DJL.knobToEqDb(this.eq.hi); }
  applyTrim() { if (this.trimG) this.trimG.gain.value = DJL.trimToGain(this.trim); }
  applyVol() { if (this.fader) this.fader.gain.value = this.vol * this.vol; }
  applyFilter() {
    if (!this.filt) return;
    const p = DJL.filterParams(this.filter);
    if (p.type === "off") { this.filt.type = "allpass"; return; }
    this.filt.type = p.type; this.filt.frequency.setTargetAtTime(p.freq, DJ.ctx.currentTime, 0.01); this.filt.Q.value = p.q;
  }
  applyPfl() { if (this.cueG) this.cueG.gain.value = this.pfl ? 1 : 0; midiLed(FLX4.LED.headCue(this.i, this.pfl)); }
  applyRate() {
    if (!this.synced) this.rate = DJL.sliderToRate(this.slider, DJL.TEMPO_RANGES[this.rangeIdx]);
    this.node?.port.postMessage({ type: "rate", value: this.rate });
  }

  async load(track) {
    await djInitAudio();
    if (this.playing) { if (!confirm(`Deck ${"AB"[this.i]} spielt gerade. Trotzdem laden?`)) return; this.setPlay(false); }
    this.track = track; this.loop = null; this.synced = false; this.cue = 0; this.pos = 0;
    this.render(); this.el.querySelector(".title b").textContent = "Lade …";
    const data = await (await fetch(track.url)).arrayBuffer();
    this.buffer = await DJ.ctx.decodeAudioData(data);
    this.duration = this.buffer.duration;
    this.peaks = computePeaks(this.buffer, 150);
    this.env = null;
    if (!track.bpm) track.bpm = 0;
    if (track.bpm && track.grid_offset == null) this.autoGrid(true);   // noch kein Grid gespeichert → automatisch erkennen
    this.sendBuffer();
    try { this.cues = (await api(`/api/dj/cues/${track.kind}/${track.id}`)).concat(Array(8).fill(null)).slice(0, 8); } catch (e) { this.cues = Array(8).fill(null); }
    this.render(); this.updateLeds(); midiLed(FLX4.LED.loadAnim(this.i));
  }
  sendBuffer() {
    const L = this.buffer.getChannelData(0).slice(), R = this.buffer.numberOfChannels > 1 ? this.buffer.getChannelData(1).slice() : L;
    this.node?.port.postMessage({ type: "load", L, R, sampleRate: this.buffer.sampleRate }, R === L ? [L.buffer] : [L.buffer, R.buffer]);
    this.applyRate();
  }
  seek(sec) { this.pos = DJL.clamp(sec, 0, this.duration); this.node?.port.postMessage({ type: "seek", sec: this.pos }); }
  setPlay(on) {
    if (!this.track) return;
    const o = DJ.decks[1 - this.i];   // Sync + Quantize: beim Start sofort im Takt mit dem anderen Deck
    if (on && !this.playing && this.synced && DJ.quantize && o.playing && o.bpm && this.bpm)
      this.seek(this.pos + DJL.phaseCorrection(this.pos, this.bpm, this.grid, o.pos, o.bpm, o.grid));
    this.playing = on; this.node?.port.postMessage({ type: "play", value: on });
    this.updateLeds(); this.renderState();
  }
  run(actions) {
    for (const a of actions) {
      if ("seek" in a) this.seek(a.seek);
      if ("play" in a) this.setPlay(a.play);
      if ("setCue" in a) this.cue = a.setCue;
      if ("preview" in a) this.preview = a.preview;
    }
    this.renderState();
  }
  cuePress() { if (this.track) this.run(DJL.cuePress({ playing: this.playing, pos: this.pos, cue: this.cue })); }
  cueRelease() { this.run(DJL.cueRelease({ preview: this.preview, cue: this.cue })); }
  hotcue(i, clear) {
    if (!this.track) return;
    if (clear) this.cues[i] = null;
    else { const r = DJL.hotcuePress(this.cues, i, DJ.quantize ? this.loopSnap(this.pos) : this.pos); this.cues = r.cues; this.run(r.actions); }
    api(`/api/dj/cues/${this.track.kind}/${this.track.id}`, { method: "PUT", body: this.cues }).catch(() => {});
    this.updateLeds(); this.renderPads();
  }
  loopSnap(pos) {  // Hot Cues auf den nächsten Beat einrasten (Quantize)
    if (!this.bpm) return pos;
    const period = 60 / this.bpm;
    return Math.max(0, this.grid + Math.round((pos - this.grid) / period) * period);
  }
  setLoop(l) {
    if (l) this.lastLoop = l;
    this.loop = l; this.node?.port.postMessage({ type: "loop", start: l?.start ?? null, end: l?.end ?? null });
    if (l && this.pos >= l.end) this.seek(l.start + ((this.pos - l.start) % (l.end - l.start)));
    if (l) this.loopIn = null;
    midiLed(FLX4.LED.loop(this.i, !!l)); this.renderState();
  }
  q(pos) { return DJ.quantize ? DJL.snapToBeat(pos, this.bpm, this.grid) : pos; }
  beatloop(beats) {
    if (!this.track) return;
    if (this.loop && Math.abs((this.loop.end - this.loop.start) - beats * 60 / (this.bpm || 120)) < 1e-3) return this.setLoop(null);
    this.autoBeats = beats;
    this.setLoop(DJL.beatLoop(this.pos, this.bpm, this.grid, beats, DJ.quantize));
  }
  autoLoop() { if (this.loop) this.setLoop(null); else this.beatloop(this.autoBeats); }
  /* CDJ: IN setzt den Startpunkt (im Loop: verschiebt ihn), OUT schließt den Loop (im Loop: verschiebt das Ende) */
  loopInPress() {
    if (!this.track) return;
    const p = this.q(this.pos);
    if (this.loop) { if (p < this.loop.end - 0.02) this.setLoop({ start: p, end: this.loop.end }); return; }
    this.loopIn = p; this.renderState();
  }
  loopOutPress() {
    if (!this.track) return;
    const p = this.q(this.pos);
    if (this.loop) { if (p > this.loop.start + 0.02) this.setLoop({ start: this.loop.start, end: p }); return; }
    if (this.loopIn != null && p > this.loopIn + 0.02) this.setLoop({ start: this.loopIn, end: p });
  }
  reloop() { if (this.loop) this.setLoop(null); else if (this.lastLoop) { this.setLoop(this.lastLoop); this.seek(this.lastLoop.start); } }
  loopHalve() { if (this.loop) this.setLoop(DJL.loopHalve(this.loop)); else { this.autoBeats = Math.max(1 / 32, this.autoBeats / 2); this.renderState(); } }
  loopDouble() { if (this.loop) this.setLoop(DJL.loopDouble(this.loop, this.duration)); else { this.autoBeats = Math.min(64, this.autoBeats * 2); this.renderState(); } }
  loopMove(dir) {
    if (!this.loop) return;
    const rel = this.pos - this.loop.start, l = DJL.loopMove(this.loop, dir);
    this.setLoop(l); this.seek(l.start + Math.max(0, rel));
  }

  // ---- Beatgrid
  saveGrid(silent = false) {
    this.track.grid_offset = DJL.normGrid(this.grid, this.bpm);
    this.renderState();
    clearTimeout(this.saveTimer);
    const t = this.track;
    this.saveTimer = setTimeout(() => api(`/api/dj/grid/${t.kind}/${t.id}`, { method: "PATCH", body: { bpm: t.bpm, grid_offset: t.grid_offset } })
      .then(() => { const l = DJ.lib?.find(x => x.uid === t.uid); if (l) { l.bpm = t.bpm; l.grid_offset = t.grid_offset; } if (!silent) toast?.("Beatgrid gespeichert"); }).catch(() => {}), 600);
  }
  gridShift(ms) { if (!this.track || !this.bpm) return; this.track.grid_offset = this.grid + ms / 1000; this.saveGrid(); }
  gridHere() { if (!this.track || !this.bpm) return; this.track.grid_offset = DJL.gridFromDownbeat(this.pos, this.bpm); this.saveGrid(); }
  setBpm(v) {
    if (!this.track || !(v > 20 && v < 400)) return;
    const old = this.bpm, oldGrid = this.grid;
    const anchor = old ? DJL.snapToBeat(this.pos, old, oldGrid) : this.pos;   // Beat unter dem Abspielkopf und Taktzählung bleiben stehen
    this.track.bpm = Math.round(v * 100) / 100;
    this.track.grid_offset = DJL.regrid(anchor, old, oldGrid, this.track.bpm);
    this.saveGrid();
  }
  /* Beatgrid automatisch aus dem Audio: Phase über den ganzen Track, erster Einsatz = Takt 1 */
  autoGrid(silent = false) {
    if (!this.track || !this.bpm || !this.buffer) return;
    if (!this.env) { const b = this.buffer; this.env = Wave.onsetEnvelope(b.getChannelData(0), b.numberOfChannels > 1 ? b.getChannelData(1) : null, b.sampleRate); }
    const r = DJL.detectGrid(this.env.flux, this.env.rms, this.env.hop, this.bpm);
    this.track.grid_offset = r.grid;
    this.saveGrid(silent);
    if (!silent) toast?.(`Beatgrid erkannt – Takt 1 bei ${r.grid.toFixed(3)} s`);
  }
  setZoom(span) {
    this.span = DJL.clamp(span, 1, 32);
    localStorage.setItem("dj.zoom" + this.i, this.span);
    const z = this.el.querySelector("[data-zoomlbl]"); if (z) z.textContent = this.span < 10 ? this.span.toFixed(1) + " s" : Math.round(this.span) + " s";
  }
  tap() {
    const now = performance.now() / 1000;
    this.taps.push(now); this.taps = this.taps.slice(-9);
    const bpm = DJL.tapTempo(this.taps);
    const b = this.el.querySelector("[data-tap]"); if (b) b.textContent = bpm ? "TAP " + bpm.toFixed(1) : "TAP …";
    if (bpm) { clearTimeout(this.tapTimer); this.tapTimer = setTimeout(() => { this.setBpm(bpm); b.textContent = "TAP"; }, 1500); }
  }

  // ---- Tempo & Beatmatching
  nudge(dir, on) {  // wie Pitch-Bend-Tasten: solange gehalten ±4 %
    this.nudging = on ? dir : 0;
    clearTimeout(this.bendTimer);
    this.node?.port.postMessage({ type: "bend", value: on ? dir * 0.04 : 0 });
  }
  pitchStep(step) {
    const range = DJL.TEMPO_RANGES[this.rangeIdx];
    const v = DJL.clamp(this.slider + step / (2 * range), 0, 1);
    const s = this.el.querySelector("[data-slider]"); if (s) s.value = v;
    if (this.synced) { this.synced = false; midiLed(FLX4.LED.sync(this.i, false)); }
    this.setSlider(v);
  }
  beatjump(b) { this.seek(DJL.beatJump(this.pos, this.bpm, b)); }
  sync() {
    const other = DJ.decks[1 - this.i];
    if (this.synced) { this.synced = false; this.applyRate(); this.renderState(); midiLed(FLX4.LED.sync(this.i, false)); return; }
    if (!this.bpm || !other.track || !other.bpm) return;
    this.synced = true;
    this.rate = DJL.syncRate(this.bpm, other.effBpm); this.applyRate();
    if (other.playing) this.seek(this.pos + DJL.phaseCorrection(this.pos, this.bpm, this.grid, other.pos, other.bpm, other.grid));
    midiLed(FLX4.LED.sync(this.i, true)); this.renderState();
  }
  setSlider(v) { this.slider = v; if (this.synced && Math.abs(DJL.sliderToRate(v, DJL.TEMPO_RANGES[this.rangeIdx]) - this.rate) > 0.002) { this.synced = false; midiLed(FLX4.LED.sync(this.i, false)); } this.applyRate(); this.renderState(); }
  cycleRange() { this.rangeIdx = (this.rangeIdx + 1) % DJL.TEMPO_RANGES.length; this.applyRate(); this.renderState(); }
  bend(amount) {
    this.node?.port.postMessage({ type: "bend", value: amount });
    clearTimeout(this.bendTimer);
    this.bendTimer = setTimeout(() => this.node?.port.postMessage({ type: "bend", value: 0 }), 70);
  }
  jogTouch(on) {
    this.touch = on;
    if (on && this.track) {
      this.ticks = 0; this.node?.port.postMessage({ type: "scratch", on: true });
      clearInterval(this.scratchTimer);
      this.scratchTimer = setInterval(() => { this.node?.port.postMessage({ type: "scratchVel", value: DJL.scratchVelocity(this.ticks, 0.012) }); this.ticks = 0; }, 12);
    } else { clearInterval(this.scratchTimer); this.node?.port.postMessage({ type: "scratch", on: false }); }
  }
  jogTurn(delta) { if (this.touch) this.ticks += delta; else this.bend(DJL.clamp(delta * 0.004, -0.3, 0.3)); }
  updateLeds() {
    midiLed(FLX4.LED.play(this.i, this.playing));
    midiLed(FLX4.LED.cue(this.i, !!this.track));
    this.cues.forEach((c, i) => midiLed(FLX4.LED.hotcue(this.i, i, c != null)));
  }

  // ---- Darstellung
  render() {
    const t = this.track, L = "AB"[this.i];
    this.el.innerHTML = `
      <div class="title"><span class="letter">${L}</span><b ${t ? "data-noi18n" : ""}>${esc(t ? t.title : "Kein Track geladen")}</b><span class="timeinfo" data-time>–</span></div>
      <div class="meta"><span>${esc(t?.artist || "")}</span><span>${t ? keyLabel(t.key_root, t.key_mode) + " " + camelot(t.key_root, t.key_mode) : ""}</span><span>${esc(t?.genre || "")}</span></div>
      <div class="bpmrow">
        <div class="bigbpm" data-bpm>–<small>BPM</small></div>
        <div class="ratebox"><span class="timeinfo" data-rate></span><button class="btn small" data-mt title="Master Tempo: Tonhöhe bleibt beim Pitchen gleich">MT</button></div>
        <canvas class="phase" title="Takt (1–4) und Versatz zum anderen Deck"></canvas>
      </div>
      <div class="zoomwrap"><canvas class="zoom" title="Ziehen: Position verschieben (Shift = fein) · Mausrad: Zoom · Doppelklick: Cue setzen"></canvas>
        <div class="zoombtns"><button class="btn small" data-zoom="0.5" title="Hineinzoomen">＋</button><span class="zoomlbl" data-zoomlbl></span><button class="btn small" data-zoom="2" title="Herauszoomen">－</button></div></div>
      <canvas class="overview"></canvas>
      <div class="transport">
        <button class="round cue" data-cue>CUE</button><button class="round" data-play>▶❚❚</button>
        <button class="btn small" data-sync>SYNC</button>
        <button class="btn small" data-nudge="-1" title="Bremsen (halten)">◀ −</button><button class="btn small" data-nudge="1" title="Schieben (halten)">+ ▶</button>
        <button class="btn small" data-jump="-4" title="4 Beats zurück">⇤4</button><button class="btn small" data-jump="4" title="4 Beats vor">4⇥</button>
      </div>
      <div class="looprow">
        <span class="lbl">Loop</span>
        <button class="btn small" data-lin>IN</button><button class="btn small" data-lout>OUT</button><button class="btn small" data-reloop>RELOOP/EXIT</button>
        <button class="btn small" data-lhalf>½X</button><button class="btn small" data-ldbl>2X</button>
        <span class="looplen" data-looplen>4</span>
        <div class="loopbtns">${[1, 2, 4, 8, 16, 32].map(b => `<button class="btn small" data-bl="${b}">${b}</button>`).join("")}</div>
      </div>
      <div class="gridrow">
        <span class="lbl">Grid</span>
        <button class="btn small" data-gs="-10" title="Grid 10 ms früher (Shift: 1 ms)">◀</button><button class="btn small" data-gs="10" title="Grid 10 ms später (Shift: 1 ms)">▶</button>
        <button class="btn small" data-gauto title="Beatgrid automatisch erkennen (erster Einsatz = Takt 1)">AUTO</button>
        <button class="btn small" data-ghere title="Takt-1 genau an die Abspielposition legen">Beat hier</button>
        <button class="btn small" data-bpmx="0.5">÷2</button><button class="btn small" data-bpmx="2">×2</button>
        <button class="btn small" data-bpmd="-0.01">−.01</button><input class="field bpmin" data-bpmin value="${this.bpm ? this.bpm.toFixed(2) : ""}" placeholder="BPM"><button class="btn small" data-bpmd="0.01">+.01</button>
        <button class="btn small" data-tap>TAP</button>
      </div>
      <div class="pads">${this.cues.map((c, i) => `<button class="pad" data-hc="${i}">${i + 1}</button>`).join("")}</div>
      <div class="tempo"><button class="btn small" data-range>±10%</button><button class="btn small" data-pstep="-0.0005" title="Tempo −0,05 %">−</button><input type="range" min="0" max="1" step="0.0005" value="${this.slider}" data-slider title="Tempo (nach unten = schneller)"><button class="btn small" data-pstep="0.0005" title="Tempo +0,05 %">+</button><button class="btn small" data-reset>0</button></div>`;
    const q = s => this.el.querySelector(s);
    const hold = (el, down, up) => { el.onmousedown = down; el.onmouseup = up; el.onmouseleave = () => { if (el._down) up(); }; el.addEventListener("mousedown", () => el._down = true); el.addEventListener("mouseup", () => el._down = false); };
    q("[data-play]").onclick = () => { djInitAudio(); this.setPlay(!this.playing); };
    q("[data-cue]").onmousedown = () => this.cuePress(); q("[data-cue]").onmouseup = () => this.cueRelease();
    q("[data-sync]").onclick = () => this.sync();
    q("[data-mt]").onclick = () => this.toggleKeylock();
    q("[data-range]").onclick = () => this.cycleRange();
    q("[data-slider]").oninput = e => this.setSlider(+e.target.value);
    q("[data-reset]").onclick = () => { q("[data-slider]").value = 0.5; this.setSlider(0.5); };
    this.el.querySelectorAll("[data-pstep]").forEach(b => b.onclick = () => this.pitchStep(+b.dataset.pstep));
    this.el.querySelectorAll("[data-nudge]").forEach(b => hold(b, () => this.nudge(+b.dataset.nudge, true), () => this.nudge(0, false)));
    this.el.querySelectorAll("[data-bl]").forEach(b => b.onclick = () => this.beatloop(+b.dataset.bl));
    this.el.querySelectorAll("[data-jump]").forEach(b => b.onclick = () => this.beatjump(+b.dataset.jump));
    q("[data-lin]").onclick = () => this.loopInPress(); q("[data-lout]").onclick = () => this.loopOutPress();
    q("[data-reloop]").onclick = () => this.reloop(); q("[data-lhalf]").onclick = () => this.loopHalve(); q("[data-ldbl]").onclick = () => this.loopDouble();
    this.el.querySelectorAll("[data-gs]").forEach(b => b.onclick = e => this.gridShift(+b.dataset.gs / (e.shiftKey ? 10 : 1)));
    q("[data-ghere]").onclick = () => this.gridHere();
    q("[data-gauto]").onclick = () => this.autoGrid();
    this.el.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => this.setZoom(this.span * +b.dataset.zoom));
    this.el.querySelectorAll("[data-bpmx]").forEach(b => b.onclick = () => this.setBpm(this.bpm * +b.dataset.bpmx));
    this.el.querySelectorAll("[data-bpmd]").forEach(b => b.onclick = () => this.setBpm(this.bpm + +b.dataset.bpmd));
    q("[data-bpmin]").onchange = e => this.setBpm(parseFloat(e.target.value.replace(",", ".")));
    q("[data-tap]").onclick = () => this.tap();
    this.el.querySelectorAll("[data-hc]").forEach(b => b.onclick = e => this.hotcue(+b.dataset.hc, e.shiftKey));
    q(".overview").onclick = e => { const r = e.target.getBoundingClientRect(); this.seek((e.clientX - r.left) / r.width * this.duration); };
    this.phaseC = q(".phase");
    this.zoomC = q(".zoom"); this.ovC = q(".overview");
    this.bindZoom(); this.setZoom(this.span);
    this.renderPads(); this.renderState();
  }
  /* Scroll-Wellenform: ziehen wie ein Jogwheel, Mausrad zoomt, Doppelklick setzt den Cue */
  bindZoom() {
    const c = this.zoomC;
    c.addEventListener("wheel", e => { e.preventDefault(); this.setZoom(this.span * Math.pow(1.15, Math.sign(e.deltaY))); }, { passive: false });
    c.addEventListener("pointerdown", e => {
      if (!this.track || e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, pos: this.pos, moved: false };
      c.classList.add("dragging");
    });
    c.addEventListener("pointermove", e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x; if (Math.abs(dx) > 2) this.drag.moved = true;
      const fine = e.shiftKey ? 0.25 : 1;
      this.seek(this.drag.pos - dx / c.clientWidth * this.span * fine);
    });
    const end = () => { if (!this.drag) return; this.drag = null; c.classList.remove("dragging"); };
    c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", () => {
      if (!this.track || this.playing) return;
      this.cue = this.pos;   // bewusst ohne Quantize: genau dort, wo die Wellenform steht this.renderState(); toast?.("Cue gesetzt");
    });
  }
  renderPads() { this.el.querySelectorAll("[data-hc]").forEach(b => b.classList.toggle("set", this.cues[+b.dataset.hc] != null)); }
  renderState() {
    const q = s => this.el.querySelector(s); if (!q("[data-play]")) return;
    q("[data-play]").classList.toggle("on", this.playing);
    q("[data-cue]").classList.toggle("on", !!this.track && !this.playing);
    q("[data-sync]").classList.toggle("on", this.synced);
    q("[data-range]").textContent = "±" + Math.round(DJL.TEMPO_RANGES[this.rangeIdx] * 100) + "%";
    q("[data-bpm]").innerHTML = (this.bpm ? this.effBpm.toFixed(2) : "–") + "<small>BPM</small>";
    q("[data-rate]").textContent = ((this.rate - 1) * 100 >= 0 ? "+" : "") + ((this.rate - 1) * 100).toFixed(2) + "%";
    this.el.querySelectorAll("[data-bl]").forEach(b => b.classList.toggle("on", !!this.loop && this.bpm && Math.abs((this.loop.end - this.loop.start) - b.dataset.bl * 60 / this.bpm) < 1e-3));
    q("[data-mt]").classList.toggle("on", this.keylock);
    q("[data-reloop]").classList.toggle("on", !!this.loop);
    q("[data-lin]").classList.toggle("on", this.loopIn != null || !!this.loop);
    q("[data-lout]").classList.toggle("on", !!this.loop);
    const beats = this.loop ? DJL.loopBeats(this.loop, this.bpm) : this.autoBeats;
    q("[data-looplen]").textContent = (this.loop ? "● " : "") + DJL.loopLabel(beats) + (this.bpm ? " Beats" : "");
    q("[data-looplen]").classList.toggle("on", !!this.loop);
    const bi = q("[data-bpmin]"); if (bi && document.activeElement !== bi) bi.value = this.bpm ? this.bpm.toFixed(2) : "";
  }
  /* Takt-Anzeige (1–4) und Phasen-Versatz zum anderen Deck, wie die Beat-Bars am CDJ */
  drawPhase() {
    const c = this.phaseC; if (!c) return;
    const dpr = devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w) c.width = w; if (c.height !== h) c.height = h;
    const g = c.getContext("2d"); g.clearRect(0, 0, w, h);
    if (!this.track || !this.bpm) return;
    const bb = DJL.barBeat(this.pos, this.bpm, this.grid), bw = w / 4, bh = h * 0.42;
    for (let k = 0; k < 4; k++) { g.fillStyle = k + 1 === bb.beat ? this.color : "#333"; g.fillRect(k * bw + 1, 0, bw - 2, bh); }
    g.fillStyle = "#999"; g.font = `${9 * dpr}px sans-serif`; g.fillText(`Takt ${Math.max(1, bb.bar)}`, 2, h - 2);
    const o = DJ.decks[1 - this.i];
    if (o.track && o.bpm && (this.playing || o.playing)) {
      const off = DJL.phaseOffset(this.pos, this.bpm * 1, this.grid, o.pos, o.bpm, o.grid);  // Beats
      const ms = off * 60000 / this.effBpm, y = bh + 3, mh = h * 0.2;
      g.fillStyle = "#2a2a2a"; g.fillRect(0, y, w, mh);
      g.fillStyle = "#666"; g.fillRect(w / 2 - dpr / 2, y, dpr, mh);
      const ok = Math.abs(ms) < 8;
      g.fillStyle = ok ? "#8fd36f" : Math.abs(ms) < 25 ? "#ffd166" : "#ff5f56";
      g.fillRect(w / 2 + off * w - 2 * dpr, y, 4 * dpr, mh);
      g.textAlign = "right"; g.fillText((ms >= 0 ? "+" : "") + ms.toFixed(0) + " ms", w - 2, h - 2); g.textAlign = "left";
    }
  }
  draw() {
    const time = this.el.querySelector("[data-time]");
    if (time) time.textContent = this.track ? `${fmtTime(this.pos)} / -${fmtTime(this.duration - this.pos)}` : "–";
    this.drawPhase();
    if (!this.peaks) return;
    drawOverview(this.ovC, this.peaks.peaks, this.color, this.pos / this.duration, this.cues.map(c => c == null ? null : c / this.duration), this.peaks);
    // Scroll-Wellenform: ±3 s um die Abspielposition
    const c = this.zoomC, dpr = devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w) c.width = w; if (c.height !== h) c.height = h;
    const g = c.getContext("2d"); g.clearRect(0, 0, w, h);
    const span = this.span, ps = this.peaks.perSecond, start = this.pos - span / 2, mid = h / 2, pk = this.peaks.peaks;
    if (this.loop) { const x0 = (this.loop.start - start) / span * w, x1 = (this.loop.end - start) / span * w; g.fillStyle = "rgba(143,211,111,.18)"; g.fillRect(x0, 0, x1 - x0, h); g.fillStyle = "#8fd36f"; g.fillRect(x0, 0, 2 * dpr, h); g.fillRect(x1 - 2 * dpr, 0, 2 * dpr, h); }
    else if (this.loopIn != null) { const x0 = (this.loopIn - start) / span * w; g.fillStyle = "#8fd36f"; g.fillRect(x0, 0, 2 * dpr, h); }
    for (let x = 0; x < w; x += 2) {
      const tsec = start + x / w * span, idx = Math.floor(tsec * ps);
      if (idx < 0 || idx >= pk.length) continue;
      const v = pk[idx], bd = this.peaks; g.fillStyle = Wave.bandColor(bd.low[idx], bd.mid[idx], bd.high[idx], tsec < this.pos ? 0.5 : 1);
      g.fillRect(x, mid - v * mid * 0.95, 2, Math.max(1, v * h * 0.95));
    }
    if (this.bpm) {
      const period = 60 / this.bpm; let b = Math.ceil((start - this.grid) / period);
      for (let t = this.grid + b * period; t < start + span; t += period, b++) {
        const x = (t - start) / span * w; const bar = ((b % 4) + 4) % 4 === 0; g.fillStyle = bar ? "rgba(255,80,80,.8)" : "rgba(255,255,255,.22)"; g.fillRect(x, 0, bar ? 2 * dpr : dpr, h);
      }
    }
    this.cues.forEach((cu, i) => { if (cu == null) return; const x = (cu - start) / span * w; if (x < 0 || x > w) return; g.fillStyle = "#ff5f56"; g.fillRect(x, 0, 2 * dpr, h); g.font = `${10 * dpr}px sans-serif`; g.fillText(i + 1, x + 3, 11 * dpr); });
    { const x = (this.cue - start) / span * w; if (x >= 0 && x <= w) { g.fillStyle = "#ffa940"; g.beginPath(); g.moveTo(x - 6 * dpr, 0); g.lineTo(x + 6 * dpr, 0); g.lineTo(x, 8 * dpr); g.fill(); g.fillRect(x - dpr / 2, 0, dpr, h); } }
    g.fillStyle = "#fff"; g.fillRect(w / 2 - dpr, 0, 2 * dpr, h);
  }
  level() {
    if (!this.meter) return 0;
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let m = 0; for (const v of this.meterBuf) m = Math.max(m, Math.abs(v));
    return Math.min(1, m);
  }
}

// --------------------------------------------------------------- Mixer
function knobHtml(id, label, cls) { return `<div class="col ${cls}"><div class="knob" data-k="${id}"></div><span class="lbl">${label}</span></div>`; }
function renderMixer() {
  $("#mixer").innerHTML = `
    ${knobHtml("0.trim", "Trim", "a")}${knobHtml("1.trim", "Trim", "b")}
    ${knobHtml("0.hi", "Hi", "a")}${knobHtml("1.hi", "Hi", "b")}
    ${knobHtml("0.mid", "Mid", "a")}${knobHtml("1.mid", "Mid", "b")}
    ${knobHtml("0.lo", "Low", "a")}${knobHtml("1.lo", "Low", "b")}
    ${knobHtml("0.filter", "Filter", "a")}${knobHtml("1.filter", "Filter", "b")}
    <div class="col a"><button class="btn cuebtn" data-pfl="0">🎧 CUE</button></div><div class="col b"><button class="btn cuebtn" data-pfl="1">🎧 CUE</button></div>
    <div class="col a" style="flex-direction:row;justify-content:center"><input type="range" class="vfader" min="0" max="1" step="0.001" value="1" data-vol="0"><div class="meter"><div id="vu0"></div></div></div>
    <div class="col b" style="flex-direction:row;justify-content:center"><div class="meter"><div id="vu1"></div></div><input type="range" class="vfader" min="0" max="1" step="0.001" value="1" data-vol="1"></div>
    <div class="xfader"><input type="range" min="0" max="1" step="0.001" value="0.5" id="xf"><span class="lbl">Crossfader</span></div>
    <div class="xfader">${knobHtml("head", "Cue/Master (Kopfhörer)", "")}</div>`;
  $$("#mixer [data-vol]").forEach(f => f.oninput = () => { const d = DJ.decks[+f.dataset.vol]; d.vol = +f.value; d.applyVol(); });
  $("#xf").oninput = e => { DJ.xfader = +e.target.value; applyCrossfader(); };
  $$("#mixer [data-pfl]").forEach(b => b.onclick = () => togglePfl(+b.dataset.pfl));
  $$("#mixer .knob").forEach(k => {
    k.onmousedown = e => {
      const y0 = e.clientY, v0 = getKnob(k.dataset.k);
      const move = ev => setKnob(k.dataset.k, DJL.clamp(v0 + (y0 - ev.clientY) / 150, 0, 1));
      const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); };
      addEventListener("mousemove", move); addEventListener("mouseup", up);
    };
    k.ondblclick = () => setKnob(k.dataset.k, 0.5);
  });
  updateKnobs();
}
function getKnob(id) {
  if (id === "head") return DJ.headMix;
  const [i, p] = id.split("."), d = DJ.decks[+i];
  return p === "trim" ? d.trim : p === "filter" ? d.filter : d.eq[p];
}
function setKnob(id, v) {
  if (id === "head") { DJ.headMix = v; applyHeadMix(); }
  else {
    const [i, p] = id.split("."), d = DJ.decks[+i];
    if (p === "trim") { d.trim = v; d.applyTrim(); } else if (p === "filter") { d.filter = v; d.applyFilter(); } else { d.eq[p] = v; d.applyEq(); }
  }
  updateKnobs();
}
function updateKnobs() { $$("#mixer .knob").forEach(k => k.style.setProperty("--rot", (getKnob(k.dataset.k) - 0.5) * 270 + "deg")); }
function applyCrossfader() { const [a, b] = DJL.crossfaderGains(DJ.xfader); if (DJ.decks[0].xg) { DJ.decks[0].xg.gain.value = a; DJ.decks[1].xg.gain.value = b; } if ($("#xf")) $("#xf").value = DJ.xfader; }
function applyHeadMix() { if (DJ.headCue) { DJ.headCue.gain.value = Math.cos(DJ.headMix * Math.PI / 2); DJ.headMaster.gain.value = Math.sin(DJ.headMix * Math.PI / 2); } }
function togglePfl(i) { const d = DJ.decks[i]; d.pfl = !d.pfl; d.applyPfl(); $(`[data-pfl="${i}"]`).classList.toggle("on", d.pfl); }

// --------------------------------------------------------------- Bibliothek + Crates/Playlists (wie Serato DJ Pro)
DJ.view = { type: "all" };   // all | src (Live/Import) | pl (Playlist-ID)
DJ.playlists = []; DJ.selUids = new Set(); DJ.sel = 0;
async function loadLibrary() {
  [DJ.lib, DJ.playlists] = await Promise.all([api("/api/dj/library"), api("/api/dj/playlists").catch(() => [])]);
  if (DJ.view.type === "pl" && !DJ.playlists.some(p => p.id === DJ.view.id)) DJ.view = { type: "all" };
  renderCrates(); renderLibrary();
}
async function loadPlaylists() { DJ.playlists = await api("/api/dj/playlists"); renderCrates(); }
const curPlaylist = () => DJ.view.type === "pl" ? DJ.playlists.find(p => p.id === DJ.view.id) : null;
function visibleLib() {
  let list;
  const pl = curPlaylist();
  if (pl) { const by = new Map(DJ.lib.map(t => [t.uid, t])); list = pl.items.map(u => by.get(u)).filter(Boolean); }
  else list = DJ.lib.filter(t => DJ.view.type !== "src" || t.source === DJ.view.src);
  const q = ($("#dj-q")?.value || "").trim().toLowerCase();
  if (q) list = list.filter(t => [t.title, t.artist, t.genre, t.mood, (t.tags || []).join(" "), t.notes, keyLabel(t.key_root, t.key_mode), camelot(t.key_root, t.key_mode), t.bpm ? Math.round(t.bpm) : ""].join(" ").toLowerCase().includes(q));
  return list;
}

function renderCrates() {
  const n = src => DJ.lib.filter(t => !src || t.source === src).length;
  const v = DJ.view, item = (sel, attrs, icon, name, count, extra = "") =>
    `<div class="crate${sel ? " sel" : ""}" ${attrs}><span class="ci">${icon}</span><span class="cn">${esc(name)}</span><span class="n">${count}</span>${extra}</div>`;
  $("#crates-fixed").innerHTML =
    item(v.type === "all", 'data-view="all"', "♫", "Alle Tracks", n()) +
    item(v.type === "src" && v.src === "Live", 'data-view="src" data-src="Live"', "◆", "Live-Renderings", n("Live")) +
    item(v.type === "src" && v.src === "Import", 'data-view="src" data-src="Import"', "⤓", "Importiert", n("Import"));
  $("#pl-list").innerHTML = DJ.playlists.map(p => item(v.type === "pl" && v.id === p.id, `data-view="pl" data-pl="${p.id}" draggable="true" title="Doppelklick: umbenennen · Tracks hierher ziehen"`, "▤", p.name, p.count,
    `<button class="cx" data-pldel="${p.id}" title="Playlist löschen">✕</button>`)).join("") ||
    `<div class="crate-empty">Noch keine Playlists. Lege eine an oder ziehe Tracks auf „+ Playlist“.</div>`;
}

function renderLibrary() {
  const list = visibleLib(), pl = curPlaylist();
  DJ.sel = DJL.clamp(DJ.sel, 0, Math.max(0, list.length - 1));
  const playing = DJ.decks.find(d => d.playing && d.track)?.track;
  const ref = playing ? camelot(playing.key_root, playing.key_mode) : null;
  const loaded = new Set(DJ.decks.map(d => d.track?.uid).filter(Boolean));
  $("#djcount").textContent = pl ? `${esc(pl.name)} · ${list.length} Tracks` : `${list.length} Tracks`;
  $("#djlist").classList.toggle("in-pl", !!pl);
  $("#djlist tbody").innerHTML = list.map((t, i) => {
    const cam = camelot(t.key_root, t.key_mode), fit = ref && DJL.camelotCompatible(ref, cam);
    const cls = [i === DJ.sel ? "cursor" : "", DJ.selUids.has(t.uid) || (i === DJ.sel && !DJ.selUids.size) ? "sel" : "", loaded.has(t.uid) ? "loaded" : ""].join(" ");
    return `<tr data-i="${i}" data-uid="${t.uid}" class="${cls}" draggable="true">
      <td class="mono num">${pl ? i + 1 : ""}</td>
      <td data-noi18n>${esc(t.title)}</td><td class="wcol"><canvas class="mini" data-djmini="${t.uid}" width="320" height="44" title="Klick: auf das freie Deck laden"></canvas></td><td data-noi18n>${esc(t.artist)}</td><td class="mono">${t.bpm ? (+t.bpm).toFixed(1) : "–"}</td>
      <td class="mono">${keyLabel(t.key_root, t.key_mode)}</td><td class="mono" style="${fit ? "color:var(--green)" : ""}">${cam}${fit ? " ●" : ""}</td>
      <td>${esc(t.genre || "")}</td><td class="mono">${fmtTime(t.duration)}</td><td><span class="badge">${t.source}</span></td>
      <td class="acts"><button class="btn small" data-load="0">A</button> <button class="btn small" data-load="1">B</button> <button class="btn small" data-addpl title="Zu Playlist hinzufügen">＋</button> <button class="btn small" data-tagedit title="Tags bearbeiten (⌘I)">✎</button>${pl ? ` <button class="btn small" data-rm title="Aus Playlist entfernen (Entf)">✕</button>` : ""}</td></tr>`;
  }).join("");
  $("#djempty").hidden = list.length > 0;
  $("#djempty").textContent = pl ? "Diese Playlist ist leer. Ziehe Tracks aus „Alle Tracks“ auf die Playlist links oder nutze ＋ in der Trackliste." : "Keine Tracks gefunden.";
  loadDjMinis();
}

// Mini-Waveforms in der DJ-Liste (gleiche Darstellung wie im Archiv), mit Fortschritt der geladenen Decks
DJ.mini = {};
const djMiniQueue = []; let djMiniBusy = 0;
function loadDjMinis() {
  $$("canvas[data-djmini]").forEach(c => {
    const uid = c.dataset.djmini;
    if (DJ.mini[uid]) drawDjMini(c, uid);
    else if (DJ.mini[uid] !== false && !djMiniQueue.includes(uid)) djMiniQueue.push(uid);
  });
  pumpDjMinis();
}
function pumpDjMinis() {
  while (djMiniBusy < 2 && djMiniQueue.length) {
    const uid = djMiniQueue.shift(), t = DJ.lib.find(x => x.uid === uid); if (!t) continue;
    djMiniBusy++;
    fetch(t.kind === "p" ? `/api/peaks/${t.id}` : `/api/peaks/import/${t.id}`).then(r => r.ok ? r.json() : null).then(d => {
      DJ.mini[uid] = d || false;
      if (d) drawDjMini($(`canvas[data-djmini="${uid}"]`), uid);
    }).catch(() => { DJ.mini[uid] = false; }).finally(() => { djMiniBusy--; pumpDjMinis(); });
  }
}
function drawDjMini(c, uid) {
  if (!c || !DJ.mini[uid]) return;
  const d = DJ.decks.find(x => x.track?.uid === uid && x.duration);
  drawMiniWave(c, DJ.mini[uid], d ? d.pos / d.duration : -1);
}

const selectedUids = () => { const list = visibleLib(); return DJ.selUids.size ? list.filter(t => DJ.selUids.has(t.uid)).map(t => t.uid) : (list[DJ.sel] ? [list[DJ.sel].uid] : []); };

// Klick: auswählen (Cmd/Strg = mehrere, Shift = Bereich), Buttons: laden, hinzufügen, entfernen
$("#djlist tbody").addEventListener("click", e => {
  const tr = e.target.closest("tr"); if (!tr) return;
  const i = +tr.dataset.i, uid = tr.dataset.uid, list = visibleLib();
  if (e.target.closest("[data-addpl]")) { DJ.sel = i; if (!DJ.selUids.has(uid)) DJ.selUids.clear(); return playlistMenu(e.target.closest("[data-addpl]"), selectedUids()); }
  if (e.target.closest("[data-tagedit]")) { DJ.sel = i; if (!DJ.selUids.has(uid)) DJ.selUids.clear(); renderLibrary(); return openTagEditor(selectedUids()); }
  if (e.target.closest("[data-rm]")) { DJ.sel = i; if (!DJ.selUids.has(uid)) DJ.selUids.clear(); return removeFromPlaylist(selectedUids()); }
  if (e.metaKey || e.ctrlKey) { if (!DJ.selUids.size && list[DJ.sel]) DJ.selUids.add(list[DJ.sel].uid); DJ.selUids.has(uid) ? DJ.selUids.delete(uid) : DJ.selUids.add(uid); }
  else if (e.shiftKey) { const [a, b] = [Math.min(DJ.sel, i), Math.max(DJ.sel, i)]; DJ.selUids = new Set(list.slice(a, b + 1).map(t => t.uid)); }
  else DJ.selUids.clear();
  DJ.sel = i;
  const mc = e.target.closest("canvas[data-djmini]");
  if (mc) { const free = DJ.decks.find(d => !d.playing) || DJ.decks[0]; free.load(list[i]); }
  const b = e.target.closest("[data-load]");
  if (b) DJ.decks[+b.dataset.load].load(list[i]);
  renderLibrary();
});
$("#djlist tbody").addEventListener("dblclick", e => {
  const tr = e.target.closest("tr"); if (!tr || e.target.closest("button, canvas")) return;
  const free = DJ.decks.find(d => !d.playing) || DJ.decks[0]; free.load(visibleLib()[+tr.dataset.i]);
});
$("#dj-q").addEventListener("input", () => { DJ.sel = 0; DJ.selUids.clear(); renderLibrary(); });
$("#dj-q").addEventListener("keydown", e => { if (e.key === "Escape") { e.target.value = ""; e.target.blur(); renderLibrary(); } });

function browse(delta) {
  DJ.selUids.clear();
  DJ.sel = DJL.clamp(DJ.sel + delta, 0, visibleLib().length - 1); renderLibrary();
  $("#djlist tr.cursor")?.scrollIntoView({ block: "nearest" });
}
function loadSelected(deck) { const t = visibleLib()[DJ.sel]; if (t) DJ.decks[deck].load(t); }

// ---- Crates-Spalte
$("#crates").addEventListener("click", async e => {
  const del = e.target.closest("[data-pldel]");
  if (del) {
    const p = DJ.playlists.find(x => x.id === +del.dataset.pldel);
    if (p && confirm(`Playlist „${p.name}“ löschen? Die Tracks selbst bleiben erhalten.`)) {
      await api(`/api/dj/playlists/${p.id}`, { method: "DELETE" });
      if (DJ.view.type === "pl" && DJ.view.id === p.id) DJ.view = { type: "all" };
      await loadPlaylists(); renderLibrary();
    }
    return;
  }
  const c = e.target.closest("[data-view]"); if (!c || c.querySelector("input")) return;
  DJ.view = c.dataset.view === "pl" ? { type: "pl", id: +c.dataset.pl } : c.dataset.view === "src" ? { type: "src", src: c.dataset.src } : { type: "all" };
  DJ.sel = 0; DJ.selUids.clear(); renderCrates(); renderLibrary();
});
$("#crates").addEventListener("dblclick", e => { const c = e.target.closest("[data-pl]"); if (c) renamePlaylist(+c.dataset.pl, c.querySelector(".cn")); });
$("#pl-add").onclick = () => newPlaylist();

async function newPlaylist(uids = [], open = true) {
  const name = prompt("Name der neuen Playlist:", `Playlist ${DJ.playlists.length + 1}`);
  if (name == null) return null;
  const p = await api("/api/dj/playlists", { method: "POST", body: { name, uids } });
  if (open && !uids.length) { DJ.view = { type: "pl", id: p.id }; DJ.sel = 0; DJ.selUids.clear(); }
  await loadPlaylists(); renderLibrary();
  toast(uids.length ? `${uids.length} Track${uids.length > 1 ? "s" : ""} → „${p.name}“` : `Playlist „${p.name}“ angelegt`);
  return p;
}
function renamePlaylist(id, span) {
  const p = DJ.playlists.find(x => x.id === id); if (!p || !span) return;
  const inp = document.createElement("input"); inp.className = "field crate-edit"; inp.value = p.name;
  span.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async ok => {
    if (done) return; done = true;
    if (ok && inp.value.trim() && inp.value.trim() !== p.name) await api(`/api/dj/playlists/${id}`, { method: "PATCH", body: { name: inp.value.trim() } });
    await loadPlaylists(); renderLibrary();
  };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); };
  inp.onblur = () => finish(true);
}
async function addToPlaylist(id, uids, index) {
  if (!uids.length) return;
  const p = DJ.playlists.find(x => x.id === id);
  const before = p ? p.count : 0;
  const r = await api(`/api/dj/playlists/${id}/tracks`, { method: "POST", body: { uids, index } });
  await loadPlaylists(); if (DJ.view.type === "pl") renderLibrary();
  const added = r.items.length - before;
  toast(added ? `${added} Track${added > 1 ? "s" : ""} → „${p?.name}“` : `Schon in „${p?.name}“`);
}
async function removeFromPlaylist(uids) {
  const p = curPlaylist(); if (!p || !uids.length) return;
  const set = new Set(uids);
  await api(`/api/dj/playlists/${p.id}/tracks`, { method: "PUT", body: { uids: p.items.filter(u => !set.has(u)) } });
  DJ.selUids.clear(); await loadPlaylists(); renderLibrary();
}
// Kleines Menü am ＋-Knopf: vorhandene Playlists oder neue
function playlistMenu(anchor, uids) {
  $("#pl-menu")?.remove();
  const m = document.createElement("div"); m.id = "pl-menu"; m.className = "pl-menu";
  m.innerHTML = `<div class="pm-h">Zu Playlist hinzufügen${uids.length > 1 ? ` (${uids.length})` : ""}</div>` +
    DJ.playlists.map(p => `<div class="pm-i" data-to="${p.id}">▤ ${esc(p.name)} <span class="n">${p.count}</span></div>`).join("") +
    `<div class="pm-i pm-new" data-to="new">＋ Neue Playlist …</div>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.min(innerWidth - 230, r.left - 180) + "px";
  m.style.top = (r.bottom + 4 + 260 > innerHeight ? r.top - Math.min(260, m.offsetHeight) - 4 : r.bottom + 4) + "px";
  m.onclick = e => { const it = e.target.closest("[data-to]"); if (!it) return; m.remove(); it.dataset.to === "new" ? newPlaylist(uids, false) : addToPlaylist(+it.dataset.to, uids); };
  setTimeout(() => document.addEventListener("click", function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("click", off); } }), 0);
}

// ---- Drag & Drop: Tracks auf Playlists ziehen, in einer Playlist umsortieren, Playlists sortieren
const DT_TRACKS = "application/x-live-archiv-tracks", DT_PL = "application/x-live-archiv-playlist";
$("#djlist tbody").addEventListener("dragstart", e => {
  const tr = e.target.closest("tr"); if (!tr) return;
  const uid = tr.dataset.uid;
  if (!DJ.selUids.has(uid)) { DJ.selUids.clear(); DJ.sel = +tr.dataset.i; }
  const uids = selectedUids().includes(uid) ? selectedUids() : [uid];
  e.dataTransfer.setData(DT_TRACKS, JSON.stringify(uids));
  e.dataTransfer.effectAllowed = "copyMove";
  const ghost = document.createElement("div"); ghost.className = "drag-ghost"; ghost.textContent = uids.length > 1 ? `${uids.length} Tracks` : tr.children[1].textContent;
  document.body.appendChild(ghost); e.dataTransfer.setDragImage(ghost, 10, 10); setTimeout(() => ghost.remove(), 0);
});
const hasType = (e, t) => [...(e.dataTransfer?.types || [])].includes(t);
$("#djlist tbody").addEventListener("dragover", e => {
  if (!curPlaylist() || !hasType(e, DT_TRACKS)) return;
  e.preventDefault(); e.stopPropagation();
  const tr = e.target.closest("tr"); $$("#djlist tr.drop-before, #djlist tr.drop-after").forEach(x => x.classList.remove("drop-before", "drop-after"));
  if (tr) { const r = tr.getBoundingClientRect(); tr.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after"); }
});
$("#djlist tbody").addEventListener("dragleave", e => { if (!e.currentTarget.contains(e.relatedTarget)) $$("#djlist tr.drop-before, #djlist tr.drop-after").forEach(x => x.classList.remove("drop-before", "drop-after")); });
$("#djlist tbody").addEventListener("drop", async e => {
  const pl = curPlaylist(); if (!pl || !hasType(e, DT_TRACKS)) return;
  e.preventDefault(); e.stopPropagation();
  const tr = e.target.closest("tr"); $$("#djlist tr.drop-before, #djlist tr.drop-after").forEach(x => x.classList.remove("drop-before", "drop-after"));
  const uids = JSON.parse(e.dataTransfer.getData(DT_TRACKS) || "[]");
  let idx = pl.items.length;
  if (tr) { const r = tr.getBoundingClientRect(); idx = pl.items.indexOf(tr.dataset.uid) + (e.clientY < r.top + r.height / 2 ? 0 : 1); }
  const moving = new Set(uids), rest = pl.items.filter(u => !moving.has(u));
  const at = pl.items.slice(0, idx).filter(u => !moving.has(u)).length;
  const order = [...rest.slice(0, at), ...uids, ...rest.slice(at)];
  await api(`/api/dj/playlists/${pl.id}/tracks`, { method: "PUT", body: { uids: order } });
  DJ.selUids = new Set(uids); await loadPlaylists(); renderLibrary();
});
$("#crates").addEventListener("dragstart", e => { const c = e.target.closest("[data-pl]"); if (c) { e.dataTransfer.setData(DT_PL, c.dataset.pl); e.dataTransfer.effectAllowed = "move"; } });
$("#crates").addEventListener("dragover", e => {
  const c = e.target.closest("[data-pl], #pl-add");
  if (!c || !(hasType(e, DT_TRACKS) || (hasType(e, DT_PL) && c.dataset.pl))) return;
  e.preventDefault(); $$("#crates .drop").forEach(x => x !== c && x.classList.remove("drop")); c.classList.add("drop");
});
$("#crates").addEventListener("dragleave", e => { const c = e.target.closest(".drop"); if (c && !c.contains(e.relatedTarget)) c.classList.remove("drop"); });
$("#crates").addEventListener("drop", async e => {
  const c = e.target.closest("[data-pl], #pl-add"); $$("#crates .drop").forEach(x => x.classList.remove("drop"));
  if (!c) return;
  e.preventDefault();
  if (hasType(e, DT_TRACKS)) {
    const uids = JSON.parse(e.dataTransfer.getData(DT_TRACKS) || "[]");
    c.id === "pl-add" ? newPlaylist(uids, false) : addToPlaylist(+c.dataset.pl, uids);
  } else if (hasType(e, DT_PL) && c.dataset.pl) {
    const from = +e.dataTransfer.getData(DT_PL), to = +c.dataset.pl; if (from === to) return;
    const ids = DJ.playlists.map(p => p.id).filter(id => id !== from); ids.splice(ids.indexOf(to), 0, from);
    DJ.playlists = await api("/api/dj/playlists/order", { method: "PUT", body: { ids } }); renderCrates();
  }
});
// Entf/Backspace entfernt markierte Tracks aus der geöffneten Playlist
document.addEventListener("keydown", e => {
  if (!$("#view-dj").classList.contains("active") || e.target.matches("input, textarea, select")) return;
  if ((e.key === "Delete" || e.key === "Backspace") && curPlaylist()) { e.preventDefault(); removeFromPlaylist(selectedUids()); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); $("#dj-q").focus(); }
});

// Import: Ordner-Pfad oder Drag & Drop
// Ordner-Browser: der Browser selbst kennt keine Pfade, deshalb listet der Server die Ordner.
const FS = { path: localStorage.getItem("dj.importDir") || "~" };
async function fsOpen(path) {
  const r = await api("/api/fs/list?path=" + encodeURIComponent(path || "~"));
  FS.path = r.path; FS.parent = r.parent;
  $("#i-path").value = r.path;
  $("#fs-up").disabled = !r.parent;
  $("#fs-places").innerHTML = r.places.map(p => `<div class="fs-place${r.path === p.path ? " sel" : ""}" data-fs="${esc(p.path)}">${esc(p.label)}</div>`).join("");
  $("#fs-list").innerHTML = (r.error ? `<div class="fs-empty">${esc(r.error)}</div>` : "") +
    r.dirs.map(d => `<div class="fs-row dir" data-fs="${esc(d.path)}"><span class="fi">📁</span>${esc(d.name)}</div>`).join("") +
    r.files.map(f => `<div class="fs-row file"><span class="fi">♪</span>${esc(f)}</div>`).join("") +
    (!r.dirs.length && !r.files.length && !r.error ? `<div class="fs-empty">Dieser Ordner ist leer.</div>` : "");
  $("#fs-info").textContent = r.file_count
    ? `${r.file_count} Audiodateien in diesem Ordner${r.already ? `, davon ${r.already} schon importiert` : ""} – Unterordner werden mit eingelesen.`
    : "Keine Audiodateien direkt in diesem Ordner – Unterordner werden mit eingelesen.";
  $("#fs-list").scrollTop = 0;
}
$("#btn-import").onclick = () => { openModal("#m-import"); fsOpen(FS.path).catch(() => fsOpen("~")); };
$("#fs-up").onclick = () => FS.parent && fsOpen(FS.parent);
$("#i-path").addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") fsOpen($("#i-path").value); });
$("#m-import").addEventListener("click", e => { const el = e.target.closest("[data-fs]"); if (el) fsOpen(el.dataset.fs); });
$("#i-go").onclick = async () => {
  localStorage.setItem("dj.importDir", FS.path);
  await api("/api/dj/import", { method: "POST", body: { paths: [FS.path] } }); closeModals();
};

// Analyse im DJ-Tab: markierte Tracks, alle fehlenden oder alle neu
$("#btn-dj-analyze").onclick = e => {
  e.stopPropagation();
  const sel = selectedUids(), missing = DJ.lib.filter(t => !t.analyzed).length;
  $("#pl-menu")?.remove();
  const m = document.createElement("div"); m.id = "pl-menu"; m.className = "pl-menu";
  m.innerHTML = `<div class="pm-h">Analysieren</div>
    <div class="pm-i" data-an="sel">Markierte Tracks <span class="n">${sel.length}</span></div>
    <div class="pm-i" data-an="missing">Alle noch nicht analysierten <span class="n">${missing}</span></div>
    <div class="pm-i" data-an="all">Ganze Bibliothek neu <span class="n">${DJ.lib.length}</span></div>`;
  document.body.appendChild(m);
  const r = e.target.getBoundingClientRect();
  m.style.left = Math.min(innerWidth - 230, r.left) + "px"; m.style.top = (r.bottom + 4) + "px";
  m.onclick = async ev => {
    const it = ev.target.closest("[data-an]"); if (!it) return; m.remove();
    const mode = it.dataset.an;
    if (mode === "all" && !confirm(`Alle ${DJ.lib.length} Tracks neu analysieren? Von dir geänderte Werte bleiben erhalten.`)) return;
    try {
      const res = await api("/api/dj/analyze", { method: "POST", body: mode === "sel" ? { uids: sel } : { mode } });
      toast(res.count ? `Analyse gestartet: ${res.count} Tracks` : "Nichts zu analysieren");
    } catch (err) { toast(err.message); }
  };
  setTimeout(() => document.addEventListener("click", function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("click", off); } }), 0);
};

// Tag-Editor (wie im Archiv), auch für mehrere Tracks auf einmal
const TAG_FIELDS = ["title", "artist", "bpm", "key_root", "key_mode", "genre", "mood", "tags", "notes"];
const MIXED = "‹verschieden›";
let tagEdit = null;
function openTagEditor(uids) {
  const tracks = uids.map(u => DJ.lib.find(t => t.uid === u)).filter(Boolean);
  if (!tracks.length) return toast("Erst einen Track markieren");
  const val = (t, k) => k === "tags" ? (t.tags || []).join(", ") : k === "bpm" ? (t.bpm ? +(+t.bpm).toFixed(2) : "") : (t[k] ?? "");
  tagEdit = { uids: tracks.map(t => t.uid), start: {}, rating: null };
  $("#t-head").textContent = tracks.length > 1 ? `Tags bearbeiten · ${tracks.length} Tracks` : `Tags bearbeiten · ${tracks[0].title}`;
  $('[data-t="key_root"]').innerHTML = `<option value=""></option>` + NOTES.map(n => `<option value="${n}">${n}</option>`).join("");
  for (const k of TAG_FIELDS) {
    const el = $(`[data-t="${k}"]`), vals = [...new Set(tracks.map(t => String(val(t, k))))];
    const same = vals.length === 1;
    tagEdit.start[k] = same ? vals[0] : null;
    if (el.tagName === "SELECT") { el.value = same ? vals[0] : ""; if (!same) el.dataset.mixed = "1"; else delete el.dataset.mixed; }
    else { el.value = same ? vals[0] : ""; el.placeholder = same ? (k === "tags" ? "durch Komma getrennt" : "") : MIXED; }
  }
  const onlyLive = tracks.every(t => t.kind === "p");
  $('[data-t="artist"]').disabled = onlyLive;
  $("#t-file-row").hidden = !tracks.some(t => t.kind === "i");
  $("#t-file").checked = localStorage.getItem("dj.writeTags") === "1";
  const ratings = [...new Set(tracks.map(t => t.rating || 0))];
  tagEdit.startRating = ratings.length === 1 ? ratings[0] : null;
  const drawStars = r => { $("#t-rating").innerHTML = [1, 2, 3, 4, 5].map(i => `<span data-r="${i}" class="${(r || 0) >= i ? "on" : ""}">★</span>`).join("") + (r == null ? ` <small class="dim">${MIXED}</small>` : ""); };
  drawStars(tagEdit.startRating);
  $("#t-rating").onclick = e => { const s = e.target.closest("[data-r]"); if (!s) return; const r = +s.dataset.r; tagEdit.rating = (tagEdit.rating ?? tagEdit.startRating) === r ? 0 : r; drawStars(tagEdit.rating); };
  $("#t-hint").textContent = onlyLive ? "Live-Renderings: Titel und Werte landen im Archiv (gleiche Daten wie im Archiv-Tab)." :
    tracks.length > 1 ? "Leere Felder mit ‹verschieden› bleiben bei jedem Track, wie sie sind." : "";
  openModal("#m-tags");
  setTimeout(() => $('[data-t="title"]').focus(), 50);
}
$("#t-save").onclick = async () => {
  if (!tagEdit) return;
  const values = {};
  for (const k of TAG_FIELDS) {
    const el = $(`[data-t="${k}"]`); if (el.disabled) continue;
    const v = el.value.trim(), start = tagEdit.start[k];
    if (start == null ? v !== "" : v !== start) values[k] = v;
  }
  if ("key_root" in values && !("key_mode" in values)) values.key_mode = $('[data-t="key_mode"]').value;
  if (tagEdit.rating != null && tagEdit.rating !== tagEdit.startRating) values.rating = tagEdit.rating;
  localStorage.setItem("dj.writeTags", $("#t-file").checked ? "1" : "0");
  if (!Object.keys(values).length) return closeModals();
  const r = await api("/api/dj/tags", { method: "PATCH", body: { uids: tagEdit.uids, values, write_file: $("#t-file").checked } });
  closeModals();
  if (r.failed?.length) alert("Nicht in die Datei geschrieben:\n" + r.failed.join("\n"));
  else toast(r.written ? `Gespeichert, ${r.written} Datei(en) aktualisiert` : "Tags gespeichert");
  await loadLibrary();
  DJ.decks.forEach(d => { if (d.track) { const nt = DJ.lib.find(t => t.uid === d.track.uid); if (nt) { Object.assign(d.track, nt, { grid_offset: d.track.grid_offset }); d.render?.(); } } });
};
$("#m-tags").addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") $("#t-save").click(); });
$("#btn-dj-tags").onclick = () => openTagEditor(selectedUids());
document.addEventListener("keydown", e => {
  if (!$("#view-dj").classList.contains("active") || e.target.matches("input, textarea, select")) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") { e.preventDefault(); openTagEditor(selectedUids()); }
});
const dz = $("#djdrop");
dz.addEventListener("dragover", e => { if (!hasType(e, "Files")) return; e.preventDefault(); $("#dropzone").classList.add("hover"); });
dz.addEventListener("dragleave", () => $("#dropzone").classList.remove("hover"));
dz.addEventListener("drop", async e => {
  $("#dropzone").classList.remove("hover");
  if (!hasType(e, "Files")) return;
  e.preventDefault();
  const fd = new FormData(); [...e.dataTransfer.files].forEach(f => fd.append("files", f));
  await api("/api/dj/upload", { method: "POST", body: fd });
});
jobListeners.push((j, partial) => { if (j.name === "Import" || j.name === "Rendern" || j.name === "Analyse") loadLibrary(); });

// --------------------------------------------------------------- MIDI (DDJ-FLX4)
function midiLed(msg) { try { DJ.midiOut?.send(msg); } catch (e) {} }
async function initMidi() {
  if (!navigator.requestMIDIAccess) { $("#midi-status").textContent = "MIDI nur in Chrome/Edge"; return; }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const connect = () => {
      const ins = [...access.inputs.values()], outs = [...access.outputs.values()];
      const inp = ins.find(i => /flx4|ddj/i.test(i.name)) || null, out = outs.find(o => /flx4|ddj/i.test(o.name)) || null;
      if (DJ.midiIn && DJ.midiIn !== inp) DJ.midiIn.onmidimessage = null;
      DJ.midiIn = inp; DJ.midiOut = out;
      if (inp) { inp.onmidimessage = e => onMidi(e.data); $("#midi-status").textContent = "● " + inp.name; $("#midi-status").classList.add("ok"); DJ.decks.forEach(d => d.updateLeds()); }
      else { $("#midi-status").textContent = "Kein FLX4 gefunden"; $("#midi-status").classList.remove("ok"); }
    };
    access.onstatechange = connect; connect();
  } catch (e) { $("#midi-status").textContent = "MIDI-Zugriff verweigert"; }
}

function onMidi(data) {
  const [st, d1, d2] = data;
  const ev = FLX4.decode(st, d1, d2 ?? 0);
  if (!ev) return;
  if (!DJ.ready && ev.value) djInitAudio();
  handleEvent(ev);
}

function handleEvent(ev) {
  const d = ev.deck != null ? DJ.decks[ev.deck] : null;
  const hiKey = (n) => `${ev.deck}.${n}`;
  switch (ev.action) {
    case "shift": DJ.shift[ev.deck] = !!ev.value; break;
    case "play": if (ev.value) d.setPlay(!d.playing); break;
    case "cue": ev.value ? d.cuePress() : d.cueRelease(); break;
    case "sync": if (ev.value) d.sync(); break;
    case "headCue": if (ev.value) togglePfl(ev.deck); break;
    case "loopIn": if (ev.value) DJ.shift[ev.deck] ? d.autoLoop() : d.loopInPress(); break;
    case "loopHalve": if (ev.value) d.loopHalve(); break;
    case "loopDouble": if (ev.value) d.loopDouble(); break;
    case "loopOut": if (ev.value) d.loopOutPress(); break;
    case "reloop": if (ev.value) d.reloop(); break;
    case "tempoRange": if (ev.value) DJ.shift[ev.deck] ? d.toggleKeylock() : d.cycleRange(); break;
    case "jogTouch": d.jogTouch(!!ev.value); break;
    case "jogScratch": d.jogTurn(ev.value); break;
    case "jogBend": d.touch ? d.jogTurn(ev.value) : d.bend(DJL.clamp(ev.value * 0.004, -0.3, 0.3)); break;
    case "jogSearch": d.seek(d.pos + ev.value * 0.25); break;
    case "hotcue": if (ev.value) d.hotcue(ev.index, false); break;
    case "hotcueClear": if (ev.value) d.hotcue(ev.index, true); break;
    case "beatloop": if (ev.value) d.beatloop(ev.beats); break;
    case "beatjump": if (ev.value) d.beatjump(ev.beats); break;
    case "load": if (ev.value) loadSelected(ev.deck); break;
    case "browse": browse(ev.value > 0 ? 1 : -1); break;
    case "browsePress": if (ev.value) { DJ.view = { type: "all" }; DJ.sel = 0; renderCrates(); } renderLibrary(); break;
    case "crossfaderMSB": case "crossfaderLSB":
      DJ.xfader = DJ.hi.feed("xf", ev.action.endsWith("MSB") ? "MSB" : "LSB", ev.value); applyCrossfader(); break;
    case "headMixMSB": case "headMixLSB":
      DJ.headMix = DJ.hi.feed("hm", ev.action.slice(-3), ev.value); applyHeadMix(); updateKnobs(); break;
    case "filterMSB": case "filterLSB":
      d.filter = DJ.hi.feed(hiKey("f"), ev.action.slice(-3), ev.value); d.applyFilter(); updateKnobs(); break;
    case "tempoMSB": case "tempoLSB": {
      const v = DJ.hi.feed(hiKey("t"), ev.action.slice(-3), ev.value);
      const s = $(`#deck-${ev.deck} [data-slider]`); if (s) s.value = v;
      d.setSlider(v); break;
    }
    case "volumeMSB": case "volumeLSB":
      d.vol = DJ.hi.feed(hiKey("v"), ev.action.slice(-3), ev.value); d.applyVol();
      $(`[data-vol="${ev.deck}"]`).value = d.vol; break;
    case "trimMSB": case "trimLSB": d.trim = DJ.hi.feed(hiKey("tr"), ev.action.slice(-3), ev.value); d.applyTrim(); updateKnobs(); break;
    case "eqHighMSB": case "eqHighLSB": d.eq.hi = DJ.hi.feed(hiKey("h"), ev.action.slice(-3), ev.value); d.applyEq(); updateKnobs(); break;
    case "eqMidMSB": case "eqMidLSB": d.eq.mid = DJ.hi.feed(hiKey("m"), ev.action.slice(-3), ev.value); d.applyEq(); updateKnobs(); break;
    case "eqLowMSB": case "eqLowLSB": d.eq.lo = DJ.hi.feed(hiKey("l"), ev.action.slice(-3), ev.value); d.applyEq(); updateKnobs(); break;
  }
}

// --------------------------------------------------------------- Tastatur
function keyAction(ev, down) {
  const d = ev.deck != null ? DJ.decks[ev.deck] : null;
  if (!down) {   // Loslassen: nur Cue und Nudge reagieren
    if (ev.action === "cue") d.cueRelease();
    if (ev.action === "nudge") d.nudge(0, false);
    return;
  }
  switch (ev.action) {
    case "play": d.setPlay(!d.playing); break;
    case "cue": d.cuePress(); break;
    case "sync": d.sync(); break;
    case "nudge": d.nudge(ev.dir, true); break;
    case "beatjump": d.beatjump(ev.beats); break;
    case "pitchStep": d.pitchStep(ev.step); break;
    case "loopIn": d.loopInPress(); break;
    case "loopOut": d.loopOutPress(); break;
    case "reloop": d.reloop(); break;
    case "autoLoop": d.autoLoop(); break;
    case "loopHalve": d.loopHalve(); break;
    case "loopDouble": d.loopDouble(); break;
    case "loopMove": d.loopMove(ev.dir); break;
    case "keylock": d.toggleKeylock(); break;
    case "gridHere": d.gridHere(); break;
    case "tap": d.tap(); break;
    case "hotcue": d.hotcue(ev.index, !!ev.clear); break;
    case "browse": browse(ev.dir); break;
    case "load": loadSelected(ev.deck); break;
    case "xfader": DJ.xfader = ev.dir === 0 ? 0.5 : DJL.clamp(DJ.xfader + ev.dir * 0.1, 0, 1); applyCrossfader(); break;
    case "help": toggleKeyHelp(); break;
  }
}
const heldKeys = new Map();
document.addEventListener("keydown", e => {
  if (!$("#view-dj").classList.contains("active") || e.target.matches("input, textarea, select") || e.metaKey || e.ctrlKey) return;
  const ev = DJL.keyEvent(e.code, { shift: e.shiftKey, alt: e.altKey });
  if (!ev) return;
  e.preventDefault();
  const repeatable = ["pitchStep", "browse", "xfader"].includes(ev.action);
  if (e.repeat && !repeatable) return;
  heldKeys.set(e.code, ev);
  djInitAudio(); keyAction(ev, true);
});
document.addEventListener("keyup", e => {
  const ev = heldKeys.get(e.code); if (!ev) return;
  heldKeys.delete(e.code); keyAction(ev, false);
});
addEventListener("blur", () => { heldKeys.forEach(ev => keyAction(ev, false)); heldKeys.clear(); });

function toggleKeyHelp() {
  let el = $("#keyhelp");
  if (el) { el.remove(); return; }
  const K = DJL.KEYMAP, row = (code, txt) => `<tr><td><kbd>${K[code].label}</kbd></td><td>${txt}</td></tr>`;
  const deck = (c) => `
    ${row(c.play, "Play/Pause")}${row(c.cue, "Cue (halten = vorhören)")}${row(c.sync, "Sync an/aus")}
    ${row(c.nm, "Bremsen (halten) · Shift: 4 Beats zurück · Alt: Tempo −0,05 %")}${row(c.np, "Schieben (halten) · Shift: 4 Beats vor · Alt: Tempo +0,05 %")}
    ${row(c.li, "Loop In · Shift: Loop zurückschieben")}${row(c.lo, "Loop Out · Shift: Loop vorschieben")}${row(c.rl, "Reloop/Exit")}
    ${row(c.al, "Auto-Loop (Länge mit ½X/2X)")}${row(c.lh, "Loop ½X")}${row(c.ld, "Loop 2X")}
    ${row(c.mt, "Master Tempo · Shift: Beatgrid-Beat hier")}${row(c.tap, "Tap-Tempo (ab 4 Taps)")}
    <tr><td><kbd>${c.hc}</kbd></td><td>Hot Cues 1–4 · Shift: löschen</td></tr>`;
  el = document.createElement("div"); el.id = "keyhelp"; el.className = "keyhelp";
  el.innerHTML = `<div class="kh-box"><header>Tastatur <button class="btn small" id="kh-x">✕</button></header>
    <div class="kh-cols">
      <table><caption>Deck A</caption>${deck({ play: "KeyQ", cue: "KeyW", sync: "KeyE", nm: "KeyR", np: "KeyT", li: "KeyA", lo: "KeyS", rl: "KeyD", al: "KeyF", lh: "KeyX", ld: "KeyC", mt: "KeyG", tap: "KeyV", hc: "1 2 3 4" })}</table>
      <table><caption>Deck B</caption>${deck({ play: "KeyP", cue: "KeyO", sync: "KeyI", nm: "KeyY", np: "KeyU", li: "KeyK", lo: "KeyL", rl: "Semicolon", al: "KeyJ", lh: "KeyM", ld: "Comma", mt: "KeyH", tap: "KeyN", hc: "7 8 9 0" })}</table>
      <table><caption>Allgemein</caption>
        <tr><td><kbd>↑ ↓</kbd></td><td>Bibliothek blättern</td></tr>
        <tr><td><kbd>← →</kbd></td><td>Auf Deck A / B laden</td></tr>
        <tr><td><kbd>Shift ← →</kbd></td><td>Crossfader schieben</td></tr>
        <tr><td><kbd>B</kbd></td><td>Crossfader Mitte</td></tr>
        <tr><td><kbd>?</kbd></td><td>Diese Hilfe</td></tr>
      </table>
    </div></div>`;
  document.body.appendChild(el);
  el.onclick = e => { if (e.target === el || e.target.id === "kh-x") el.remove(); };
}

// --------------------------------------------------------------- Animation
function frame() {
  if ($("#view-dj").classList.contains("active")) {
    DJ.decks.forEach((d, i) => {
      d.draw();
      const lv = d.level(), bar = $("#vu" + i); if (bar) bar.style.height = Math.round(lv * 100) + "%";
      if (DJ.midiOut && (DJ.frameN % 3 === 0)) midiLed(FLX4.LED.vu(i, lv));
      if (d.synced) { const o = DJ.decks[1 - i]; if (o.track && o.bpm) { const r = DJL.syncRate(d.bpm, o.effBpm); if (Math.abs(r - d.rate) > 1e-4) { d.rate = r; d.applyRate(); d.renderState(); } } }
    });
  }
  if (DJ.frameN % 10 === 0) DJ.decks.forEach(d => { if (d.track) drawDjMini($(`canvas[data-djmini="${d.track.uid}"]`), d.track.uid); });
  DJ.frameN = (DJ.frameN || 0) + 1;
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------- Start
DJ.decks = [new Deck(0), new Deck(1)];
renderMixer();
const startBtn = document.createElement("button");
startBtn.id = "dj-start"; startBtn.className = "btn primary"; startBtn.textContent = "Audio starten";
startBtn.onclick = () => djInitAudio().then(listOutputs);
$("#view-dj .listhead").prepend(startBtn);
const qBtn = document.createElement("button");
qBtn.className = "btn small on"; qBtn.textContent = "QUANTIZE"; qBtn.title = "Loops, Hot Cues und Loop-Punkte rasten auf den Beat ein";
qBtn.onclick = () => { DJ.quantize = !DJ.quantize; qBtn.classList.toggle("on", DJ.quantize); };
const kBtn = document.createElement("button");
kBtn.className = "btn small"; kBtn.textContent = "⌨ Tasten"; kBtn.onclick = toggleKeyHelp;
$("#midi-status").after(qBtn, kBtn);
views.dj = { onShow: () => { loadLibrary(); initMidi(); listOutputs(); } };
requestAnimationFrame(frame);
