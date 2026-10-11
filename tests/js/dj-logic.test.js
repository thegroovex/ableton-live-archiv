const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../static/js/dj-logic.js");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("Tempo-Fader", () => {
  assert.equal(L.sliderToRate(0.5, 0.1), 1);
  near(L.sliderToRate(1, 0.1), 1.1);
  near(L.sliderToRate(0, 0.08), 0.92);
  near(L.sliderToRate(1, 0.1, true), 0.9);
});

test("EQ und Trim", () => {
  assert.equal(L.knobToEqDb(0.5), 0);
  near(L.knobToEqDb(1), 6);
  assert.equal(L.knobToEqDb(0), -40);
  near(L.trimToGain(0.5), 1);
  near(L.trimToGain(1), Math.pow(10, 12 / 20));
});

test("Crossfader: Mitte beide voll, Ränder schneiden ab", () => {
  assert.deepEqual(L.crossfaderGains(0.5), [1, 1]);
  const [a, b] = L.crossfaderGains(0);
  assert.equal(a, 1); near(b, 0);
  const [a2, b2] = L.crossfaderGains(1);
  near(a2, 0); assert.equal(b2, 1);
});

test("Filter", () => {
  assert.equal(L.filterParams(0.5).type, "off");
  assert.equal(L.filterParams(0.1).type, "lowpass");
  assert.equal(L.filterParams(0.9).type, "highpass");
  assert.ok(L.filterParams(0.0).freq < L.filterParams(0.4).freq);
});

test("Sync inkl. halbes/doppeltes Tempo", () => {
  near(L.syncRate(124, 126), 126 / 124);
  near(L.syncRate(87, 174), 1);       // DnB halftime
  near(L.syncRate(140, 70), 1);
  assert.equal(L.syncRate(0, 120), 1);
});

test("Phasenkorrektur bringt Beats übereinander", () => {
  const bpm = 120; // 0,5 s pro Beat
  const d = L.phaseCorrection(10.1, bpm, 0, 20.0, bpm, 0);
  near(L.beatPhase(10.1 + d, bpm), L.beatPhase(20.0, bpm));
  assert.ok(Math.abs(d) <= 0.25);
});

test("Beat-Loops und Beat-Jump", () => {
  assert.deepEqual(L.beatLoop(10.3, 120, 0, 4), { start: 10, end: 12 });
  assert.deepEqual(L.beatLoop(10.3, 120, 0.1, 1), { start: 10.1, end: 10.6 });
  near(L.beatJump(10, 120, -4), 8);
  assert.equal(L.beatJump(0.5, 120, -4), 0);
});

test("CDJ-Cue-Logik", () => {
  assert.deepEqual(L.cuePress({ playing: true, pos: 30, cue: 5 }), [{ seek: 5 }, { play: false }]);
  assert.deepEqual(L.cuePress({ playing: false, pos: 12, cue: 5 }), [{ setCue: 12 }]);
  assert.deepEqual(L.cuePress({ playing: false, pos: 5, cue: 5 }), [{ play: true }, { preview: true }]);
  assert.deepEqual(L.cueRelease({ preview: true, cue: 5 }), [{ play: false }, { seek: 5 }, { preview: false }]);
  assert.deepEqual(L.cueRelease({ preview: false, cue: 5 }), []);
});

test("Hot Cues", () => {
  const empty = Array(8).fill(null);
  const r1 = L.hotcuePress(empty, 2, 33.3);
  assert.equal(r1.cues[2], 33.3); assert.deepEqual(r1.actions, []);
  assert.equal(empty[2], null);   // unverändert (immutable)
  const r2 = L.hotcuePress(r1.cues, 2, 99);
  assert.deepEqual(r2.actions, [{ seek: 33.3 }, { play: true }]);
});

test("Scratch-Geschwindigkeit", () => {
  near(L.scratchVelocity(720, 1.8), 1);   // eine Umdrehung in 1,8 s = Normaltempo
  assert.equal(L.scratchVelocity(5, 0), 0);
  assert.ok(L.scratchVelocity(-10, 0.01) < 0);
});

test("Camelot-Kompatibilität", () => {
  assert.ok(L.camelotCompatible("8A", "8A"));
  assert.ok(L.camelotCompatible("8A", "9A"));
  assert.ok(L.camelotCompatible("12B", "1B"));
  assert.ok(L.camelotCompatible("8A", "8B"));
  assert.ok(!L.camelotCompatible("8A", "10A"));
});
