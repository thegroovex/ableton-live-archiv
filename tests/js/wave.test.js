const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../../static/js/wave.js");

const sine = (hz, sr = 44100, sec = 1) => Float32Array.from({ length: sr * sec }, (_, i) => 0.8 * Math.sin(2 * Math.PI * hz * i / sr));

test("Bässe, Mitten und Höhen werden getrennt", () => {
  const lo = W.computeBands(sine(60), null, 44100, 20), mi = W.computeBands(sine(700), null, 44100, 20), hi = W.computeBands(sine(8000), null, 44100, 20);
  const k = 10;  // mittlerer Block, nach dem Einschwingen
  assert.ok(lo.low[k] > lo.mid[k] && lo.low[k] > lo.high[k], "60 Hz = Bass");
  assert.ok(mi.mid[k] > mi.low[k] && mi.mid[k] > mi.high[k], "700 Hz = Mitten");
  assert.ok(hi.high[k] > hi.low[k] && hi.high[k] > hi.mid[k], "8 kHz = Höhen");
  for (const r of [lo, mi, hi]) assert.ok(Math.abs(r.low[k] + r.mid[k] + r.high[k] - 1) < 1e-5);
  assert.equal(lo.peaks.length, 20);
  assert.ok(lo.peaks[k] > 0.7 && lo.peaks[k] <= 1);
});

test("Farben wie im Archiv (Bass blau, Mitten orange, Höhen weiß)", () => {
  assert.deepEqual(W.bandRGB(1, 0, 0), [30, 110, 255]);
  assert.deepEqual(W.bandRGB(0, 1, 0), [255, 150, 40]);
  assert.deepEqual(W.bandRGB(0, 0, 1), [255, 255, 255]);
  assert.equal(W.bandColor(0, 0, 1, 0.5), "rgba(255,255,255,0.5)");
});
