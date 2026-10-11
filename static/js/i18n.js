// Sprache (Deutsch/Englisch) und Plattform-Begriffe (macOS/Windows).
// Der Quelltext bleibt deutsch. Dieses Skript übersetzt Texte, Platzhalter und Tooltips im DOM –
// auch alles, was die App später per JavaScript einfügt (MutationObserver) – sowie alert/confirm/prompt.
// Bei Deutsch auf dem Mac läuft gar nichts mit: kein Observer, kein Overhead.
(function () {
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const IS_WIN = /Win/.test(navigator.platform || navigator.userAgent);
  const stored = localStorage.getItem("lang");
  const LANG = stored === "de" || stored === "en" ? stored : ((navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en");
  window.I18N = { lang: LANG, isMac: IS_MAC, isWin: IS_WIN, mod: IS_MAC ? "⌘" : (LANG === "de" ? "Strg+" : "Ctrl+") };
  document.documentElement.lang = LANG;

  // ---------------------------------------------------------------- feste Texte
  const EN = {
    "Archiv": "Archive", "Scannen": "Scan", "MP3s rendern": "Render MP3s", "Analysieren": "Analyze",
    "+ Neues Projekt": "+ New Project", "Sammlungen": "Collections", "Alle Projekte": "All Projects", "Fertig": "Finished",
    "Skizzen": "Sketches", "Skizze": "Sketch", "Ohne MP3": "No MP3", "★ 4+ bewertet": "★ 4+ rated", "Tempo (BPM)": "Tempo (BPM)",
    "Tonart": "Key", "Alle": "All", "Dur": "Major", "Moll": "Minor", "Stimmung": "Mood", "Sortieren:": "Sort:",
    "Zuletzt geändert": "Last modified", "Bewertung": "Rating", "Länge": "Length", "Filter zurücksetzen": "Reset filters",
    "Geändert": "Modified", "Wähle ein Projekt aus.": "Select a project.",
    "Noch keine Projekte. Lege in den Einstellungen deinen Projektordner fest und klicke auf „Scannen“.": "No projects yet. Set your project folder in Settings and click “Scan”.",
    "Kein Controller": "No controller", "Standard-Ausgang": "Default output", "Ordner importieren": "Import folder",
    "Titel": "Title", "Quelle": "Source", "Aktion": "Action",
    "Musikdateien hierher ziehen (MP3, WAV, AIFF, FLAC, M4A) – sie werden importiert und analysiert.": "Drop music files here (MP3, WAV, AIFF, FLAC, M4A) – they are imported and analyzed.",
    "Bereit": "Ready", "Abbrechen": "Cancel", "Einstellungen": "Settings", "Projektordner": "Project folders", "Live-App": "Live app",
    "Vorlage (.als)": "Template (.als)", "Neue Projekte in": "New projects in", "Entfernte Projekte": "Removed projects",
    "Wieder anzeigen": "Show again", "Blockgrößen zurücksetzen": "Reset panel sizes", "Speichern": "Save", "Neues Projekt": "New Project",
    "Notizen": "Notes", "Anlegen & in Live öffnen": "Create & open in Live", "Musik importieren": "Import music",
    "Ordner oder Datei-Pfad (z. B.": "Folder or file path (e.g.", "). Unterordner werden mit eingelesen.": "). Subfolders are included.",
    "Importieren": "Import", "Suchen: Name, Tags, Plug-ins, Notizen …": "Search: name, tags, plug-ins, notes …",
    "Ordner nach .als-Dateien durchsuchen": "Search folders for .als files", "Alle Projekte ohne MP3 in Live exportieren": "Export all projects without MP3 from Live",
    "Tonart, Stimmung und Genre aus den MP3s bestimmen": "Detect key, mood and genre from the MP3s", "von": "from", "bis": "to",
    "Audio-Ausgang": "Audio output", "Neue Playlist – oder Tracks hierher ziehen": "New playlist – or drop tracks here",
    "Ein Pfad pro Zeile": "One path per line", "z. B. Nachtfahrt": "e.g. Night Drive", "durch Komma getrennt": "comma separated",
    "Sprache": "Language", "Automatisch": "Automatic",
    // Archiv
    "Neu rendern": "Re-render", "MP3 rendern": "Render MP3", "Die .als-Datei bleibt erhalten": "The .als file is kept",
    "Suche .als-Dateien …": "Searching for .als files …", "Alle Projekte haben schon ein MP3.": "All projects already have an MP3.",
    "In Live öffnen": "Open in Live", "Im Finder zeigen": "Show in Finder", "Aus Liste entfernen": "Remove from list", "keine": "none",
    "Spuren": "Tracks", "Noch kein MP3 gerendert": "No MP3 rendered yet", "Deutsch": "Deutsch", "Sprache / Language": "Language / Sprache", "Clips": "Clips", "Energie": "Energy", "Fehler": "Error",
    // Werte aus der Analyse
    "Euphorisch": "Euphoric", "Dunkel & treibend": "Dark & driving", "Melancholisch": "Melancholic", "Entspannt": "Relaxed",
    "Atmosphärisch": "Atmospheric", "Unbekannt": "Unknown", "Arrangement über 2:30": "Arrangement over 2:30",
    "Arrangement über 1:30": "Arrangement over 1:30", "Automationen vorhanden": "Has automation", "Name klingt nach fertig": "Name sounds finished",
    "Name klingt nach Skizze": "Name sounds like a sketch",
    // DJ
    "Kopfhörer-Vorhören aktiv (Kanal 3/4)": "Headphone cue active (channels 3/4)",
    "Stereo-Ausgang: Vorhören nur mit 4-Kanal-Gerät wie dem FLX4": "Stereo output: cueing needs a 4-channel device like the FLX4",
    "Ausgabegerät wählen geht nur in Chrome/Edge. Alternativ in den macOS-Toneinstellungen den FLX4 wählen.": "Choosing an output device only works in Chrome/Edge. Alternatively select the FLX4 in the macOS sound settings.",
    "Ausgabegerät wählen geht nur in Chrome/Edge. Alternativ in den Windows-Soundeinstellungen den FLX4 wählen.": "Choosing an output device only works in Chrome/Edge. Alternatively select the FLX4 in the Windows sound settings.",
    "Lade …": "Loading …", "Beatgrid gespeichert": "Beatgrid saved", "Kein Track geladen": "No track loaded",
    "Master Tempo: Tonhöhe bleibt beim Pitchen gleich": "Master Tempo: pitch stays the same when changing tempo",
    "Repitch: Tempo ändert die Tonhöhe · Keep Pitch: Tonhöhe bleibt beim Pitchen gleich": "Repitch: tempo changes the pitch · Keep Pitch: pitch stays the same when changing tempo",
    "Tonhöhe −1 Halbton": "Pitch −1 semitone", "Tonhöhe +1 Halbton": "Pitch +1 semitone",
    "Klingende Tonart · Klick: Transposition zurücksetzen": "Sounding key · click: reset transpose",
    "Klick: Transposition zurücksetzen": "Click: reset transpose",
    "SYNC stellt zusätzlich die Tonhöhe ein: = gleiche Tonart (bzw. Paralleltonart) · ± auch harmonisch kompatibel (Camelot ±1), kleinste Verschiebung": "SYNC also sets the pitch: = same key (or relative key) · ± also harmonically compatible (Camelot ±1), smallest shift",
    "Key Sync: Tonart unbekannt – Track erst analysieren": "Key Sync: key unknown – analyze the track first",
    "Repitch/Keep Pitch · Shift: Beatgrid-Beat hier": "Repitch/Keep Pitch · Shift: beatgrid beat here",
    "Takt (1–4) und Versatz zum anderen Deck": "Beat (1–4) and offset to the other deck",
    "Ziehen: Position verschieben (Shift = fein) · Mausrad: Zoom · Doppelklick: Cue setzen": "Drag: move position (Shift = fine) · Wheel: zoom · Double-click: set cue",
    "Bremsen (halten)": "Slow down (hold)", "Schieben (halten)": "Push (hold)", "4 Beats zurück": "4 beats back", "4 Beats vor": "4 beats forward",
    "Grid 10 ms früher (Shift: 1 ms)": "Grid 10 ms earlier (Shift: 1 ms)", "Grid 10 ms später (Shift: 1 ms)": "Grid 10 ms later (Shift: 1 ms)",
    "Beatgrid automatisch erkennen (erster Einsatz = Takt 1)": "Detect beatgrid automatically (first onset = bar 1)",
    "Takt-1 genau an die Abspielposition legen": "Put bar 1 exactly at the play position",
    "Tempo −0,05 %": "Tempo −0.05 %", "Tempo +0,05 %": "Tempo +0.05 %", "Tempo (nach unten = schneller)": "Tempo (down = faster)",
    "Cue gesetzt": "Cue set", "Cue/Master (Kopfhörer)": "Cue/Master (headphones)", "Alle Tracks": "All Tracks",
    "Live-Renderings": "Live renders", "Importiert": "Imported", "Doppelklick: umbenennen · Tracks hierher ziehen": "Double-click: rename · drop tracks here",
    "Playlist löschen": "Delete playlist", "Klick: auf das freie Deck laden": "Click: load onto the free deck",
    "Zu Playlist hinzufügen": "Add to playlist", "Aus Playlist entfernen (Entf)": "Remove from playlist (Del)",
    "Diese Playlist ist leer. Ziehe Tracks aus „Alle Tracks“ auf die Playlist links oder nutze ＋ in der Trackliste.": "This playlist is empty. Drag tracks from “All Tracks” onto the playlist on the left or use ＋ in the track list.",
    "Keine Tracks gefunden.": "No tracks found.", "Name der neuen Playlist:": "Name of the new playlist:",
    "Noch keine Playlists. Lege eine an oder ziehe Tracks auf „+ Playlist“.": "No playlists yet. Create one or drag tracks onto “+ Playlist”.",
    "＋ Neue Playlist …": "＋ New playlist …", "MIDI nur in Chrome/Edge": "MIDI only in Chrome/Edge", "Kein FLX4 gefunden": "No FLX4 found",
    "MIDI-Zugriff verweigert": "MIDI access denied", "Cue (halten = vorhören)": "Cue (hold = preview)", "Sync an/aus": "Sync on/off",
    "Bremsen (halten) · Shift: 4 Beats zurück · Alt: Tempo −0,05 %": "Slow down (hold) · Shift: 4 beats back · Alt: tempo −0.05 %",
    "Schieben (halten) · Shift: 4 Beats vor · Alt: Tempo +0,05 %": "Push (hold) · Shift: 4 beats forward · Alt: tempo +0.05 %",
    "Loop In · Shift: Loop zurückschieben": "Loop In · Shift: move loop back", "Loop Out · Shift: Loop vorschieben": "Loop Out · Shift: move loop forward",
    "Auto-Loop (Länge mit ½X/2X)": "Auto loop (length with ½X/2X)", "Master Tempo · Shift: Beatgrid-Beat hier": "Master Tempo · Shift: beatgrid beat here",
    "Tap-Tempo (ab 4 Taps)": "Tap tempo (from 4 taps)", "Audio starten": "Start audio",
    "Loops, Hot Cues und Loop-Punkte rasten auf den Beat ein": "Loops, hot cues and loop points snap to the beat",
    "⌨ Tasten": "⌨ Keys", "Beat hier": "Beat here", "Hot Cues 1–4 · Shift: löschen": "Hot cues 1–4 · Shift: delete",
    "Hot Cues 7–0 · Shift: löschen": "Hot cues 7–0 · Shift: delete", "Bibliothek blättern": "Browse library",
    "Auf Deck A / B laden": "Load onto deck A / B", "Crossfader schieben": "Move crossfader", "Crossfader Mitte": "Center crossfader",
    "Diese Hilfe": "This help", "Höhe der Decks": "Deck height", "Breite der Crates": "Crate width", "Layout zurückgesetzt": "Layout reset",
    "Übergeordneter Ordner": "Parent folder", "Pfad eingeben und Enter drücken": "Type a path and press Enter",
    "Diesen Ordner importieren": "Import this folder", "Tags bearbeiten": "Edit tags", "Auch in die Audiodatei schreiben (Titel, Artist, Genre, BPM, Tonart)": "Also write to the audio file (title, artist, genre, BPM, key)",
    "Tags der markierten Tracks bearbeiten (⌘I)": "Edit tags of the selected tracks (⌘I)", "BPM, Tonart, Genre und Stimmung bestimmen": "Detect BPM, key, genre and mood",
    "✎ Tags": "✎ Tags", "Tags bearbeiten (⌘I)": "Edit tags (⌘I)", "Dieser Ordner ist leer.": "This folder is empty.", "Kein Zugriff auf diesen Ordner.": "No access to this folder.",
    "Keine Audiodateien direkt in diesem Ordner – Unterordner werden mit eingelesen.": "No audio files directly in this folder – subfolders are included.",
    "Markierte Tracks": "Selected tracks", "Alle noch nicht analysierten": "All not yet analyzed", "Ganze Bibliothek neu": "Whole library again",
    "Nichts zu analysieren": "Nothing to analyze", "Erst einen Track markieren": "Select a track first", "‹verschieden›": "‹mixed›",
    "Live-Renderings: Titel und Werte landen im Archiv (gleiche Daten wie im Archiv-Tab).": "Live renders: title and values are stored in the archive (same data as the Archive tab).",
    "Leere Felder mit ‹verschieden› bleiben bei jedem Track, wie sie sind.": "Empty fields marked ‹mixed› stay as they are for each track.",
    "Tags gespeichert": "Tags saved", "Benutzerordner": "Home", "Musik": "Music", "Schreibtisch": "Desktop", "Dokumente": "Documents",
    "Format nicht unterstützt": "Format not supported",
    "Tastatur": "Keyboard", "Taste": "Key", "Funktion": "Function", "Schließen": "Close",
    // Server
    "Abgebrochen.": "Cancelled.", "Warte auf letzte Analysen …": "Waiting for last analyses …", "Rendern abgeschlossen.": "Rendering finished.",
    "Analyse abgeschlossen.": "Analysis finished.", "kein Audio": "no audio", "Import abgeschlossen.": "Import finished.",
    "Bitte warten, bis der laufende Vorgang fertig ist.": "Please wait until the current job has finished.",
    "Ableton Live ist noch offen. Bitte deine Sets speichern und Live beenden.": "Ableton Live is still open. Please save your sets and quit Live.",
    "Bitte einen Namen angeben.": "Please enter a name.", "Bitte in den Einstellungen eine Vorlage (.als) auswählen.": "Please choose a template (.als) in Settings.",
    "Ein Projekt mit diesem Namen existiert schon.": "A project with this name already exists.",
    "Keine .als-Dateien gefunden. Stimmt der Pfad unter ⚙?": "No .als files found. Is the path under ⚙ correct?",
    "Live ist noch beschäftigt, versuche den Export trotzdem …": "Live is still busy, trying the export anyway …",
    "Live-Dialog ließ sich nicht wegklicken, starte Live neu …": "Could not dismiss Live's dialog, restarting Live …",
    "Schließe Live für das nächste Set …": "Closing Live for the next set …", "Export-Dialog …": "Export dialog …",
    "Live hat den Export-Dialog nicht geöffnet. Übersprungen.": "Live did not open the export dialog. Skipped.", "Rendere …": "Rendering …",
    "Export ist nicht gestartet (evtl. Video im Set oder ein Live-Dialog). Übersprungen.": "Export did not start (maybe video in the set or a Live dialog). Skipped.",
    "Rendern hat zu lange gedauert": "Rendering took too long", "Fertig gerendert.": "Rendered.",
    "Ableton Live wurde nicht gefunden.": "Ableton Live was not found.", "Der Speichern-Dialog ist nicht erschienen. Übersprungen.": "The save dialog did not appear. Skipped.",
  };

  // ---------------------------------------------------------------- Texte mit Werten (Reihenfolge zählt)
  const P = [
    [/^(\d+) Projekte$/, "$1 projects"], [/^(\d+) Tracks$/, "$1 tracks"], [/^(\d+) Track$/, "$1 track"],
    [/^(.+) · (\d+) Tracks$/, "$1 · $2 tracks"],
    [/^(\d+) Projekte · (\d+) MP3s · (\d+) importierte Tracks$/, "$1 projects · $2 MP3s · $3 imported tracks"],
    [/^Tonart \(Analyse\)$/, "Key (analysis)"], [/^Tonart \(Live\)$/, "Key (Live)"],
    [/^Auto-Status: /, "Auto status: "], [/^Plug-ins: keine$/, "Plug-ins: none"], [/ fehlen\b/, " missing"],
    [/^„(.+)“ aus der Liste entfernen\?\n\nDie Ableton-Datei bleibt erhalten, ein neuer Scan holt das Projekt nicht zurück\.$/s, "Remove “$1” from the list?\n\nThe Ableton file is kept; a new scan won't bring the project back."],
    [/^(\d+) Projekte nacheinander in Live öffnen und als MP3 exportieren\?\n\nLive muss dafür geschlossen sein\. Während des Renderns bitte Maus und Tastatur nicht benutzen\.$/s, "Open $1 projects in Live one after another and export them as MP3?\n\nLive has to be closed. Please don't use mouse and keyboard while rendering."],
    [/^(\d+) entfernte Projekte kommen beim nächsten Scan zurück\.$/, "$1 removed projects will come back with the next scan."],
    [/^Deck ([AB]) spielt gerade\. Trotzdem laden\?$/, "Deck $1 is playing. Load anyway?"],
    [/^Beatgrid erkannt – Takt 1 bei (.+) s$/, "Beatgrid detected – bar 1 at $1 s"], [/^Takt (\d+)$/, "Bar $1"],
    [/^Transponiert ([+−-]?[\d.]+) Halbtöne · Klick: Transposition zurücksetzen$/, "Transposed $1 semitones · click: reset transpose"],
    [/^Ausgang (\d+)$/, "Output $1"], [/^Playlist „(.+)“ löschen\? Die Tracks selbst bleiben erhalten\.$/, "Delete playlist “$1”? The tracks themselves are kept."],
    [/^Playlist „(.+)“ angelegt$/, "Playlist “$1” created"], [/^Schon in „(.+)“$/, "Already in “$1”"],
    [/^(\d+) Tracks? → „(.+)“$/, (m, n, name) => `${n} track${n > 1 ? "s" : ""} → “${name}”`],
    [/^Zu Playlist hinzufügen \((\d+)\)$/, "Add to playlist ($1)"],
    [/ – ziehen zum Verstellen, Doppelklick setzt zurück$/, " – drag to resize, double-click resets"],
    [/^Deck A \/ Mixer/, "Deck A / mixer"], [/^Mixer \/ Deck B/, "Mixer / deck B"],
    [/^🔍 Titel, Artist, BPM, Tonart … \((.+)F\)$/, "🔍 Title, artist, BPM, key … ($1F)"],
    // Server-Meldungen (auch eingebettet in die Statuszeile "Job: 3/10 – Meldung")
    [/\bRendern(?=: \d)/, "Render"], [/\bAnalyse(?=: \d)/, "Analysis"],
    [/Ordner nicht gefunden: /, "Folder not found: "], [/(\d+) Live-Sets gefunden\./, "$1 Live sets found."], [/Gelesen: /, "Read: "],
    [/(\d+) vorhandene Exporte zugeordnet, analysiere …/, "$1 existing exports matched, analyzing …"],
    [/Scan abgeschlossen: (\d+) Sets, davon (\d+) neu, (\d+) vorhandene MP3s zugeordnet\./, "Scan finished: $1 sets, $2 new, $3 existing MP3s matched."],
    [/Analyse fehlgeschlagen: /, "Analysis failed: "], [/Analysiere (.+) …/, "Analyzing $1 …"], [/(\d+) Audiodateien gefunden\./, "$1 audio files found."],
    [/Datei nicht gefunden: (.+)\. Übersprungen, bitte neu scannen\./, "File not found: $1. Skipped, please scan again."],
    [/Öffne (.+) in Live …/, "Opening $1 in Live …"],
    [/Warte auf (.+) \((\d+) s\) … Live zeigt gerade „(.+)“/, "Waiting for $1 ($2 s) … Live is showing “$3”"], [/„kein Fenster“/, "“no window”"],
    [/Set wurde nicht geladen, Live zeigt „(.*)“\. Übersprungen\./, "Set was not loaded, Live is showing “$1”. Skipped."],
    [/Export-Dialog ging nicht auf, neuer Versuch \((\d)\/3\) …/, "Export dialog did not open, retrying ($1/3) …"],
    [/Live hat kein MP3 erzeugt und ffmpeg fehlt\. Aktiviere 'MP3 kodieren' im Export-Dialog oder installiere ffmpeg \((.+)\)\./, "Live did not create an MP3 and ffmpeg is missing. Enable 'Encode MP3' in the export dialog or install ffmpeg ($1)."],
    [/^Fehler: /, "Error: "],
    [/^(\d+) Audiodateien in diesem Ordner, davon (\d+) schon importiert – Unterordner werden mit eingelesen\.$/, "$1 audio files in this folder, $2 already imported – subfolders are included."],
    [/^(\d+) Audiodateien in diesem Ordner – Unterordner werden mit eingelesen\.$/, "$1 audio files in this folder – subfolders are included."],
    [/^Tags bearbeiten · (\d+) Tracks$/, "Edit tags · $1 tracks"], [/^Tags bearbeiten · /, "Edit tags · "],
    [/^Alle (\d+) Tracks neu analysieren\? Von dir geänderte Werte bleiben erhalten\.$/, "Re-analyze all $1 tracks? Values you changed are kept."],
    [/^Analyse gestartet: (\d+) Tracks$/, "Analysis started: $1 tracks"], [/^Gespeichert, (\d+) Datei\(en\) aktualisiert$/, "Saved, $1 file(s) updated"],
    [/^Nicht in die Datei geschrieben:/, "Not written to file:"], [/^Laufwerk ([A-Z]):$/, "Drive $1:"],
  ];

  // Plattform: Windows-Begriffe in beiden Sprachen
  const PLAT = IS_WIN ? [
    [/Im Finder zeigen/g, "Im Explorer zeigen"], [/Show in Finder/g, "Show in Explorer"], [/macOS-Toneinstellungen/g, "Windows-Soundeinstellungen"],
    [/macOS sound settings/g, "Windows sound settings"], [/⌘F/g, I18N.mod + "F"], [/⇧⌘/g, I18N.mod + "Shift+"], [/⌘/g, I18N.mod],
    [/~\/Music\/Ableton/g, "~/Documents/Ableton"],
  ] : IS_MAC ? [] : [[/Im Finder zeigen/g, "Im Dateimanager zeigen"], [/Show in Finder/g, "Show in file manager"], [/⌘/g, I18N.mod]];

  const enMap = new Map(Object.entries(EN));
  function t(s) {
    if (s == null) return s;
    let str = String(s);
    if (LANG === "en" && /[A-Za-zÄÖÜäöüß]/.test(str)) {
      const core = str.trim();
      const hit = enMap.get(core);
      if (hit != null) str = str.replace(core, hit);
      else for (const [re, rep] of P) if (re.test(str)) str = str.replace(re, rep);
    }
    for (const [re, rep] of PLAT) str = str.replace(re, rep);
    return str;
  }
  window.t = t;
  window.I18N.t = t;

  const active = LANG === "en" || PLAT.length > 0;
  // alert/confirm/prompt übersetzen
  if (active) {
    const A = window.alert.bind(window), C = window.confirm.bind(window), Pr = window.prompt.bind(window);
    window.alert = m => A(t(m)); window.confirm = m => C(t(m)); window.prompt = (m, d) => Pr(t(m), d);
  }

  // ---------------------------------------------------------------- DOM
  const OUT = new WeakMap();       // Textknoten -> zuletzt von uns geschriebener Text
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CANVAS"]);
  const ATTRS = ["placeholder", "title", "aria-label"];
  function doText(n) {
    const v = n.nodeValue;
    if (!v || OUT.get(n) === v || !/[A-Za-zÄÖÜäöüß⌘~]/.test(v)) return;
    if (n.parentNode && (SKIP.has(n.parentNode.nodeName) || n.parentNode.closest?.("[data-noi18n]"))) return;
    const out = t(v);
    OUT.set(n, out);
    if (out !== v) n.nodeValue = out;
  }
  function doAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute?.(a);
      if (!v) continue;
      const key = "i18n_" + a;
      if (el[key] === v) continue;
      const out = t(v); el[key] = out;
      if (out !== v) el.setAttribute(a, out);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) n.nodeType === 3 ? doText(n) : doAttrs(n);
  }
  function start() {
    if (!active) return;
    document.title = t(document.title);
    walk(document.body);
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") doAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  window.setLang = lang => {
    if (lang) localStorage.setItem("lang", lang); else localStorage.removeItem("lang");
    location.reload();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
