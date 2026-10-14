// Übersetzung DE→EN und Windows-Begriffe, ohne Browser (vm-Sandbox).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

function load(lang, platform) {
  const store = { lang };
  const ctx = {
    navigator: { platform, userAgent: platform, language: "de-DE" },
    localStorage: { getItem: k => store[k] ?? null, setItem() {}, removeItem() {} },
    document: { documentElement: {}, readyState: "complete", title: "Live Archiv", body: null },
    location: { reload() {} }, alert() {}, confirm() {}, prompt() {}, NodeFilter: {}, MutationObserver: class { observe() {} },
  };
  ctx.window = ctx;
  ctx.document.body = { nodeType: 1, nodeName: "BODY", getAttribute: () => null };
  ctx.document.createTreeWalker = () => ({ nextNode: () => null });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../static/js/i18n.js"), "utf8"), ctx);
  return ctx;
}

test("Englisch: feste Texte und Texte mit Werten", () => {
  const { t } = load("en", "MacIntel");
  assert.equal(t("Scannen"), "Scan");
  assert.equal(t("  Alle Tracks "), "  All Tracks ");
  assert.equal(t("12 Projekte"), "12 projects");
  assert.equal(t("Warm-up · 5 Tracks"), "Warm-up · 5 tracks");
  assert.equal(t("3 Tracks → „Peak“"), "3 tracks → “Peak”");
  assert.equal(t("1 Track → „Peak“"), "1 track → “Peak”");
  assert.equal(t("Rendern: 2/5 – Öffne Song in Live …"), "Render: 2/5 – Opening Song in Live …");
  assert.equal(t("Beatgrid erkannt – Takt 1 bei 0.512 s"), "Beatgrid detected – bar 1 at 0.512 s");
  assert.equal(t("Im Finder zeigen"), "Show in Finder");
});

test("Deutsch auf dem Mac bleibt unverändert", () => {
  const { t } = load("de", "MacIntel");
  assert.equal(t("Im Finder zeigen"), "Im Finder zeigen");
  assert.equal(t("🔍 Titel, Artist, BPM, Tonart … (⌘F)"), "🔍 Titel, Artist, BPM, Tonart … (⌘F)");
});

test("Windows: Explorer und Strg/Ctrl statt Finder und ⌘", () => {
  assert.equal(load("de", "Win32").t("Im Finder zeigen"), "Im Explorer zeigen");
  assert.equal(load("de", "Win32").t("🔍 Titel, Artist, BPM, Tonart … (⌘F)"), "🔍 Titel, Artist, BPM, Tonart … (Strg+F)");
  assert.equal(load("en", "Win32").t("Im Finder zeigen"), "Show in Explorer");
  assert.equal(load("en", "Win32").t("🔍 Titel, Artist, BPM, Tonart … (⌘F)"), "🔍 Title, artist, BPM, key … (Ctrl+F)");
});

test("Alle sichtbaren Texte der Oberfläche haben eine englische Fassung", () => {
  const { t } = load("en", "MacIntel");
  const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  const texts = [...html.matchAll(/>([^<>]+)</g)].map(m => m[1].trim())
    .concat([...html.matchAll(/(?:placeholder|title)="([^"]+)"/g)].map(m => m[1].trim()))
    .filter(s => /[a-zäöüß]{3,}/.test(s) && !/^[~/.]/.test(s));
  const german = /\b(der|die|das|und|nach|aus|ein|eine|zurücksetzen|Alle|Neue|Ordner|Suchen|Einstellungen|Abbrechen|Speichern)\b|[äöüß]/;
  const missing = texts.filter(s => german.test(s) && t(s) === s && !["Deutsch", "English"].includes(s));
  assert.deepEqual(missing, []);
});

test("Englisch: Meldungen des Servers (Jobs, Fehler, Analyse)", () => {
  const { t } = load("en", "MacIntel");
  const msgs = [
    "Scan abgeschlossen: 5 Sets, davon 2 neu, 3 vorhandene MP3s zugeordnet.", "Analyse abgeschlossen.", "Import abgeschlossen.",
    "Rendern abgeschlossen.", "Bitte warten, bis der laufende Vorgang fertig ist.", "Bitte einen Namen angeben.",
    "Bitte in den Einstellungen eine Vorlage (.als) auswählen.", "Format nicht unterstützt",
    "Live hat den Export-Dialog nicht geöffnet. Übersprungen.",
  ];
  for (const m of msgs) assert.notEqual(t(m), m, m);
  assert.equal(t("Song.mp3: stumm, übersprungen"), "Song.mp3: silent, skipped");
  assert.equal(t("Song.mp3: zu kurz für eine Analyse (unter 3 s), übersprungen"), "Song.mp3: too short to analyze (under 3 s), skipped");
});
