# Live Archiv

[🇩🇪 Deutsch](README.md) · 🇬🇧 English

Keeps your Ableton Live 12 projects in order – plus a DJ mode for the Pioneer DDJ-FLX4.

**Runs on macOS (primary platform) and Windows 10/11.** The interface is available in German and English.

## Download
| System | Download | Start |
|---|---|---|
| 🍎 macOS | [Live-Archiv-macOS.zip](https://github.com/thegroovex/ableton-live-archiv/releases/latest/download/Live-Archiv-macOS.zip) | unzip, double-click `start.command` (first time: right-click → Open, because macOS blocks downloaded scripts) |
| 🪟 Windows | [Live-Archiv-Windows.zip](https://github.com/thegroovex/ableton-live-archiv/releases/latest/download/Live-Archiv-Windows.zip) | unzip, double-click `start.bat` (if SmartScreen appears: “More info” → “Run anyway”) |

All versions: [Releases](https://github.com/thegroovex/ableton-live-archiv/releases). GitHub Actions builds the ZIPs automatically for every version tag (`v1.2.3`). Python 3.10+ is required (see Installation).

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
- **macOS only:** for the automatic export allow Terminal under System Settings → Privacy & Security → **Accessibility**.
- **Windows only:** Live is looked up under `C:\ProgramData\Ableton\…`, otherwise started through the `.als` file association. Between two sets Live is quit and restarted (rendering only starts while Live is closed, so nothing is lost).
- Don't use mouse and keyboard while rendering.

## Platforms
| | macOS | Windows |
|---|---|---|
| Archive, search, analysis, DJ mode, FLX4 | ✔ | ✔ |
| Automatic MP3 export | AppleScript + Accessibility | Win32 (SendInput), no extra permissions |
| Reveal file | Finder | Explorer |
| Start | `start.command` | `start.bat` |

macOS is the primary platform: new features land there first. Everything OS-specific lives in `core/platform_util.py`; the export in `core/renderer.py` (macOS) and `core/renderer_win.py` (Windows).

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
