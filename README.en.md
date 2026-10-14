# Live Archiv

[🇩🇪 Deutsch](README.md) · 🇬🇧 English

Keeps your Ableton Live 12 projects in order – plus a DJ mode for the Pioneer DDJ-FLX4.

**Runs on macOS (primary platform) and Windows 10/11.** The interface is available in German and English.

## Download
Two ways, one library (`~/LiveArchiv`):

**1. As an app (recommended, no Python needed)**
| System | Download | Start |
|---|---|---|
| 🍎 macOS (Apple Silicon) | [Releases](https://github.com/thegroovex/ableton-live-archiv/releases/latest) → `Live-Archiv-…-mac-arm64.dmg` | Open the DMG, drag “Live Archiv” to Applications. On first launch macOS reports an unverified app: System Settings → Privacy & Security → “Open Anyway” (once). |
| 🪟 Windows 10/11 | [Releases](https://github.com/thegroovex/ableton-live-archiv/releases/latest) → `Live-Archiv-…-win-x64.exe` | Run the installer (if SmartScreen appears: “More info” → “Run anyway”). Start menu and desktop shortcut “Live Archiv”. |

The app bundles Python, all packages and ffmpeg and shows the interface in its own window (Chromium – Web MIDI for the FLX4 and choosing the audio output work just like in Chrome). Menu **View → Sprache / Language** switches German/English; **Extras** opens the interface in a browser if needed, the data folder or the log.

**2. As a script (as before, Python 3.10+ required)**
| System | Download | Start |
|---|---|---|
| 🍎 macOS | [Live-Archiv-macOS.zip](https://github.com/thegroovex/ableton-live-archiv/releases/latest/download/Live-Archiv-macOS.zip) | unzip, double-click `start.command` (first time: right-click → Open, because macOS blocks downloaded scripts) |
| 🪟 Windows | [Live-Archiv-Windows.zip](https://github.com/thegroovex/ableton-live-archiv/releases/latest/download/Live-Archiv-Windows.zip) | unzip, double-click `start.bat` (if SmartScreen appears: “More info” → “Run anyway”) |

All versions: [Releases](https://github.com/thegroovex/ableton-live-archiv/releases). GitHub Actions builds the apps and ZIPs automatically for every version tag (`v1.2.3`). App (port 5078) and script (port 5077) can even run at the same time.

## Features
**Archive**
- Scans your project folders for `.als` sets (backups are ignored) and reads tempo, key (Live 12 scale), tracks, clips, length, automation, plug-ins and missing samples – without opening Live.
- Exports every set to MP3 automatically through Live 12 (macOS: AppleScript, Windows: Win32 keyboard control of the export dialog).
- Analyzes the MP3s: key (if not set in the project), energy, mood, genre suggestion.
- Rates sets as “Finished” or “Sketch” based on arrangement length, clips, tracks, automation and file name.
- Search: full text, tempo from/to, key + major/minor, genre, mood, status, rating. Camelot display.
- Everything is editable (status, genre, mood, tags, notes, stars). Later scans never overwrite your edits.
- “New Project”: creates a project folder from your template, sets tempo and key and opens it in Live.

**DJ**
- Two decks with scrolling waveform, beatgrid, overview, hot cues (8 per deck, saved), beat loops, loop in/out, beat jump, sync (incl. phase), tempo ±6/10/16/50 %, scratching and nudging.
- Scrolling waveform: drag to move (Shift = fine), mouse wheel or ＋/－ to zoom (1–32 s), double-click sets the cue.
- **Import with folder browser:** click through folders (home, Music, Downloads, external volumes or Windows drives) or type a path; subfolders are included.
- **Repitch / Keep Pitch** per deck: tempo changes the pitch like vinyl, or the pitch stays the same (pitch-independent time-stretching). ♭/♯ additionally transposes a deck in semitones; the sounding key with its Camelot code is shown next to it.
- **Key Sync:** with KEY SYNC on, SYNC sets the pitch as well as the tempo – “=” to the same key (or relative key), “±” to the closest harmonically compatible one (Camelot ±1). Works in both modes and follows tempo changes automatically.
- **Analyze in the DJ tab:** selected tracks, all not yet analyzed, or the whole library (BPM, key, genre, mood, waveform).
- **Tag editor** (✎ or ⌘I / Ctrl+I): title, artist, BPM, key, genre, mood, tags, rating, notes – also for several tracks at once. Later analyses never overwrite your values; optionally title, artist, genre, BPM and key are written into the audio file (ID3/Vorbis/MP4). Search also finds tags and notes.
- Beatgrid: automatic bar-1 detection (**AUTO** button), fine adjustment in ms, grid stays bar-aligned when the BPM changes.
- Mixer: trim, 3-band EQ with kill, color filter, channel faders, crossfader, headphone cue and cue/master mix, VU meters.
- Library of your rendered MP3s plus imported music (folder import or drag & drop; BPM/key are analyzed), colored mini waveforms, harmonically matching tracks highlighted in green.
- **Playlists (crates) like Serato DJ Pro:** crate column on the left (All Tracks, Live renders, Imported, your playlists), track list on the right with search (⌘F / Ctrl+F). Add tracks by drag & drop or ＋ (multi-select with ⌘/Ctrl and Shift), reorder by dragging, remove with Del. Rename (double-click), reorder and delete playlists.
- **DDJ-FLX4** via Web MIDI: play, cue, jogs, tempo, EQ, filter, faders, crossfader, pads (hot cue, beat loop, beat jump), load, browse, LEDs and VU meters. Using the FLX4 as a 4-channel audio device, master plays on 1/2 and headphones on 3/4.
- Keyboard: Q/W/E = play/cue/sync deck A, P/O/I = deck B, 1–4 and 7–0 = hot cues, ↑↓ = browse, ←/→ = load into deck A/B, ? = help.

## Installation

### macOS
1. Python 3.10+ (preinstalled or `brew install python`). Optional: `brew install ffmpeg`.
2. Download and unzip the ZIP (or clone) and double-click `start.command` (packages are installed on first start).
3. The app opens in Chrome at http://127.0.0.1:5077 (use Chrome or Edge for the FLX4; Safari has no MIDI).

### Windows 10/11
1. Install Python 3.10+ from python.org (tick “Add python.exe to PATH”). Optional: `winget install ffmpeg`.
2. Download and unzip the ZIP (or clone) and double-click `start.bat` (packages are installed on first start).
3. The app opens in Chrome or Edge at http://127.0.0.1:5077.
4. For the FLX4, install Pioneer's audio driver; Chrome/Edge then see it as a 4-channel output.

## One-time setup
- ⚙ Settings: language (automatic/German/English, or the DE/EN button top right), project folders (macOS e.g. `~/Music/Ableton`, Windows e.g. `~/Documents/Ableton`), `.als` template for new projects, Live app name (e.g. “Ableton Live 12 Suite”).
- Open “Export Audio/Video” in Live once (macOS ⇧⌘R, Windows Ctrl+Shift+R): rendered track “Main”, whole arrangement, **Encode MP3** on. Live remembers this.
- **macOS only:** for the automatic export allow System Settings → Privacy & Security → **Accessibility** – for the app “Live Archiv”, for the script start “Terminal”. On the first export macOS also asks whether Live Archiv may control “System Events” and Ableton Live: allow it.
- **Windows only:** Live is looked up under `C:\ProgramData\Ableton\…`, otherwise started through the `.als` file association. Between two sets Live is quit and restarted (rendering only starts while Live is closed, so nothing is lost).
- Don't use mouse and keyboard while rendering.

## Platforms
| | macOS | Windows |
|---|---|---|
| Archive, search, analysis, DJ mode, FLX4 | ✔ | ✔ |
| Automatic MP3 export | AppleScript + Accessibility | Win32 (SendInput), no extra permissions |
| Reveal file | Finder | Explorer |
| App | `.dmg` (Apple Silicon) | Installer `.exe` (x64) |
| Script start | `start.command` | `start.bat` |

macOS is the primary platform: new features land there first. Everything OS-specific lives in `core/platform_util.py`; the export in `core/renderer.py` (macOS) and `core/renderer_win.py` (Windows).

## Standalone app (structure and building it yourself)
- `desktop/` holds the app shell: **Electron** (`main.js`, `lib.js`) starts the Python server invisibly in the background and shows the interface in its own window; the server is bundled with **PyInstaller** (`live-archiv-server.spec`, entry point `server_entry.py`), ffmpeg comes from `ffmpeg-static`.
- The Python code is the same for script and app, so new features land in both automatically.
- GitHub Actions (`.github/workflows/release.yml`) builds on every tag `v*`: macOS DMG, Windows installer and the ZIPs. Before packaging, the bundled server is started once as a self-test.
- Build locally (in `desktop/`, Python packages installed as above):
  ```
  pip install pyinstaller
  npm install
  npm run server          # bundle the Python server
  npm run dist:mac        # or npm run dist:win
  ```
  To try it without packaging: `npm start` (then uses `python3 server_entry.py`).
- The app is not signed by Apple or Microsoft (ad-hoc signed on the Mac), hence the one-time approval on first launch.
- Background service log: `~/LiveArchiv/logs/server.log` (menu Extras → Show log).

## Language
The UI source is German; `static/js/i18n.js` translates it to English at runtime and swaps Mac terms on Windows (⌘ → Ctrl, Finder → Explorer). Add new strings to the `EN` dictionary (fixed texts) or `P` (texts with values); a test checks that every text in `index.html` has a translation.

## Tests
```
pip install -r requirements.txt pytest
python -m pytest -v
node --test tests/js/*.test.js
```
Tests run on every push on macOS and Windows (GitHub Actions): set parser, classification, database and search filters, all API endpoints, audio analysis on synthetic tracks, the render flow with a simulated Live on both systems, playlists, the FLX4 MIDI mapping, DJ logic, beatgrid detection, the audio engine and the translation.

## Data
Everything is stored in `~/LiveArchiv` (Windows: `%USERPROFILE%\LiveArchiv`): database, playlists, MP3s, imported music. Your Live sets are never modified.
