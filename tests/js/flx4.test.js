// node --test tests/js
const test = require("node:test");
const assert = require("node:assert/strict");
const FLX4 = require("../../static/js/flx4.js");

test("Play/Cue auf beiden Decks", () => {
  assert.deepEqual(FLX4.decode(0x90, 0x0B, 0x7F), { deck: 0, action: "play", value: 1, raw: 0x7F });
  assert.equal(FLX4.decode(0x91, 0x0B, 0x7F).deck, 1);
  assert.equal(FLX4.decode(0x90, 0x0C, 0x00).value, 0);           // Cue losgelassen
  assert.equal(FLX4.decode(0x80, 0x0C, 0x40).action, "cue");      // Note-Off-Variante
});

test("Jog-Rad: relative Werte um 64", () => {
  assert.deepEqual(FLX4.decode(0xB0, 0x22, 66), { deck: 0, action: "jogScratch", value: 2 });
  assert.equal(FLX4.decode(0xB1, 0x21, 60).value, -4);
  assert.equal(FLX4.decode(0x90, 0x36, 0x7F).action, "jogTouch");
});

test("Mixer: Crossfader, Filter, Load, Browse", () => {
  assert.deepEqual(FLX4.decode(0xB6, 0x1F, 64), { deck: null, action: "crossfaderMSB", value: 64 });
  assert.deepEqual(FLX4.decode(0xB6, 0x18, 10), { deck: 1, action: "filterMSB", value: 10 });
  assert.deepEqual(FLX4.decode(0x96, 0x47, 0x7F), { deck: 1, action: "load", value: 1 });
  assert.equal(FLX4.decode(0xB6, 0x40, 0x01).value, 1);
  assert.equal(FLX4.decode(0xB6, 0x40, 0x7F).value, -1);
});

test("Pads: Hot Cues, Shift-Löschen, Beat Loop, Beat Jump", () => {
  assert.deepEqual(FLX4.decode(0x97, 0x03, 0x7F), { deck: 0, action: "hotcue", index: 3, value: 1 });
  assert.equal(FLX4.decode(0x9A, 0x00, 0x7F).action, "hotcueClear");
  assert.equal(FLX4.decode(0x9A, 0x00, 0x7F).deck, 1);
  assert.equal(FLX4.decode(0x97, 0x64, 0x7F).beats, 4);
  assert.equal(FLX4.decode(0x99, 0x23, 0x7F).beats, 2);
});

test("Unbekannte Nachrichten werden ignoriert", () => {
  assert.equal(FLX4.decode(0xF8, 0, 0), null);
  assert.equal(FLX4.decode(0x90, 0x7E, 0x7F), null);
});

test("14-Bit-Auflösung für Fader", () => {
  const h = new FLX4.HiRes();
  h.feed("t", "MSB", 64);
  assert.equal(h.feed("t", "LSB", 0), 8192 / 16383);
  h.feed("t", "MSB", 127);
  assert.equal(h.feed("t", "LSB", 127), 1);
});

test("LED-Ausgabe", () => {
  assert.deepEqual(FLX4.LED.play(1, true), [0x91, 0x0B, 0x7F]);
  assert.deepEqual(FLX4.LED.hotcue(1, 2, true), [0x99, 2, 0x7F]);
  assert.deepEqual(FLX4.LED.vu(0, 2), [0xB0, 0x02, 127]);
});
