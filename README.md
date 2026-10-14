# Live Archiv

🇩🇪 Deutsch · [🇬🇧 English](README.en.md)

Ordnung für deine Ableton-Live-12-Projekte – plus DJ-Modus für den Pioneer DDJ-FLX4.

**Läuft auf macOS (führend) und Windows 10/11.** Die Oberfläche gibt es auf Deutsch und Englisch.

## Download
Zwei Wege, dieselbe Bibliothek (`~/LiveArchiv`):

**1. Als App (empfohlen, ohne Python)**
| System | Download | Start |
|---|---|---|
| 🍎 macOS (Apple Silicon) | [Releases](https://github.com/thegroovex/ableton-live-archiv/releases/latest) → `Live-Archiv-…-mac-arm64.dmg` | DMG öffnen, „Live Archiv“ in „Programme“ ziehen. Beim ersten Start meldet macOS eine nicht verifizierte App: Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“ (einmalig). |
| 🪟 Windows 10/11 | [Releases](https://github.com/thegroovex/ableton-live-archiv/releases/latest) → `Live-Archiv-…-win-x64.exe` | Installer starten (bei SmartScreen „Weitere Informationen“ → „Trotzdem ausführen“). Startmenü- und Desktop-Verknüpfung „Live Archiv“. |

Die App bringt Python, alle Pakete und ffmpeg mit und öffnet die Oberfläche im eigenen Fenster (Chromium – Web MIDI für den FLX4 und die Wahl des Audio-Ausgangs funktionieren wie in Chrome). Menü **Ansicht → Sprache / Language** schaltet Deutsch/Englisch um, **Extras** öffnet die Oberfläche bei Bedarf im Browser, den Datenordner oder das Protokoll.

**2. Als Skript (wie bisher, Python 3.10+ nötig)**
| System | Download | Start |
|---|---|---|
| 🍎 macOS | [Live-Archiv-macOS.zip](https://github.com/thegroovex/ableton-live-archiv/releases/latest/download/Live-Archiv-macOS.zip) | entpacken, `start.command` doppelklicken (beim ersten Mal Rechtsklick → Öffnen, weil macOS heruntergeladene Skripte blockiert) |
| 🪟 Windows | [Live-Archiv-Windows.zip](https://github.com/thegroovex/ableton-live-archiv/releases/latest/download/Live-Archiv-Windows.zip) | entpacken, `start.bat` doppelklicken (bei SmartScreen „Weitere Informationen“ → „Trotzdem ausführen“) |

Alle Versionen: [Releases](https://github.com/thegroovex/ableton-live-archiv/releases). Apps und ZIPs baut GitHub Actions automatisch bei jedem Versions-Tag (`v1.2.3`). App (Port 5078) und Skript (Port 5077) können sogar gleichzeitig laufen.

## Funktionen
**Archiv**
- Scannt deine Projektordner nach `.als`-Sets (Backups werden ignoriert) und liest Tempo, Tonart (Live-12-Skala), Spuren, Clips, Länge, Automationen, Plug-ins und fehlende Samples – ohne Live zu öffnen.
- Exportiert jedes Set automatisch über Live 12 als MP3 (macOS: AppleScript, Windows: Win32-Tastatursteuerung des Export-Dialogs).
- Analysiert die MP3s: Tonart (falls im Set nicht gesetzt), Energie, Stimmung, Genre-Vorschlag.
- Einstufung „Fertig“ oder „Skizze“ anhand von Arrangement-Länge, Clips, Spuren, Automation und Dateiname.
- Suchmaske: Volltext, Tempo von/bis, Tonart + Dur/Moll, Genre, Stimmung, Status, Bewertung. Camelot-Anzeige.
- Alles editierbar (Status, Genre, Stimmung, Tags, Notizen, Sterne). Deine Änderungen überschreibt kein späterer Scan.
- „Neues Projekt“: legt aus deiner Vorlage einen Projektordner an, setzt Tempo und Tonart und öffnet ihn in Live.

**DJ**
- Zwei Decks mit Scroll-Wellenform, Beatgrid, Übersicht, Hot Cues (8 je Deck, gespeichert), Beat-Loops, Loop In/Out, Beat-Jump, Sync (inkl. Phase), Tempo ±6/10/16/50 %, Scratchen und Nudgen.
- Mixer: Trim, 3-Band-EQ mit Kill, Color-Filter, Kanalfader, Crossfader, Kopfhörer-Cue und Cue/Master-Mix, VU-Meter.
- Bibliothek aus deinen gerenderten MP3s plus importierter Musik (Ordner-Import oder Drag & Drop; BPM/Tonart werden analysiert). Harmonisch passende Tracks werden grün markiert. Farbige Mini-Wellenformen in der Liste.
- **Playlists (Crates) wie in Serato DJ Pro:** Crate-Spalte links (Alle Tracks, Live-Renderings, Importiert, eigene Playlists), Trackliste rechts mit Suche (⌘F / Strg+F). Tracks per Drag & Drop oder ＋ hinzufügen (Mehrfachauswahl mit ⌘/Strg und Shift), in der Playlist per Ziehen sortieren, mit Entf entfernen. Playlists umbenennen (Doppelklick), sortieren und löschen.
- **Import mit Ordner-Browser:** Ordner durchklicken (Benutzerordner, Musik, Downloads, externe Laufwerke bzw. Windows-Laufwerke) oder Pfad eintippen, Unterordner werden mit eingelesen.
- **Repitch / Keep Pitch** pro Deck: Tempo ändert die Tonhöhe wie bei Platte, oder die Tonhöhe bleibt beim Pitchen gleich (tonhöhenunabhängiges Time-Stretching). Mit ♭/♯ lässt sich jedes Deck zusätzlich in Halbtönen transponieren; die klingende Tonart samt Camelot-Code steht daneben.
- **Key Sync:** Ist KEY SYNC an, stellt SYNC neben dem Tempo auch die Tonhöhe ein – „=“ auf die gleiche Tonart (bzw. Paralleltonart), „±“ auf die nächstgelegene harmonisch passende (Camelot ±1). Das funktioniert in beiden Modi und folgt Tempoänderungen automatisch.
- **Analysieren im DJ-Tab:** markierte Tracks, alle noch nicht analysierten oder die ganze Bibliothek (BPM, Tonart, Genre, Stimmung, Wellenform).
- **Tag-Editor** (✎ bzw. ⌘I / Strg+I): Titel, Artist, BPM, Tonart, Genre, Stimmung, Tags, Bewertung, Notizen – auch für mehrere Tracks auf einmal. Deine Werte überschreibt keine spätere Analyse; optional werden Titel, Artist, Genre, BPM und Tonart in die Audiodatei geschrieben (ID3/Vorbis/MP4). Die Suche findet auch Tags und Notizen.
- Beatgrid: automatische Erkennung von Takt 1 (Knopf **AUTO**), Feinjustage in ms, Grid bleibt beim BPM-Ändern taktstabil.
- Scroll-Wellenform: ziehen zum Verschieben (Shift = fein), Mausrad/＋/－ zum Zoomen (1–32 s), Doppelklick setzt den Cue.
- **DDJ-FLX4** per Web MIDI: Play, Cue, Jogs, Tempo, EQ, Filter, Fader, Crossfader, Pads (Hot Cue, Beat Loop, Beat Jump), Load, Browse, LEDs und VU-Meter. Über den FLX4 als 4-Kanal-Audiogerät läuft der Master auf 1/2 und der Kopfhörer auf 3/4.
- Tastatur: Q/W/E = Play/Cue/Sync Deck A, P/O/I = Deck B, 1–4 und 7–0 = Hot Cues, ↑↓ = Browse, ←/→ = in Deck A/B laden.

## Installation

### macOS
1. Python 3.10+ (vorinstalliert oder `brew install python`). Optional: `brew install ffmpeg`.
2. ZIP herunterladen und entpacken (oder klonen), `start.command` doppelklicken (beim ersten Start werden die Pakete installiert).
3. Die App öffnet sich in Chrome unter http://127.0.0.1:5077 (für den FLX4 Chrome oder Edge verwenden, Safari kann kein MIDI).

### Windows 10/11
1. Python 3.10+ von python.org installieren (Haken bei „Add python.exe to PATH“). Optional: `winget install ffmpeg`.
2. ZIP herunterladen und entpacken (oder klonen), `start.bat` doppelklicken (beim ersten Start werden die Pakete installiert).
3. Die App öffnet sich in Chrome oder Edge unter http://127.0.0.1:5077.
4. Für den FLX4 den Pioneer-ASIO-/Audio-Treiber installieren; Chrome/Edge sehen ihn dann als 4-Kanal-Ausgang.

## Einmalige Einrichtung
- ⚙ Einstellungen: Sprache (Automatisch/Deutsch/English, auch per DE/EN-Knopf oben rechts), Projektordner (macOS z. B. `~/Music/Ableton`, Windows z. B. `~/Documents/Ableton`), Vorlage `.als` für neue Projekte, Name der Live-App (z. B. „Ableton Live 12 Suite“).
- In Live einmal „Audio/Video exportieren“ (macOS ⇧⌘R, Windows Strg+Shift+R) öffnen: Gerenderte Spur „Main“, ganzes Arrangement, **MP3 kodieren** an. Live merkt sich das.
- **Nur macOS:** Für den automatischen Export Systemeinstellungen → Datenschutz & Sicherheit → **Bedienungshilfen** erlauben – für die App „Live Archiv“, beim Skript-Start „Terminal“. Beim ersten Export fragt macOS außerdem, ob Live Archiv „System Events“ bzw. Ableton Live steuern darf: erlauben.
- **Nur Windows:** Live wird unter `C:\ProgramData\Ableton\…` gesucht, sonst über die `.als`-Dateizuordnung gestartet. Zwischen zwei Sets wird Live beendet und frisch gestartet (Rendern startet nur bei geschlossenem Live, es geht also nichts verloren).
- Während des Renderns Maus und Tastatur nicht benutzen.

## Plattformen
| | macOS | Windows |
|---|---|---|
| Archiv, Suche, Analyse, DJ-Modus, FLX4 | ✔ | ✔ |
| Automatischer MP3-Export | AppleScript + Bedienungshilfen | Win32 (SendInput), ohne Zusatzrechte |
| Datei zeigen | Finder | Explorer |
| App | `.dmg` (Apple Silicon) | Installer `.exe` (x64) |
| Skript-Start | `start.command` | `start.bat` |

macOS ist die führende Plattform: neue Funktionen entstehen dort zuerst. Alles Systemabhängige liegt in `core/platform_util.py`, der Export in `core/renderer.py` (macOS) bzw. `core/renderer_win.py` (Windows).

## Standalone-App (Aufbau und selbst bauen)
- `desktop/` enthält die App-Hülle: **Electron** (`main.js`, `lib.js`) startet den Python-Server unsichtbar im Hintergrund und zeigt die Oberfläche im eigenen Fenster; der Server wird mit **PyInstaller** gebündelt (`live-archiv-server.spec`, Einstieg `server_entry.py`), ffmpeg kommt aus `ffmpeg-static`.
- Der Python-Code ist für Skript und App derselbe. Neue Funktionen landen also automatisch in beiden Wegen.
- Gebaut wird in GitHub Actions (`.github/workflows/release.yml`) bei jedem Tag `v*`: macOS-DMG, Windows-Installer und die ZIPs. Vor dem Paketieren startet der gebündelte Server einmal als Selbsttest.
- Lokal bauen (im Ordner `desktop/`, Python-Pakete wie oben installiert):
  ```
  pip install pyinstaller
  npm install
  npm run server          # Python-Server bündeln
  npm run dist:mac        # bzw. npm run dist:win
  ```
  Zum Ausprobieren ohne Paketieren: `npm start` (nutzt dann `python3 server_entry.py`).
- Die App ist nicht von Apple bzw. Microsoft signiert (ad hoc signiert auf dem Mac). Deshalb die einmalige Freigabe beim ersten Start.
- Protokoll des Hintergrunddienstes: `~/LiveArchiv/logs/server.log` (Menü Extras → Protokoll zeigen).

## Sprache
Die Oberfläche ist auf Deutsch geschrieben; `static/js/i18n.js` übersetzt sie zur Laufzeit ins Englische und ersetzt auf Windows Mac-Begriffe (⌘ → Strg/Ctrl, Finder → Explorer). Neue Texte dort im Wörterbuch `EN` (feste Texte) oder in `P` (Texte mit Werten) ergänzen; ein Test prüft, dass alle Texte in `index.html` übersetzt sind.

## Tests
```
pip install -r requirements.txt pytest
python -m pytest -v
node --test tests/js/*.test.js
```
Die Tests laufen bei jedem Push automatisch auf macOS und Windows (GitHub Actions). Getestet werden Set-Parser, Klassifizierung, Datenbank und Suchfilter, alle API-Endpunkte, Audio-Analyse an synthetischen Tracks, der Render-Ablauf mit simuliertem Live, das AppleScript (Kompilierung auf macOS), der Windows-Export mit simuliertem Live, Playlists, das FLX4-MIDI-Mapping, die DJ-Logik, die Beatgrid-Erkennung, die Audio-Engine und die Übersetzung.

## Daten
Alles liegt in `~/LiveArchiv` bzw. unter Windows in `%USERPROFILE%\LiveArchiv` (Datenbank, Playlists, MP3s, importierte Musik). Deine Live-Sets werden nie verändert.
