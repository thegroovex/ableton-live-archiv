# Live Archiv

Ordnung für deine Ableton-Live-12-Projekte – plus DJ-Modus für den Pioneer DDJ-FLX4.

## Funktionen
**Archiv**
- Scannt deine Projektordner nach `.als`-Sets (Backups werden ignoriert) und liest Tempo, Tonart (Live-12-Skala), Spuren, Clips, Länge, Automationen, Plug-ins und fehlende Samples – ohne Live zu öffnen.
- Exportiert jedes Set automatisch über Live 12 als MP3 (AppleScript steuert den Export-Dialog).
- Analysiert die MP3s: Tonart (falls im Set nicht gesetzt), Energie, Stimmung, Genre-Vorschlag.
- Einstufung „Fertig“ oder „Skizze“ anhand von Arrangement-Länge, Clips, Spuren, Automation und Dateiname.
- Suchmaske: Volltext, Tempo von/bis, Tonart + Dur/Moll, Genre, Stimmung, Status, Bewertung. Camelot-Anzeige.
- Alles editierbar (Status, Genre, Stimmung, Tags, Notizen, Sterne). Deine Änderungen überschreibt kein späterer Scan.
- „Neues Projekt“: legt aus deiner Vorlage einen Projektordner an, setzt Tempo und Tonart und öffnet ihn in Live.

**DJ**
- Zwei Decks mit Scroll-Wellenform, Beatgrid, Übersicht, Hot Cues (8 je Deck, gespeichert), Beat-Loops, Loop In/Out, Beat-Jump, Sync (inkl. Phase), Tempo ±6/10/16/50 %, Scratchen und Nudgen.
- Mixer: Trim, 3-Band-EQ mit Kill, Color-Filter, Kanalfader, Crossfader, Kopfhörer-Cue und Cue/Master-Mix, VU-Meter.
- Bibliothek aus deinen gerenderten MP3s plus importierter Musik (Ordner-Import oder Drag & Drop; BPM/Tonart werden analysiert). Harmonisch passende Tracks werden grün markiert.
- **DDJ-FLX4** per Web MIDI: Play, Cue, Jogs, Tempo, EQ, Filter, Fader, Crossfader, Pads (Hot Cue, Beat Loop, Beat Jump), Load, Browse, LEDs und VU-Meter. Über den FLX4 als 4-Kanal-Audiogerät läuft der Master auf 1/2 und der Kopfhörer auf 3/4.
- Tastatur: Q/W/E = Play/Cue/Sync Deck A, P/O/I = Deck B, 1–4 und 7–0 = Hot Cues, ↑↓ = Browse, ←/→ = in Deck A/B laden.

## Installation (macOS)
1. Python 3.10+ (vorinstalliert oder `brew install python`). Optional: `brew install ffmpeg`.
2. Ordner entpacken/klonen, `start.command` doppelklicken (beim ersten Start werden die Pakete installiert).
3. Die App öffnet sich in Chrome unter http://127.0.0.1:5077 (für den FLX4 Chrome oder Edge verwenden, Safari kann kein MIDI).

## Einmalige Einrichtung
- ⚙ Einstellungen: Projektordner (z. B. `~/Music/Ableton`), Vorlage `.als` für neue Projekte.
- Für den automatischen Export: Systemeinstellungen → Datenschutz & Sicherheit → **Bedienungshilfen** → Terminal erlauben.
- In Live einmal „Audio/Video exportieren“ (⇧⌘R) öffnen: Gerenderte Spur „Main“, ganzes Arrangement, **MP3 kodieren** an. Live merkt sich das.
- Während des Renderns Maus und Tastatur nicht benutzen.

## Tests
```
pip install -r requirements.txt pytest
python -m pytest -v
node --test tests/js/*.test.js
```
Die Tests laufen bei jedem Push automatisch auf macOS (GitHub Actions). Getestet werden Set-Parser, Klassifizierung, Datenbank und Suchfilter, alle API-Endpunkte, Audio-Analyse an synthetischen Tracks, der Render-Ablauf mit simuliertem Live, das AppleScript (Kompilierung auf macOS), das FLX4-MIDI-Mapping, die DJ-Logik und die Audio-Engine.

## Daten
Alles liegt in `~/LiveArchiv` (Datenbank, MP3s, importierte Musik). Deine Live-Sets werden nie verändert.
