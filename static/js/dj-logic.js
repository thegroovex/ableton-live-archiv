/* Reine DJ-Logik ohne Audio/DOM – im Browser als window.DJL, in Tests per require(). */
(function (root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TEMPO_RANGES = [0.06, 0.10, 0.16, 0.5];

  /* Tempo-Fader 0..1 (oben..unten) → Abspielrate. Pioneer-Konvention: nach unten = schneller. */
  function sliderToRate(v, range = 0.10, invert = false) {
    const x = clamp(v, 0, 1);
    const pct = (x - 0.5) * 2 * range * (invert ? -1 : 1);
    return 1 + (Math.abs(x - 0.5) < 0.004 ? 0 : pct);  // kleine Mittelraste
  }

  /* EQ-Regler 0..1 → dB (Mitte 0 dB, links bis Kill, rechts +6 dB) */
  function knobToEqDb(v) {
    const x = clamp(v, 0, 1);
    if (Math.abs(x - 0.5) < 0.01) return 0;
    if (x > 0.5) return (x - 0.5) * 2 * 6;
    if (x < 0.02) return -40;
    return (0.5 - x) * 2 * -26;
  }

  /* Trim 0..1 → Verstärkung (Mitte = 1, ±12 dB) */
  function trimToGain(v) { return Math.pow(10, ((clamp(v, 0, 1) - 0.5) * 24) / 20); }

  /* Crossfader 0..1 → [GainA, GainB]; in der Mitte beide voll (Club-Kurve) */
  function crossfaderGains(x) {
    x = clamp(x, 0, 1);
    const a = x <= 0.5 ? 1 : Math.cos((x - 0.5) * Math.PI);
    const b = x >= 0.5 ? 1 : Math.cos((0.5 - x) * Math.PI);
    return [Math.max(0, a), Math.max(0, b)];
  }

  /* Color-FX-Filter 0..1: links Lowpass, rechts Highpass, Mitte aus */
  function filterParams(v) {
    const x = clamp(v, 0, 1);
    if (Math.abs(x - 0.5) < 0.03) return { type: "off" };
    if (x < 0.5) {
      const t = (0.47 - x) / 0.47;       // 0..1
      return { type: "lowpass", freq: 20000 * Math.pow(150 / 20000, clamp(t, 0, 1)), q: 0.9 + t * 2 };
    }
    const t = (x - 0.53) / 0.47;
    return { type: "highpass", freq: 20 * Math.pow(6000 / 20, clamp(t, 0, 1)), q: 0.9 + t * 2 };
  }

  /* Rate, damit Deck (bpm) zur effektiven Ziel-BPM passt; halbes/doppeltes Tempo wird erkannt */
  function syncRate(bpm, targetBpm) {
    if (!bpm || !targetBpm) return 1;
    let t = targetBpm;
    while (t / bpm > 1.5) t /= 2;
    while (t / bpm < 0.67) t *= 2;
    return t / bpm;
  }

  function beatPhase(pos, bpm, grid = 0) {
    const period = 60 / bpm;
    const ph = ((pos - grid) / period) % 1;
    return ph < 0 ? ph + 1 : ph;
  }

  /* Wie viele Sekunden muss Deck A springen, um mit Deck B im Takt (Beat) zu sein? */
  function phaseCorrection(posA, bpmA, gridA, posB, bpmB, gridB) {
    if (!bpmA || !bpmB) return 0;
    let d = beatPhase(posB, bpmB, gridB) - beatPhase(posA, bpmA, gridA);
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d * (60 / bpmA);
  }

  /* Loop über n Beats ab dem letzten Beat vor pos (quantisiert) */
  function beatLoop(pos, bpm, grid = 0, beats = 4, quantize = true) {
    if (!bpm) return { start: pos, end: pos + beats * 0.5 };
    const period = 60 / bpm;
    const start = quantize ? grid + Math.floor((pos - grid) / period + 1e-6) * period : pos;
    return { start: Math.max(0, start), end: Math.max(0, start) + beats * period };
  }

  function beatJump(pos, bpm, beats) { return bpm ? Math.max(0, pos + beats * 60 / bpm) : pos; }

  /* CDJ-Cue-Verhalten. Gibt eine Liste von Aktionen zurück. */
  function cuePress(state) {
    const { playing, pos, cue } = state;
    if (playing) return [{ seek: cue ?? 0 }, { play: false }];
    if (cue == null || Math.abs(pos - cue) > 0.02) return [{ setCue: pos }];
    return [{ play: true }, { preview: true }];   // gehalten = Vorhören
  }
  function cueRelease(state) {
    if (state.preview) return [{ play: false }, { seek: state.cue ?? 0 }, { preview: false }];
    return [];
  }

  /* Hot-Cue-Pad: leer → setzen, belegt → springen (und abspielen) */
  function hotcuePress(cues, index, pos) {
    const c = cues.slice();
    if (c[index] == null) { c[index] = pos; return { cues: c, actions: [] }; }
    return { cues: c, actions: [{ seek: c[index] }, { play: true }] };
  }

  /* Jog-Ticks → Scratch-Geschwindigkeit. 720 Ticks/Umdrehung bei 33⅓ U/min = 1,8 s Audio pro Umdrehung */
  function scratchVelocity(ticks, dtSec) {
    if (dtSec <= 0) return 0;
    return (ticks * (1.8 / 720)) / dtSec;
  }

  /* Camelot-Nachbarn für harmonisches Mixen */
  function camelotCompatible(a, b) {
    if (!a || !b) return false;
    const na = parseInt(a), nb = parseInt(b), la = a.slice(-1), lb = b.slice(-1);
    if (a === b) return true;
    if (na === nb && la !== lb) return true;
    return la === lb && (Math.abs(na - nb) === 1 || Math.abs(na - nb) === 11);
  }


  /* ---------- Beatgrid ---------- */
  /* Position auf den nächsten (round) bzw. vorigen (floor) Beat einrasten */
  function snapToBeat(pos, bpm, grid = 0, mode = "round") {
    if (!bpm) return pos;
    const period = 60 / bpm, n = (pos - grid) / period;
    const k = mode === "floor" ? Math.floor(n + 1e-6) : Math.round(n);
    return Math.max(0, grid + k * period);
  }
  /* Grid-Offset immer in [0, Beatlänge) halten */
  function normGrid(grid, bpm) {
    if (!bpm) return grid;
    const p = 60 / bpm; let g = grid % p; if (g < 0) g += p;
    return Math.round(g * 1e5) / 1e5;
  }
  /* Downbeat genau hier setzen: Grid so verschieben, dass pos auf einem Beat liegt */
  function gridFromDownbeat(pos, bpm) { return normGrid(pos, bpm); }
  /* Takt-Position 1..4 und Beatnummer seit Grid-Start */
  function barBeat(pos, bpm, grid = 0) {
    if (!bpm) return { beat: 0, bar: 0, index: 0 };
    const idx = Math.floor((pos - grid) / (60 / bpm) + 1e-6);
    return { index: idx, beat: ((idx % 4) + 4) % 4 + 1, bar: Math.floor(idx / 4) + 1 };
  }
  /* Tap-Tempo: Zeitstempel in Sekunden → BPM (Median der Abstände, Pausen > 2 s starten neu) */
  function tapTempo(taps) {
    const t = taps.slice(-9);
    let start = 0;
    for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > 2) start = i;
    const iv = []; for (let i = start + 1; i < t.length; i++) iv.push(t[i] - t[i - 1]);
    if (iv.length < 3) return 0;
    iv.sort((a, b) => a - b);
    const med = iv[Math.floor(iv.length / 2)];
    return Math.round(6000 / med) / 100;
  }

  /* ---------- Loops wie am CDJ ---------- */
  function loopHalve(loop) { if (!loop) return null; const len = (loop.end - loop.start) / 2; return len < 0.01 ? loop : { start: loop.start, end: loop.start + len }; }
  function loopDouble(loop, duration = Infinity) { if (!loop) return null; const len = (loop.end - loop.start) * 2; return { start: loop.start, end: Math.min(duration, loop.start + len) }; }
  function loopMove(loop, dir = 1) { if (!loop) return null; const len = loop.end - loop.start, s = Math.max(0, loop.start + dir * len); return { start: s, end: s + len }; }
  function loopBeats(loop, bpm) { return loop && bpm ? Math.round((loop.end - loop.start) / (60 / bpm) * 1000) / 1000 : 0; }
  /* Loop-Länge für die Anzeige: 1/4, 1/2, 1, 2 … */
  function loopLabel(beats) {
    if (!beats) return "";
    if (beats < 1) { const d = Math.round(1 / beats); return Math.abs(1 / d - beats) < 0.01 ? "1/" + d : beats.toFixed(2); }
    return Math.abs(beats - Math.round(beats)) < 0.01 ? String(Math.round(beats)) : beats.toFixed(2);
  }

  /* ---------- Beatmatching ---------- */
  /* Phasenversatz von Deck A zu B in Beats (-0.5 .. 0.5); positiv = A läuft vor */
  function phaseOffset(posA, bpmA, gridA, posB, bpmB, gridB) {
    if (!bpmA || !bpmB) return 0;
    let d = beatPhase(posA, bpmA, gridA) - beatPhase(posB, bpmB, gridB);
    if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
    return d;
  }

  /* ---------- Tastatur ---------- */
  /* e.code → Aktion. Codes sind layoutunabhängig; die Labels zeigen die deutsche Tastatur (QWERTZ). */
  const KEYMAP = {
    // Deck A (linke Hand)
    KeyQ: { deck: 0, action: "play", label: "Q" }, KeyW: { deck: 0, action: "cue", label: "W" }, KeyE: { deck: 0, action: "sync", label: "E" },
    KeyR: { deck: 0, action: "nudge", dir: -1, label: "R" }, KeyT: { deck: 0, action: "nudge", dir: 1, label: "T" },
    KeyA: { deck: 0, action: "loopIn", label: "A" }, KeyS: { deck: 0, action: "loopOut", label: "S" }, KeyD: { deck: 0, action: "reloop", label: "D" },
    KeyF: { deck: 0, action: "autoLoop", label: "F" }, KeyX: { deck: 0, action: "loopHalve", label: "X" }, KeyC: { deck: 0, action: "loopDouble", label: "C" },
    KeyG: { deck: 0, action: "keylock", label: "G" }, KeyV: { deck: 0, action: "tap", label: "V" },
    Digit1: { deck: 0, action: "hotcue", index: 0, label: "1" }, Digit2: { deck: 0, action: "hotcue", index: 1, label: "2" },
    Digit3: { deck: 0, action: "hotcue", index: 2, label: "3" }, Digit4: { deck: 0, action: "hotcue", index: 3, label: "4" },
    // Deck B (rechte Hand)
    KeyP: { deck: 1, action: "play", label: "P" }, KeyO: { deck: 1, action: "cue", label: "O" }, KeyI: { deck: 1, action: "sync", label: "I" },
    KeyY: { deck: 1, action: "nudge", dir: -1, label: "Z" }, KeyU: { deck: 1, action: "nudge", dir: 1, label: "U" },
    KeyJ: { deck: 1, action: "autoLoop", label: "J" }, KeyK: { deck: 1, action: "loopIn", label: "K" }, KeyL: { deck: 1, action: "loopOut", label: "L" },
    Semicolon: { deck: 1, action: "reloop", label: "Ö" }, KeyM: { deck: 1, action: "loopHalve", label: "M" }, Comma: { deck: 1, action: "loopDouble", label: "," },
    KeyH: { deck: 1, action: "keylock", label: "H" }, KeyN: { deck: 1, action: "tap", label: "N" },
    Digit7: { deck: 1, action: "hotcue", index: 0, label: "7" }, Digit8: { deck: 1, action: "hotcue", index: 1, label: "8" },
    Digit9: { deck: 1, action: "hotcue", index: 2, label: "9" }, Digit0: { deck: 1, action: "hotcue", index: 3, label: "0" },
    // Global
    ArrowUp: { deck: null, action: "browse", dir: -1, label: "↑" }, ArrowDown: { deck: null, action: "browse", dir: 1, label: "↓" },
    ArrowLeft: { deck: 0, action: "load", label: "←" }, ArrowRight: { deck: 1, action: "load", label: "→" },
    KeyB: { deck: null, action: "xfader", dir: 0, label: "B" },
    Minus: { deck: null, action: "help", label: "?" },
  };
  /* Taste + Modifier → konkretes Ereignis. Shift/Alt verändern die Bedeutung wie am Controller. */
  function keyEvent(code, mods = {}) {
    const m = KEYMAP[code]; if (!m) return null;
    const ev = { ...m };
    if (m.action === "nudge" && mods.shift) return { deck: m.deck, action: "beatjump", beats: 4 * m.dir };
    if (m.action === "nudge" && mods.alt) return { deck: m.deck, action: "pitchStep", step: 0.0005 * m.dir };
    if (m.action === "hotcue" && mods.shift) ev.clear = true;
    if (m.action === "loopIn" && mods.shift) return { deck: m.deck, action: "loopMove", dir: -1 };
    if (m.action === "loopOut" && mods.shift) return { deck: m.deck, action: "loopMove", dir: 1 };
    if (m.action === "load" && mods.shift) return { deck: null, action: "xfader", dir: m.deck ? 1 : -1 };
    if (m.action === "keylock" && mods.shift) return { deck: m.deck, action: "gridHere" };
    return ev;
  }

  const api = { snapToBeat, normGrid, gridFromDownbeat, barBeat, tapTempo, loopHalve, loopDouble, loopMove, loopBeats, loopLabel,
    phaseOffset, KEYMAP, keyEvent, clamp, TEMPO_RANGES, sliderToRate, knobToEqDb, trimToGain, crossfaderGains, filterParams, syncRate,
    beatPhase, phaseCorrection, beatLoop, beatJump, cuePress, cueRelease, hotcuePress, scratchVelocity, camelotCompatible };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DJL = api;
})(typeof window !== "undefined" ? window : globalThis);
