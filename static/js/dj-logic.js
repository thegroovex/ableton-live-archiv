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

  const api = { clamp, TEMPO_RANGES, sliderToRate, knobToEqDb, trimToGain, crossfaderGains, filterParams, syncRate,
    beatPhase, phaseCorrection, beatLoop, beatJump, cuePress, cueRelease, hotcuePress, scratchVelocity, camelotCompatible };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DJL = api;
})(typeof window !== "undefined" ? window : globalThis);
