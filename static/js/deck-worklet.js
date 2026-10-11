/* Deck-Audio-Engine als AudioWorklet: spielt einen Puffer mit beliebiger (auch negativer) Geschwindigkeit.
   Damit funktionieren Pitch, Scratchen, Nudgen, Loops und exakte Positionsanzeige. */
class DeckProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null; this.R = null; this.len = 0; this.srcRate = sampleRate;
    this.pos = 0; this.playing = false; this.rate = 1; this.bend = 0;
    this.scratching = false; this.scratchVel = 0; this.curVel = 0;
    this.loop = null; // {start, end} in Samples
    this.tick = 0;
    // Master Tempo (Key Lock): granularer Pitch-Shifter, hebt die Tonhöhenänderung durch das Tempo wieder auf
    this.keylock = false; this.klMix = 0;
    this.W = Math.round(2048 * sampleRate / 44100);   // Fenster ≈ 46 ms
    this.RB = 16384; this.rbL = new Float32Array(this.RB); this.rbR = new Float32Array(this.RB); this.w = 0; this.d = 0;
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
      case "loop": this.loop = m.start == null ? null : { start: m.start * this.srcRate, end: m.end * this.srcRate }; break;
    }
  }
  read(p) {  // Ringpuffer mit linearer Interpolation
    const RB = this.RB; let x = p % RB; if (x < 0) x += RB;
    const a = Math.floor(x), b = (a + 1) & (RB - 1), f = x - a;
    return [this.rbL[a] + (this.rbL[b] - this.rbL[a]) * f, this.rbR[a] + (this.rbR[b] - this.rbR[a]) * f];
  }
  process(_in, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0];
    if (!this.L) { oL.fill(0); if (oR !== oL) oR.fill(0); return true; }
    const step = this.srcRate / sampleRate;
    const target = this.scratching ? this.scratchVel : (this.playing ? this.rate * (1 + this.bend) : 0);
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
      const klOn = this.keylock && !this.scratching && this.curVel > 0.05;
      this.klMix += ((klOn ? 1 : 0) - this.klMix) * 0.003;
      const wi = this.w; this.rbL[wi] = sL; this.rbR[wi] = sR; this.w = (wi + 1) & (this.RB - 1);
      if (this.klMix > 1e-3) {
        const W = this.W, ratio = 1 / Math.max(0.05, Math.abs(this.curVel));
        this.d += 1 - ratio; if (this.d >= W) this.d -= W; if (this.d < 0) this.d += W;
        const d2 = (this.d + W / 2) % W;
        const g1 = Math.sin(Math.PI * this.d / W) ** 2, g2 = 1 - g1;
        const t1 = this.read(wi - this.d), t2 = this.read(wi - d2);
        const m = this.klMix;
        oL[i] = sL * (1 - m) + (t1[0] * g1 + t2[0] * g2) * m;
        oR[i] = sR * (1 - m) + (t1[1] * g1 + t2[1] * g2) * m;
      } else { oL[i] = sL; oR[i] = sR; }
      this.pos += this.curVel * step;
      if (this.loop && this.curVel > 0 && this.pos >= this.loop.end) this.pos = this.loop.start + (this.pos - this.loop.end);
      if (this.pos < 0) this.pos = 0;
      if (this.pos >= this.len - 1) { this.pos = this.len - 1; this.playing = false; }
    }
    if (++this.tick % 8 === 0) this.port.postMessage({ pos: this.pos / this.srcRate, playing: this.playing });
    return true;
  }
}
registerProcessor("deck-processor", DeckProcessor);
