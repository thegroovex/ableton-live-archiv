const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../../static/js/wave.js");
const L = require("../../static/js/dj-logic.js");

// Synthetischer Track: Kick (60 Hz, abklingend) auf jedem Beat, Hi-Hat-Rauschen auf den Offbeats
function track({ bpm, start, sec = 20, sr = 22050, beats = Infinity }) {
  const y = new Float32Array(sr * sec), p = 60 / bpm;
  let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let b = 0, t = start; t < sec && b < beats; t += p, b++) {
    const i0 = Math.round(t * sr);
    for (let j = 0; j < sr * 0.25 && i0 + j < y.length; j++) y[i0 + j] += 0.9 * Math.exp(-j / (sr * 0.05)) * Math.sin(2 * Math.PI * 60 * j / sr);
    const h0 = Math.round((t + p / 2) * sr);
    for (let j = 0; j < sr * 0.03 && h0 + j < y.length; j++) y[h0 + j] += 0.15 * Math.exp(-j / (sr * 0.008)) * rnd();
  }
  return { y, sr };
}
const detect = (o, bpm) => { const e = W.onsetEnvelope(o.y, null, o.sr); return L.detectGrid(e.flux, e.rms, e.hop, bpm); };
const barDist = (a, b, bpm) => { const bar = 240 / bpm; let d = Math.abs(a - b) % bar; return Math.min(d, bar - d); };

test("Beatgrid: Downbeat am ersten Einsatz (Track beginnt kurz nach 0)", () => {
  const r = detect(track({ bpm: 105.26, start: 0.07 }), 105.26);
  assert.ok(barDist(r.grid, 0.07, 105.26) < 0.012, `grid ${r.grid}`);
});

test("Beatgrid: Stille am Anfang wird übersprungen", () => {
  const r = detect(track({ bpm: 124, start: 1.234 }), 124);
  assert.ok(barDist(r.grid, 1.234, 124) < 0.012, `grid ${r.grid}`);
  assert.ok(r.confidence > 0.15);
});

test("Beatgrid: Phase stimmt auch, wenn der Einsatz neben dem Raster liegt", () => {
  // leiser Auftakt-Ton 0,2 s vor dem ersten Kick
  const o = track({ bpm: 120, start: 1.0 });
  for (let j = 0; j < o.sr * 0.1; j++) o.y[Math.round(0.8 * o.sr) + j] += 0.05 * Math.sin(2 * Math.PI * 440 * j / o.sr);
  const r = detect(o, 120);
  assert.ok(Math.abs(((r.grid - 1.0) % 0.5 + 0.5) % 0.5) < 0.012 || Math.abs(((r.grid - 1.0) % 0.5 + 0.5) % 0.5 - 0.5) < 0.012, `grid ${r.grid}`);
});
