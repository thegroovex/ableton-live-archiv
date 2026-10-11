"""Betriebssystem-Weiche. macOS ist die führende Plattform, Windows läuft parallel.

Alles, was vom System abhängt (Dateimanager, Browser, Live öffnen/rendern, Standardordner),
geht über dieses Modul, damit app.py auf beiden Systemen gleich bleibt.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import webbrowser

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"


def renderer():
    """Render-Modul des Systems: AppleScript auf macOS, Win32-Tastatursteuerung auf Windows."""
    if IS_WIN:
        from core import renderer_win
        return renderer_win
    from core import renderer as renderer_mac
    return renderer_mac


def default_settings() -> dict:
    if IS_WIN:
        return {
            "roots": ["~/Documents/Ableton"],
            "live_app": "Ableton Live 12 Suite",
            "template": "",
            "new_project_dir": "~/Documents/Ableton/Projects",
        }
    return {
        "roots": ["~/Music/Ableton"],
        "live_app": "Ableton Live 12 Suite",
        "template": "",
        "new_project_dir": "~/Music/Ableton/Projects",
    }


def reveal(path: str) -> None:
    """Datei im Finder bzw. Explorer markiert anzeigen."""
    if IS_WIN:
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
    elif IS_MAC:
        subprocess.run(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path)])


def _win_browser_paths() -> list[str]:
    env = [os.environ.get(k, "") for k in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]
    rel = [r"Google\Chrome\Application\chrome.exe", r"Microsoft\Edge\Application\msedge.exe",
           r"BraveSoftware\Brave-Browser\Application\brave.exe"]
    return [os.path.join(b, r) for r in rel for b in env if b]


def open_browser(url: str) -> None:
    """Chrome/Edge bevorzugt: nur Chromium-Browser können Web MIDI (FLX4) und Audio-Ausgänge wählen."""
    if IS_MAC:
        for app_name in ("Google Chrome", "Microsoft Edge", "Brave Browser", "Arc"):
            if os.path.exists(f"/Applications/{app_name}.app"):
                subprocess.Popen(["open", "-a", app_name, url]); return
    elif IS_WIN:
        for exe in _win_browser_paths():
            if os.path.exists(exe):
                subprocess.Popen([exe, url]); return
    webbrowser.open(url)


def ffmpeg_path() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    for p in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if os.path.exists(p):
            return p
    return None


def ffmpeg_hint() -> str:
    return "winget install ffmpeg" if IS_WIN else "brew install ffmpeg"


INVALID_NAME_CHARS = r'[<>:"/\\|?*]+' if IS_WIN else r'[/:\\]+'
