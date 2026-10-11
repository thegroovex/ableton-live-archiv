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

test("Beatgrid: Einrasten, Downbeat, Takt", () => {
  near(L.snapToBeat(1.26, 120, 0), 1.5);
  near(L.snapToBeat(1.26, 120, 0, "floor"), 1.0);
  near(L.gridFromDownbeat(10.1, 120), 0.1);
  near(L.normGrid(-0.1, 120), 1.9);   // Takt (4 Beats) = 2 s
  near(L.gridFromDownbeat(10.6, 120), 0.6);
  near(L.regrid(10.5, 120, 0, 100), L.normGrid(10.5 - 21 * 0.6, 100));
  assert.deepEqual(L.barBeat(2.6, 120, 0), { index: 5, beat: 2, bar: 2 });
});

test("Tap-Tempo", () => {
  assert.equal(L.tapTempo([0, 0.5, 1.0]), 0);
  assert.equal(L.tapTempo([0, 0.5, 1.0, 1.5, 2.0]), 120);
  assert.equal(L.tapTempo([0, 0.5, 5, 5.48, 5.96, 6.44]), 125);   // Pause startet neu
});

test("CDJ-Loops: halbieren, verdoppeln, verschieben, Label", () => {
  assert.deepEqual(L.loopHalve({ start: 1, end: 3 }), { start: 1, end: 2 });
  assert.deepEqual(L.loopDouble({ start: 1, end: 3 }), { start: 1, end: 5 });
  assert.deepEqual(L.loopMove({ start: 2, end: 4 }, -1), { start: 0, end: 2 });
  assert.equal(L.loopBeats({ start: 0, end: 2 }, 120), 4);
  assert.equal(L.loopLabel(0.25), "1/4");
  assert.equal(L.loopLabel(16), "16");
});

test("Phasenversatz für die Beatmatch-Anzeige", () => {
  near(L.phaseOffset(0.1, 120, 0, 0, 120, 0), 0.2);
  near(L.phaseOffset(0.45, 120, 0, 0, 120, 0), -0.1);
});

test("Tastatur: Codes und Modifier", () => {
  assert.equal(L.keyEvent("KeyQ").action, "play");
  assert.equal(L.keyEvent("KeyY").deck, 1);                       // Z auf deutscher Tastatur
  assert.deepEqual(L.keyEvent("KeyR", { shift: true }), { deck: 0, action: "beatjump", beats: -4 });
  assert.equal(L.keyEvent("KeyT", { alt: true }).step, 0.0005);
  assert.equal(L.keyEvent("Digit2", { shift: true }).clear, true);
  assert.equal(L.keyEvent("KeyZ"), null);
});

test("Tonhöhe: Tempo in Halbtönen und klingende Tonart", () => {
  assert.ok(Math.abs(L.tempoSemis(Math.pow(2, 1 / 12)) - 1) < 1e-9);
  assert.equal(L.tempoSemis(1), 0);
  // A-Moll mit +5,95 % ohne Key Lock klingt wie A#-Moll
  assert.ok(Math.abs(L.effectivePitch({ root: "A", rate: Math.pow(2, 1 / 12) }) - 10) < 1e-9);
  assert.equal(L.effectivePitch({ root: "A", rate: 1.2, keylock: true }), 9);
  assert.equal(L.effectivePitch({ root: "C", shift: -1 }), 11);
  assert.equal(L.effectivePitch({ root: null }), null);
  assert.deepEqual(L.pitchName(9.9), { root: "A#", cents: -10 });
});

test("Key Sync: gleiche Tonart, Paralleltonart, kompatibel, Repitch", () => {
  const am = { root: "A", mode: "Moll", rate: 1, keylock: true };
  // gleiche Tonart erzwingen: C-Moll → A-Moll = −3 Halbtöne
  assert.equal(L.keySyncShift({ root: "C", mode: "Moll", rate: 1, keylock: true }, am, true), -3);
  // kompatibel: C-Moll (5A) passt zu A-Moll (8A)? kleinste Verschiebung zu 8A/9A/7A → D-Moll (7A) = +2
  assert.equal(L.keySyncShift({ root: "C", mode: "Moll", rate: 1, keylock: true }, am), 2);
  // Paralleltonart: G-Dur → A-Moll heißt C-Dur (8B) = +5 bzw. −7 → kleinste: +5
  assert.equal(L.keySyncShift({ root: "G", mode: "Dur", rate: 1, keylock: true }, am, true), 5);
  // Repitch: gleiche Tonart, aber +6 % schneller → klingt einen Halbton höher → −1 zurück
  assert.equal(L.keySyncShift({ root: "A", mode: "Moll", rate: Math.pow(2, 1 / 12), keylock: false }, am, true), -1);
  // anderes Deck ist transponiert
  assert.equal(L.keySyncShift({ root: "A", mode: "Moll", rate: 1, keylock: true }, { ...am, shift: 2 }, true), 2);
  assert.equal(L.keySyncShift({ root: null, mode: "Moll" }, am), null);
  // Hysterese am Tritonus: bleibt auf der bisherigen Richtung
  const tri = L.keySyncShift({ root: "D#", mode: "Moll", rate: 1, keylock: true }, am, true, -6);
  assert.equal(Math.abs(tri), 6);
  assert.equal(tri, -6);
  assert.equal(L.keySyncShift({ root: "D#", mode: "Moll", rate: 1, keylock: true }, am, true, 6), 6);
});
