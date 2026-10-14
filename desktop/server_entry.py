"""Startpunkt des Python-Servers in der Standalone-App (wird mit PyInstaller gebündelt).

Die Electron-Hülle startet diese Datei bzw. die daraus gebaute `live-archiv-server`-Binary,
übergibt Port und ffmpeg-Pfad per Umgebungsvariable und zeigt die Oberfläche im eigenen Fenster.
Daten liegen wie beim Skript-Start in ~/LiveArchiv – beide Wege teilen sich also dieselbe Bibliothek.
"""
import os
import sys

HOME = os.path.expanduser(os.environ.get("LIVE_ARCHIV_HOME", "~/LiveArchiv"))
os.makedirs(HOME, exist_ok=True)
# librosa nutzt numba mit Cache; im App-Bundle ist der Programmordner schreibgeschützt.
os.environ.setdefault("NUMBA_CACHE_DIR", os.path.join(HOME, "cache", "numba"))
ffmpeg = os.environ.get("LIVE_ARCHIV_FFMPEG")
if ffmpeg:
    os.environ["PATH"] = os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", "")
if "--no-browser" not in sys.argv:
    sys.argv.append("--no-browser")

if not getattr(sys, "frozen", False):
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import app  # noqa: E402

if __name__ == "__main__":
    app.main()
