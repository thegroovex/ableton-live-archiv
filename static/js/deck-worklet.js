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
      case "loop": this.loop = m.start == null ? null : { start: m.start * this.srcRate, end: m.end * this.srcRate }; break;
    }
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
      if (i0 >= 0 && i0 + 1 < this.len && this.curVel !== 0) {
        oL[i] = this.L[i0] + (this.L[i0 + 1] - this.L[i0]) * f;
        oR[i] = this.R[i0] + (this.R[i0 + 1] - this.R[i0]) * f;
      } else { oL[i] = 0; oR[i] = 0; }
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
