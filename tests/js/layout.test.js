const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../static/js/layout.js");

test("Blockgrößen werden begrenzt", () => {
  assert.equal(L.resize("sidebar", 220, 50), 270);
  assert.equal(L.resize("sidebar", 220, -500), L.LIMITS.sidebar.min);
  assert.equal(L.resize("sidebar", 220, 5000), L.LIMITS.sidebar.max);
  assert.equal(L.resize("mixer", 230, 40), 270);
  assert.equal(L.resize("decks", 300, 1000, 800), 680);   // max 85 % der View
  assert.equal(L.resize("decks", 300, -500, 800), L.LIMITS.decks.min);
});

test("Deck-A-Anteil", () => {
  assert.ok(Math.abs(L.resize("deckA", 0.5, 100, 1000) - 0.6) < 1e-9);
  assert.equal(L.resize("deckA", 0.5, -2000, 1000), 0.2);
  assert.equal(L.resize("deckA", 0.5, 2000, 1000), 0.8);
});
