/* Deck-Audio-Engine als AudioWorklet: spielt einen Puffer mit beliebiger (auch negativer) Geschwindigkeit.
   Damit funktionieren Pitch, Scratchen, Nudgen, Loops und exakte Positionsanzeige.

   Tonhöhe: Die Wiedergabe mit `rate` verändert Tempo UND Tonhöhe (Repitch, wie eine Platte).
   Ein nachgeschalteter Pitch-Shifter (Delay-Line mit synchronisierten Grains, WSOLA-artig) kann die Tonhöhe
   unabhängig verschieben:
     - keylock (Keep Pitch / Master Tempo): hebt die Tonhöhenänderung durch das Tempo wieder auf
     - semis: zusätzliche Transposition in Halbtönen (manuell oder per Key Sync, auch Bruchteile)
   Gesamtfaktor des Shifters: (keylock ? 1/Tempo : 1) · 2^(semis/12) */
class DeckProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null; this.R = null; this.len = 0; this.srcRate = sampleRate;
    this.pos = 0; this.playing = false; this.rate = 1; this.bend = 0;
    this.scratching = false; this.scratchVel = 0; this.curVel = 0;
    this.loop = null; // {start, end} in Samples
    this.tick = 0;
    this.keylock = false; this.semis = 0; this.klMix = 0;
    const k = sampleRate / 44100;
    this.J = Math.round(1024 * k);   // Sprungweite eines Grains (≈ 23 ms)
    this.S = Math.round(256 * k);    // Suchbereich für die Phasen-Ausrichtung
    this.C = Math.round(192 * k);    // Länge des Vergleichsfensters
    this.F = Math.round(512 * k);    // Überblendlänge
    this.RB = 65536; this.M = this.RB - 1;
    this.rbL = new Float32Array(this.RB); this.rbR = new Float32Array(this.RB); this.rbM = new Float32Array(this.RB);
    this.w = 0; this.d = 0; this.d2 = 0; this.xf = 0; this.active = false;
    this.port.onmessage = e => this.onMsg(e.data);
  }
  onMsg(m) {
    switch (m.type) {
      case "load": this.L = m.L; this.R = m.R || m.L; this.len = m.L.length; this.srcRate = m.sampleRate; this.pos = 0; this.loop = null; this.playing = false; break;
      case "play": this.playing = m.value; break;
      case "seek": this.pos = Math.max(0, Math.min(this.len - 1, m.sec * this.srcRate)); break;
      case "rate": this.rate = m.value; break;
      case "bend": this.bend = m.value; break;
      case "scratch": this.scratching = m.on; if (!m.on) this.scratchVel = 0; break;
      case "scratchVel": this.scratchVel = m.value; break;
      case "keylock": this.keylock = !!m.value; break;
      case "semis": this.semis = +m.value || 0; break;
      case "loop": this.loop = m.start == null ? null : { start: m.start * this.srcRate, end: m.end * this.srcRate }; break;
    }
  }
  read(p) {  // Ringpuffer mit linearer Interpolation; p = Index (darf negativ sein)
    const M = this.M; let x = p % this.RB; if (x < 0) x += this.RB;
    const a = Math.floor(x), b = (a + 1) & M, f = x - a;
    return [this.rbL[a] + (this.rbL[b] - this.rbL[a]) * f, this.rbR[a] + (this.rbR[b] - this.rbR[a]) * f];
  }
  /* Neue Grain-Verzögerung um `base` herum suchen, deren Wellenform am besten zur aktuellen passt
     (normierte Kreuzkorrelation) – vermeidet Phasensprünge und damit das typische „Flattern“. */
  bestDelay(cur, base) {
    const M = this.M, C = this.C, w = this.w, rb = this.rbM;
    const c0 = Math.round(cur), lo = Math.max(C + 2, Math.round(base - this.S)), hi = Math.min(this.RB - C - 2, Math.round(base + this.S));
    let best = Math.round(base), bestScore = -Infinity;
    for (let d = lo; d <= hi; d++) {
      let xy = 0, yy = 1e-9;
      for (let k = 0; k < C; k += 2) {
        const a = rb[(w - c0 - k) & M], b = rb[(w - d - k) & M];
        xy += a * b; yy += b * b;
      }
      const s = xy / Math.sqrt(yy);
      if (s > bestScore) { bestScore = s; best = d; }
    }
    return best;
  }
  process(_in, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0];
    if (!this.L) { oL.fill(0); if (oR !== oL) oR.fill(0); return true; }
    const step = this.srcRate / sampleRate, M = this.M, F = this.F, C = this.C;
    const target = this.scratching ? this.scratchVel : (this.playing ? this.rate * (1 + this.bend) : 0);
    const semiF = Math.pow(2, this.semis / 12);
    for (let i = 0; i < oL.length; i++) {
      // sanftes Anfahren/Abbremsen wie bei einem Plattenteller
      this.curVel += (target - this.curVel) * (this.scratching ? 0.02 : 0.004);
      if (Math.abs(this.curVel) < 1e-5 && target === 0) this.curVel = 0;
      const p = this.pos, i0 = Math.floor(p), f = p - i0;
      let sL = 0, sR = 0;
      if (i0 >= 0 && i0 + 1 < this.len && this.curVel !== 0) {
        sL = this.L[i0] + (this.L[i0 + 1] - this.L[i0]) * f;
        sR = this.R[i0] + (this.R[i0 + 1] - this.R[i0]) * f;
      }
      const wi = this.w; this.rbL[wi] = sL; this.rbR[wi] = sR; this.rbM[wi] = sL + sR; this.w = (wi + 1) & M;

      const shOn = (this.keylock || this.semis !== 0) && !this.scratching && Math.abs(this.curVel) > 0.05;
      this.klMix += ((shOn ? 1 : 0) - this.klMix) * 0.003;
      if (this.klMix > 1e-3) {
        let ratio = (this.keylock ? 1 / Math.max(0.05, Math.abs(this.curVel)) : 1) * semiF;
        ratio = Math.max(0.25, Math.min(4, ratio));
        if (!this.active) { this.active = true; this.d = C + 2 + this.J; this.xf = 0; }
        this.d += 1 - ratio;
        if (this.xf > 0) this.d2 += 1 - ratio;
        else {
          const lo = C + 2 + F * Math.max(0, ratio - 1), J = this.J + F * Math.abs(ratio - 1);
          if (ratio > 1 && this.d < lo) { this.d2 = this.bestDelay(this.d, this.d + J); this.xf = F; }
          else if (ratio < 1 && this.d > C + 2 + J + 2 * this.S) { this.d2 = this.bestDelay(this.d, this.d - J); this.xf = F; }
        }
        if (this.d < 1) this.d = 1;
        if (this.d > this.RB - 4) this.d = this.RB - 4;
        let yL, yR;
        const t1 = this.read(wi - this.d);
        if (this.xf > 0) {
          if (this.d2 < 1) this.d2 = 1;
          const t2 = this.read(wi - this.d2), g = this.xf / F;   // linear: Grains sind phasengleich ausgerichtet
          yL = t1[0] * g + t2[0] * (1 - g); yR = t1[1] * g + t2[1] * (1 - g);
          if (--this.xf === 0) this.d = this.d2;
        } else { yL = t1[0]; yR = t1[1]; }
        const m = this.klMix;
        oL[i] = sL * (1 - m) + yL * m;
        oR[i] = sR * (1 - m) + yR * m;
      } else { this.active = false; oL[i] = sL; oR[i] = sR; }
      this.pos += this.curVel * step;
      if (this.loop && this.curVel > 0 && this.pos >= this.loop.end) this.pos = this.loop.start + (this.pos - this.loop.end);
      if (this.pos < 0) this.pos = 0;
      if (this.pos >= this.len - 1) { this.pos = this.len - 1; this.playing = false; }
    }
    if (++this.tick % 8 === 0) {
      // hörbare Position melden: der Shifter verzögert um d Samples
      const lag = this.klMix > 0.5 ? this.d * Math.abs(this.curVel) * step : 0;
      this.port.postMessage({ pos: Math.max(0, this.pos - lag) / this.srcRate, playing: this.playing });
    }
    return true;
  }
}
registerProcessor("deck-processor", DeckProcessor);
