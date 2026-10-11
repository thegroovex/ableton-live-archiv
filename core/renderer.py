"""Automatischer Export über Ableton Live 12 (macOS, per AppleScript/System Events).

Voraussetzungen (einmalig):
  * Systemeinstellungen > Datenschutz & Sicherheit > Bedienungshilfen: Terminal (bzw. die App,
    aus der Live Archiv gestartet wird) erlauben.
  * In Live einmal manuell "Audio/Video exportieren" öffnen und einstellen:
      Gerenderte Spur: Main, Render-Start/-Länge: ganzes Arrangement,
      "MP3 kodieren" an (WAV/PCM darf aus). Live merkt sich diese Einstellungen.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import time

LIVE_PROCESS = "Live"


def _osa(script: str, timeout: int = 60) -> str:
    res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or "AppleScript-Fehler")
    return res.stdout.strip()


def _front_window_title() -> str:
    try:
        return _osa(f'tell application "System Events" to tell process "{LIVE_PROCESS}" to get name of front window')
    except Exception:
        return ""


def _dismiss_save_dialog() -> None:
    """Klickt 'Nicht sichern' / "Don't Save", falls Live beim Wechsel fragt."""
    script = f'''
    tell application "System Events" to tell process "{LIVE_PROCESS}"
        repeat with w in windows
            repeat with b in (buttons of w)
                set n to name of b
                if n is in {{"Don't Save", "Nicht sichern", "Nein", "No"}} then
                    click b
                    return "clicked"
                end if
            end repeat
        end repeat
    end tell
    return "none"'''
    try:
        _osa(script, timeout=10)
    except Exception:
        pass


def open_in_live(als_path: str, app_name: str) -> None:
    subprocess.run(["open", "-a", app_name, als_path], check=True)


def render_set(als_path: str, out_dir: str, out_name: str, app_name: str = "Ableton Live 12 Suite",
               load_timeout: int = 180, render_timeout: int = 900, log=print) -> str:
    """Öffnet das Set in Live, exportiert es und gibt den Pfad zur MP3 zurück."""
    os.makedirs(out_dir, exist_ok=True)
    set_name = os.path.splitext(os.path.basename(als_path))[0]
    for old in glob.glob(os.path.join(out_dir, out_name + ".*")):
        os.remove(old)

    log(f"Öffne {set_name} in Live …")
    open_in_live(als_path, app_name)
    t0 = time.time()
    while time.time() - t0 < load_timeout:
        _dismiss_save_dialog()
        if set_name in _front_window_title():
            break
        time.sleep(1.5)
    else:
        raise TimeoutError("Set wurde nicht rechtzeitig geladen")
    time.sleep(4)  # Plug-ins/Samples fertig laden lassen

    log("Export-Dialog …")
    esc_dir = out_dir.replace('"', '\\"')
    esc_name = out_name.replace('"', '\\"')
    script = f'''
    tell application "{app_name}" to activate
    delay 0.6
    tell application "System Events" to tell process "{LIVE_PROCESS}"
        keystroke "r" using {{command down, shift down}}
        delay 1.5
        key code 36 -- Enter: Export im Live-Dialog bestätigen
        delay 1.5
        keystroke "a" using {{command down}}
        keystroke "{esc_name}"
        delay 0.3
        keystroke "g" using {{command down, shift down}}
        delay 0.8
        keystroke "{esc_dir}"
        delay 0.5
        key code 36
        delay 0.8
        key code 36 -- Sichern
        delay 0.8
        -- Falls "Ersetzen?" gefragt wird
        try
            repeat with b in (buttons of front window)
                if name of b is in {{"Replace", "Ersetzen"}} then click b
            end repeat
        end try
    end tell'''
    _osa(script, timeout=60)

    log("Rendere …")
    t0 = time.time()
    last_size, stable = -1, 0
    target = None
    while time.time() - t0 < render_timeout:
        mp3s = glob.glob(os.path.join(out_dir, out_name + "*.mp3"))
        wavs = glob.glob(os.path.join(out_dir, out_name + "*.wav")) + glob.glob(os.path.join(out_dir, out_name + "*.aif*"))
        cand = mp3s or wavs
        if cand:
            target = cand[0]
            size = os.path.getsize(target)
            stable = stable + 1 if size == last_size and size > 0 else 0
            last_size = size
            if stable >= 3 and (mp3s or not wavs):
                break
            if stable >= 3 and wavs and not mp3s:
                break
        time.sleep(2)
    else:
        raise TimeoutError("Rendern hat zu lange gedauert")

    if target and not target.lower().endswith(".mp3"):
        target = _to_mp3(target)
    final = os.path.join(out_dir, out_name + ".mp3")
    if target != final:
        shutil.move(target, final)
    for extra in glob.glob(os.path.join(out_dir, out_name + "*.wav")):
        os.remove(extra)
    log("Fertig gerendert.")
    return final


def _to_mp3(src: str) -> str:
    ffmpeg = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    if not os.path.exists(ffmpeg):
        raise RuntimeError("Live hat kein MP3 erzeugt und ffmpeg fehlt. Aktiviere 'MP3 kodieren' im Export-Dialog "
                           "oder installiere ffmpeg (brew install ffmpeg).")
    dst = os.path.splitext(src)[0] + ".mp3"
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", src, "-b:a", "256k", dst], check=True)
    os.remove(src)
    return dst
