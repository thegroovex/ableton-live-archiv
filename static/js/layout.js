/* Live Archiv – verstellbare Blöcke (Splitter wie in Ableton Live).
   Ziehen an den Trennleisten ändert die Größe, Doppelklick setzt die eine Leiste zurück.
   Größen werden im Browser (localStorage) gespeichert. */
(function (root) {
  const KEY = "liveArchiv.layout.v1";

  // Grenzen je Block: [min, max] in Pixeln (max darf ein Anteil des Containers sein)
  const LIMITS = {
    sidebar: { min: 140, max: 480, def: 220 },   // Archiv: Browser links
    detail:  { min: 240, max: 720, def: 340 },   // Archiv: Detailansicht rechts
    mixer:   { min: 170, max: 420, def: 230 },   // DJ: Mixer-Breite
    deckA:   { min: 0.2, max: 0.8, def: 0.5 },   // DJ: Anteil Deck A an (A+B)
    crates:  { min: 130, max: 420, def: 200 },   // DJ: Crates-Spalte
    decks:   { min: 220, max: 0.85, def: null },  // DJ: Höhe Decks (null = automatisch); max als Anteil der View
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Reiner Rechenkern (testbar): neue Größe nach Ziehen um delta Pixel
  function resize(name, start, delta, container) {
    const l = LIMITS[name];
    const max = l.max <= 1 && container ? l.max * container : l.max;
    if (name === "deckA") return clamp(start + delta / Math.max(1, container), l.min, l.max);
    return Math.round(clamp(start + delta, l.min, Math.max(l.min, max)));
  }

  function load() {
    try { return JSON.parse(root.localStorage?.getItem(KEY) || "{}") || {}; } catch { return {}; }
  }
  function save(s) { try { root.localStorage?.setItem(KEY, JSON.stringify(s)); } catch {} }

  let state = {};

  function apply() {
    const doc = root.document; if (!doc) return;
    const a = doc.getElementById("view-archive"), dj = doc.getElementById("view-dj");
    const set = (el, prop, v) => { if (!el) return; v == null ? el.style.removeProperty(prop) : el.style.setProperty(prop, v); };
    set(a, "--sidebar-w", state.sidebar != null ? state.sidebar + "px" : null);
    set(a, "--detail-w", state.detail != null ? state.detail + "px" : null);
    set(dj, "--mixer-w", state.mixer != null ? state.mixer + "px" : null);
    const fa = state.deckA ?? LIMITS.deckA.def;
    set(dj, "--deck-a", fa.toFixed(4) + "fr");
    set(dj, "--deck-b", (1 - fa).toFixed(4) + "fr");
    set(dj, "--crates-w", state.crates != null ? state.crates + "px" : null);
    set(dj, "--decks-h", state.decks != null ? state.decks + "px" : null);
    dj?.classList.toggle("decks-sized", state.decks != null);
  }

  function gutter(dir, title) {
    const g = root.document.createElement("div");
    g.className = "gutter " + dir;
    g.title = title + " – ziehen zum Verstellen, Doppelklick setzt zurück";
    return g;
  }

  // Ziehen: measure() liefert {start, container}, sign = Richtung (+1/-1)
  function bind(g, name, axis, sign, measure) {
    g.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const { start, container } = measure();
      const p0 = axis === "x" ? e.clientX : e.clientY;
      g.setPointerCapture(e.pointerId);
      g.classList.add("drag");
      root.document.body.classList.add("resizing", "resizing-" + axis);
      const move = ev => {
        const d = ((axis === "x" ? ev.clientX : ev.clientY) - p0) * sign;
        state[name] = resize(name, start, d, container);
        apply();
        if (typeof root.drawDetailWave === "function") root.drawDetailWave();
      };
      const up = () => {
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
        g.classList.remove("drag");
        root.document.body.classList.remove("resizing", "resizing-x", "resizing-y");
        save(state);
        root.dispatchEvent(new Event("resize"));
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    });
    g.addEventListener("dblclick", () => { delete state[name]; apply(); save(state); });
  }

  function init() {
    const $ = s => root.document.querySelector(s);
    state = load();

    // ---- Archiv: Browser | Liste | Detail
    const side = $("#sidebar"), main = $("#view-archive > .main"), detail = $("#detail");
    if (side && main && detail) {
      const g1 = gutter("v", "Browserbreite"), g2 = gutter("v", "Detailbreite");
      side.after(g1); main.after(g2);
      bind(g1, "sidebar", "x", 1, () => ({ start: side.getBoundingClientRect().width, container: innerWidth * 0.4 }));
      bind(g2, "detail", "x", -1, () => ({ start: detail.getBoundingClientRect().width, container: innerWidth * 0.6 }));
    }

    // ---- DJ: Deck A | Mixer | Deck B, darunter die Bibliothek
    const decks = $("#view-dj .decks"), dA = $("#deck-0"), mixer = $("#mixer"), dB = $("#deck-1");
    if (decks && dA && mixer && dB) {
      const g3 = gutter("v", "Deck A / Mixer"), g4 = gutter("v", "Mixer / Deck B"), g5 = gutter("h", "Höhe der Decks");
      dA.after(g3); mixer.after(g4); decks.after(g5);
      const deckSum = () => dA.getBoundingClientRect().width + dB.getBoundingClientRect().width;
      // Linke Leiste: verschiebt Deck A gegen Deck B (Mixer wandert mit)
      bind(g3, "deckA", "x", 1, () => ({ start: state.deckA ?? dA.getBoundingClientRect().width / deckSum(), container: deckSum() }));
      // Rechte Leiste: Mixerbreite
      bind(g4, "mixer", "x", 1, () => ({ start: mixer.getBoundingClientRect().width, container: 0 }));
      bind(g5, "decks", "y", 1, () => ({ start: decks.getBoundingClientRect().height, container: $("#view-dj").getBoundingClientRect().height }));
    }
    const crates = $("#crates");
    if (crates) {
      const g6 = gutter("v", "Breite der Crates");
      crates.after(g6);
      bind(g6, "crates", "x", 1, () => ({ start: crates.getBoundingClientRect().width, container: 0 }));
    }
    apply();

    const btn = $("#s-layout-reset");
    if (btn) btn.onclick = () => { state = {}; save(state); apply(); root.toast?.("Layout zurückgesetzt"); };
  }

  const api = { LIMITS, resize, clamp, KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.Layout = api;
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
