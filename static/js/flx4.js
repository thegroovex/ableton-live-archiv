/* Pioneer DDJ-FLX4 – MIDI-Mapping (Werte nach dem offenen Mixxx-Mapping des FLX4).
   Übersetzt rohe MIDI-Bytes in Ereignisse wie {deck:0, action:"play", value:1}.
   Läuft auch ohne Browser (Node/Tests): module.exports wird gesetzt, wenn vorhanden. */
(function (root) {
  const DECK_NOTE = { 0x90: 0, 0x91: 1 };      // Deck-Tasten
  const DECK_CC = { 0xB0: 0, 0xB1: 1 };        // Deck-Regler
  const PAD = { 0x97: [0, false], 0x98: [0, true], 0x99: [1, false], 0x9A: [1, true] }; // [deck, shift]

  const NOTE_ACTIONS = {
    0x0B: "play", 0x0C: "cue", 0x36: "jogTouch", 0x67: "jogTouch", 0x58: "sync", 0x54: "headCue",
    0x10: "loopIn", 0x11: "loopOut", 0x4D: "reloop", 0x3F: "shift", 0x60: "tempoRange",
    0x48: "playShift", 0x0E: "cueShift",
    // CUE/LOOP CALL ◀ ▶ – bei aktivem Loop halbieren/verdoppeln (wie DDJ-400/rekordbox)
    0x51: "loopHalve", 0x53: "loopDouble",
    0x1B: "padMode:hotcue", 0x1E: "padMode:beatloop", 0x20: "padMode:beatjump", 0x22: "padMode:sampler",
  };
  const CC_ACTIONS = {
    0x00: "tempoMSB", 0x20: "tempoLSB", 0x13: "volumeMSB", 0x33: "volumeLSB", 0x04: "trimMSB", 0x24: "trimLSB",
    0x07: "eqHighMSB", 0x27: "eqHighLSB", 0x0B: "eqMidMSB", 0x2B: "eqMidLSB", 0x0F: "eqLowMSB", 0x2F: "eqLowLSB",
    0x21: "jogBend", 0x22: "jogScratch", 0x23: "jogScratch", 0x29: "jogSearch",
  };
  const GLOBAL_CC = { 0x1F: "crossfaderMSB", 0x3F: "crossfaderLSB", 0x17: "filter0MSB", 0x37: "filter0LSB",
    0x18: "filter1MSB", 0x38: "filter1LSB", 0x0C: "headMixMSB", 0x2C: "headMixLSB", 0x40: "browse" };
  const GLOBAL_NOTE = { 0x46: "load0", 0x47: "load1", 0x41: "browsePress", 0x42: "browseBack" };

  function decode(status, d1, d2) {
    if (status in DECK_NOTE && d1 in NOTE_ACTIONS) {
      const a = NOTE_ACTIONS[d1];
      if (a.startsWith("padMode:")) return { deck: DECK_NOTE[status], action: "padMode", mode: a.split(":")[1], value: d2 };
      return { deck: DECK_NOTE[status], action: a, value: d2 > 0 ? 1 : 0, raw: d2 };
    }
    if ((status & 0xF0) === 0x80 && (0x90 | (status & 0x0F)) in DECK_NOTE && d1 in NOTE_ACTIONS) {
      return { deck: DECK_NOTE[0x90 | (status & 0x0F)], action: NOTE_ACTIONS[d1], value: 0, raw: 0 }; // Note-Off
    }
    if (status in DECK_CC && d1 in CC_ACTIONS) {
      const a = CC_ACTIONS[d1];
      if (a.startsWith("jog")) return { deck: DECK_CC[status], action: a, value: d2 - 64 };
      return { deck: DECK_CC[status], action: a, value: d2 };
    }
    if (status === 0xB6 && d1 in GLOBAL_CC) {
      const a = GLOBAL_CC[d1];
      if (a === "browse") return { deck: null, action: "browse", value: d2 > 64 ? d2 - 128 : d2 };
      const m = a.match(/^filter(\d)(MSB|LSB)$/);
      if (m) return { deck: +m[1], action: "filter" + m[2], value: d2 };
      return { deck: null, action: a, value: d2 };
    }
    if (status === 0x96 && d1 in GLOBAL_NOTE) {
      const a = GLOBAL_NOTE[d1];
      if (a.startsWith("load")) return { deck: +a.slice(4), action: "load", value: d2 > 0 ? 1 : 0 };
      return { deck: null, action: a, value: d2 > 0 ? 1 : 0 };
    }
    if (status in PAD) {
      const [deck, shift] = PAD[status];
      if (d1 <= 0x07) return { deck, action: shift ? "hotcueClear" : "hotcue", index: d1, value: d2 > 0 ? 1 : 0 };
      if (d1 >= 0x60 && d1 <= 0x67) return { deck, action: "beatloop", beats: [0.25, 0.5, 1, 2, 4, 8, 16, 32][d1 - 0x60], value: d2 > 0 ? 1 : 0 };
      if (d1 >= 0x20 && d1 <= 0x27) return { deck, action: "beatjump", beats: [-1, 1, -2, 2, -4, 4, -8, 8][d1 - 0x20], value: d2 > 0 ? 1 : 0 };
    }
    return null;
  }

  /* 14-Bit-Regler: MSB merken, beim LSB kombinieren. Liefert 0..1 */
  class HiRes {
    constructor() { this.msb = {}; }
    feed(key, part, v) {
      if (part === "MSB") { this.msb[key] = v; return v / 127; }
      return (((this.msb[key] || 0) << 7) + v) / 16383;
    }
  }

  /* Ausgehende LED-Nachrichten */
  const LED = {
    play: (deck, on) => [0x90 + deck, 0x0B, on ? 0x7F : 0],
    cue: (deck, on) => [0x90 + deck, 0x0C, on ? 0x7F : 0],
    sync: (deck, on) => [0x90 + deck, 0x58, on ? 0x7F : 0],
    headCue: (deck, on) => [0x90 + deck, 0x54, on ? 0x7F : 0],
    loop: (deck, on) => [0x90 + deck, 0x10, on ? 0x7F : 0],
    hotcue: (deck, i, on) => [0x97 + deck * 2, i, on ? 0x7F : 0],
    vu: (deck, level) => [0xB0 + deck, 0x02, Math.max(0, Math.min(127, Math.round(level * 127)))],
    loadAnim: deck => [0x9F, deck, 0x7F],
  };

  const api = { decode, HiRes, LED };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FLX4 = api;
})(typeof window !== "undefined" ? window : globalThis);
