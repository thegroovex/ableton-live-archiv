// Testet die Deck-Engine (AudioWorklet) in einer simulierten Umgebung
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadProcessor() {
  let Cls;
  const ctx = {
    sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: m => (this.sent = (this.sent || []).concat([m])), onmessage: null }; } },
    registerProcessor: (_n, c) => { Cls = c; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../static/js/deck-worklet.js"), "utf8"), ctx);
  return Cls;
}
function run(p, blocks) {
  const out = [[new Float32Array(128), new Float32Array(128)]];
  for (let i = 0; i < blocks; i++) p.process([], out);
  return out[0];
}
const send = (p, m) => p.port.onmessage({ data: m });

test("Stille ohne Track, Abspielen nach Laden", () => {
  const P = loadProcessor(), p = new P();
  assert.equal(run(p, 1)[0][0], 0);
  const L = new Float32Array(48000).fill(0.5);
  send(p, { type: "load", L, sampleRate: 48000 });
  send(p, { type: "play", value: true });
  run(p, 40);
  assert.ok(p.pos > 0, "Position läuft");
  const out = run(p, 1);
  assert.ok(Math.abs(out[0][100] - 0.5) < 1e-3, "Signal kommt an");
});

test("Tempo +10 % spielt 10 % schneller", () => {
  const P = loadProcessor(), p = new P();
  send(p, { type: "load", L: new Float32Array(480000), sampleRate: 48000 });
  send(p, { type: "rate", value: 1.1 });
  send(p, { type: "play", value: true });
  run(p, 375);  // 1 s
  const p0 = p.pos; run(p, 375);
  assert.ok(Math.abs((p.pos - p0) / 48000 - 1.1) < 0.01);
});

test("Loop springt zurück, Seek, Scratch rückwärts", () => {
  const P = loadProcessor(), p = new P();
  send(p, { type: "load", L: new Float32Array(480000), sampleRate: 48000 });
  send(p, { type: "seek", sec: 1 });
  send(p, { type: "loop", start: 1, end: 1.5 });
  send(p, { type: "play", value: true });
  run(p, 375 * 2);
  assert.ok(p.pos >= 48000 && p.pos < 72000, "bleibt im Loop");
  send(p, { type: "loop", start: null });
  send(p, { type: "scratch", on: true });
  send(p, { type: "scratchVel", value: -1 });
  const before = p.pos; run(p, 100);
  assert.ok(p.pos < before, "läuft rückwärts");
});

test("Hält am Ende an und meldet Position", () => {
  const P = loadProcessor(), p = new P();
  send(p, { type: "load", L: new Float32Array(4800), sampleRate: 48000 });
  send(p, { type: "play", value: true });
  run(p, 200);
  assert.equal(p.playing, false);
  assert.ok(p.sent.length > 0 && "pos" in p.sent[0]);
});

test("Master Tempo hält die Tonhöhe bei +8 % Tempo", () => {
  const P = loadProcessor(), p = new P();
  const sr = 48000, n = sr * 3, f = 440, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.sin(2 * Math.PI * f * i / sr);
  p.onMsg({ type: "load", L, sampleRate: sr });
  p.onMsg({ type: "rate", value: 1.08 }); p.onMsg({ type: "keylock", value: true }); p.onMsg({ type: "play", value: true });
  const out = [[new Float32Array(128), new Float32Array(128)]], got = [];
  for (let b = 0; b < 600; b++) { p.process([], out); if (b > 300) got.push(...out[0][0]); }
  // Nulldurchgänge zählen → Frequenz
  let z = 0; for (let i = 1; i < got.length; i++) if (got[i - 1] < 0 && got[i] >= 0) z++;
  const freq = z / (got.length / sr);
  assert.ok(Math.abs(freq - f) < 20, `Frequenz ${freq.toFixed(1)} Hz statt ~440`);
});

test("Ohne Master Tempo steigt die Tonhöhe mit dem Tempo", () => {
  const P = loadProcessor(), p = new P();
  const sr = 48000, n = sr * 3, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.sin(2 * Math.PI * 440 * i / sr);
  p.onMsg({ type: "load", L, sampleRate: sr }); p.onMsg({ type: "rate", value: 1.08 }); p.onMsg({ type: "play", value: true });
  const out = [[new Float32Array(128), new Float32Array(128)]], got = [];
  for (let b = 0; b < 600; b++) { p.process([], out); if (b > 300) got.push(...out[0][0]); }
  let z = 0; for (let i = 1; i < got.length; i++) if (got[i - 1] < 0 && got[i] >= 0) z++;
  assert.ok(Math.abs(z / (got.length / sr) - 475) < 10);
});
