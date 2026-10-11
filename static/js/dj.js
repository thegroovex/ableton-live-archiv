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
    if (!track.bpm) track.bpm = 0;
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
  saveGrid() {
    this.track.grid_offset = DJL.normGrid(this.grid, this.bpm);
    this.renderState();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => api(`/api/dj/grid/${this.track.kind}/${this.track.id}`, { method: "PATCH", body: { bpm: this.track.bpm, grid_offset: this.track.grid_offset } })
      .then(() => toast?.("Beatgrid gespeichert")).catch(() => {}), 600);
  }
  gridShift(ms) { if (!this.track || !this.bpm) return; this.track.grid_offset = this.grid + ms / 1000; this.saveGrid(); }
  gridHere() { if (!this.track || !this.bpm) return; this.track.grid_offset = DJL.gridFromDownbeat(this.pos, this.bpm); this.saveGrid(); }
  setBpm(v) {
    if (!this.track || !(v > 20 && v < 400)) return;
    const anchor = this.bpm ? DJL.snapToBeat(this.pos, this.bpm, this.grid) : this.pos;   // Beat unter dem Abspielkopf bleibt stehen
    this.track.bpm = Math.round(v * 100) / 100;
    this.track.grid_offset = DJL.gridFromDownbeat(anchor, this.track.bpm);
    this.saveGrid();
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
      <div class="title"><span class="letter">${L}</span><b>${esc(t ? t.title : "Kein Track geladen")}</b><span class="timeinfo" data-time>–</span></div>
      <div class="meta"><span>${esc(t?.artist || "")}</span><span>${t ? keyLabel(t.key_root, t.key_mode) + " " + camelot(t.key_root, t.key_mode) : ""}</span><span>${esc(t?.genre || "")}</span></div>
      <div class="bpmrow">
        <div class="bigbpm" data-bpm>–<small>BPM</small></div>
        <div class="ratebox"><span class="timeinfo" data-rate></span><button class="btn small" data-mt title="Master Tempo: Tonhöhe bleibt beim Pitchen gleich">MT</button></div>
        <canvas class="phase" title="Takt (1–4) und Versatz zum anderen Deck"></canvas>
      </div>
      <canvas class="zoom"></canvas><canvas class="overview"></canvas>
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
        <button class="btn small" data-ghere title="Beat genau an der Abspielposition">Beat hier</button>
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
    this.el.querySelectorAll("[data-bpmx]").forEach(b => b.onclick = () => this.setBpm(this.bpm * +b.dataset.bpmx));
    this.el.querySelectorAll("[data-bpmd]").forEach(b => b.onclick = () => this.setBpm(this.bpm + +b.dataset.bpmd));
    q("[data-bpmin]").onchange = e => this.setBpm(parseFloat(e.target.value.replace(",", ".")));
    q("[data-tap]").onclick = () => this.tap();
    this.el.querySelectorAll("[data-hc]").forEach(b => b.onclick = e => this.hotcue(+b.dataset.hc, e.shiftKey));
    q(".overview").onclick = e => { const r = e.target.getBoundingClientRect(); this.seek((e.clientX - r.left) / r.width * this.duration); };
    this.phaseC = q(".phase");
    this.zoomC = q(".zoom"); this.ovC = q(".overview");
    this.renderPads(); this.renderState();
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
    const span = 6, ps = this.peaks.perSecond, start = this.pos - span / 2, mid = h / 2, pk = this.peaks.peaks;
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

// --------------------------------------------------------------- Bibliothek
async function loadLibrary() {
  DJ.lib = await api("/api/dj/library");
  renderLibrary();
}
function visibleLib() { const src = $("#dj-src").value; return DJ.lib.filter(t => !src || t.source === src); }
function renderLibrary() {
  const list = visibleLib();
  DJ.sel = DJL.clamp(DJ.sel, 0, Math.max(0, list.length - 1));
  const playing = DJ.decks.find(d => d.playing && d.track)?.track;
  const ref = playing ? camelot(playing.key_root, playing.key_mode) : null;
  $("#djcount").textContent = `${list.length} Tracks`;
  $("#djlist tbody").innerHTML = list.map((t, i) => {
    const cam = camelot(t.key_root, t.key_mode), fit = ref && DJL.camelotCompatible(ref, cam);
    return `<tr data-i="${i}" class="${i === DJ.sel ? "sel" : ""}">
      <td>${esc(t.title)}</td><td>${esc(t.artist)}</td><td class="mono">${t.bpm ? (+t.bpm).toFixed(1) : "–"}</td>
      <td class="mono">${keyLabel(t.key_root, t.key_mode)}</td><td class="mono" style="${fit ? "color:var(--green)" : ""}">${cam}${fit ? " ●" : ""}</td>
      <td>${esc(t.genre || "")}</td><td class="mono">${fmtTime(t.duration)}</td><td><span class="badge">${t.source}</span></td>
      <td><button class="btn small" data-load="0">A</button> <button class="btn small" data-load="1">B</button></td></tr>`;
  }).join("");
}
$("#djlist tbody").addEventListener("click", e => {
  const tr = e.target.closest("tr"); if (!tr) return;
  DJ.sel = +tr.dataset.i;
  const b = e.target.closest("[data-load]");
  if (b) DJ.decks[+b.dataset.load].load(visibleLib()[DJ.sel]);
  renderLibrary();
});
$("#dj-src").onchange = renderLibrary;
function browse(delta) {
  DJ.sel = DJL.clamp(DJ.sel + delta, 0, visibleLib().length - 1); renderLibrary();
  $("#djlist tr.sel")?.scrollIntoView({ block: "nearest" });
}
function loadSelected(deck) { const t = visibleLib()[DJ.sel]; if (t) DJ.decks[deck].load(t); }

// Import: Ordner-Pfad oder Drag & Drop
$("#btn-import").onclick = () => openModal("#m-import");
$("#i-go").onclick = async () => { await api("/api/dj/import", { method: "POST", body: { paths: [$("#i-path").value] } }); closeModals(); };
const dz = $("#djdrop");
dz.addEventListener("dragover", e => { e.preventDefault(); $("#dropzone").classList.add("hover"); });
dz.addEventListener("dragleave", () => $("#dropzone").classList.remove("hover"));
dz.addEventListener("drop", async e => {
  e.preventDefault(); $("#dropzone").classList.remove("hover");
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
    case "browsePress": if (ev.value) $("#dj-src").value = ""; renderLibrary(); break;
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
